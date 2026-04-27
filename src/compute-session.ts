/**
 * ComputeSession — pinned-connection executor for stateful multi-statement
 * graph algorithms.
 *
 * ## Why this exists
 *
 * Graph handlers (PageRank, Eigenvector, Community, Paths, …) execute many
 * statements in sequence:
 *   1. `CREATE TEMP TABLE _graph_<id>_pr AS SELECT …`
 *   2. iterative `CREATE TEMP TABLE _graph_<id>_pr_next` + `DROP` + `RENAME`
 *   3. final `SELECT node_id, rank FROM _graph_<id>_pr ORDER BY rank LIMIT N`
 *
 * **TEMP tables in DuckDB are per-connection.** Step 3 must run on the SAME
 * connection that created the table in Step 1.
 *
 * Some host services (e.g. `deposium_MCPs/src/services/duckdb.ts`) split
 * routing: writes go through a serialized write connection, reads go through
 * a separate read pool. When a host like that wraps the plugin, Step 1's
 * `CREATE TEMP` lands on the write connection and Step 3's `SELECT` lands on
 * a different read pool connection — which has no temp table — and the
 * algorithm fails silently with a `Catalog Error`.
 *
 * `ComputeSession` makes the plugin's contract explicit: a single executor
 * that pins to one connection for the duration of the algorithm. Hosts that
 * offer a routed service can either:
 *
 *   1. Pass the routed service to `openComputeSession` — the factory detects
 *      a `queryWrite` method and routes everything through the write
 *      connection (TEMP tables now visible across all calls).
 *   2. Build their own `ComputeSession` if they have richer connection
 *      management (e.g. an explicit pool checkout).
 *   3. Pass a single-connection service — the factory falls back to
 *      `executeQuery` (legacy behavior).
 *
 * ## Composition with the agent runtime scratchpad
 *
 * The agent runtime in deposium_MCPs has its own scratchpad concept (a
 * session id + state holder for HITL pause/resume). Long term, the two
 * should converge: a `ComputeSession` is exactly the database-side scope of
 * a scratchpad. When that convergence lands, the host can wire one scratchpad
 * to one ComputeSession and graph algorithms compose naturally with agent
 * steps that need stateful database compute.
 *
 * For now `ComputeSession` is the database-side primitive only. The agent
 * runtime keeps its scratchpad separate.
 *
 * @since v1.2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Metrics accumulated by a ComputeSession over its lifetime.
 * @since v1.4.0
 */
export interface SessionMetrics {
  /** Number of `exec()` calls completed (success or error). */
  queries_run: number
  /** Sum of wall-clock duration of every completed `exec()` call, in ms. */
  total_duration_ms: number
  /** Wall-clock timestamp (ms since epoch) of the last completed `exec()`. `null` if no call yet. */
  last_query_at: number | null
  /** Count of `exec()` calls that threw. */
  errors_count: number
}

/**
 * The minimum shape a ComputeSession exposes. All graph handler internals
 * use `exec(sql, params)`. Optional `cleanup()` lets callers release any
 * resources (connections, temp scratch). Handlers do their own per-table
 * cleanup so `cleanup()` is reserved for future structural needs.
 */
export interface ComputeSession {
  /**
   * Execute a SQL statement on the session's pinned connection. Both reads
   * and writes go through the same connection so TEMP tables created earlier
   * are visible to subsequent reads.
   *
   * Type parameter defaults to `any` to match `DuckDBService.executeQuery`'s
   * historical signature — the plugin's algorithms read shape-fluid result
   * sets and assert with `Number(r.cnt)` etc. Explicit typing recommended at
   * call sites for new code.
   */
  exec<T = any>(sql: string, params?: unknown[]): Promise<T[]>

  /**
   * Optional finalizer. v1.2.0 handlers don't depend on it (they drop their
   * own temp tables in `finally`), but consumers building richer sessions
   * (e.g. a checked-out pool connection) can release here.
   */
  cleanup?(): Promise<void>

  /**
   * Snapshot of the session's runtime metrics. Sessions opened via
   * `openComputeSession` provide this; bring-your-own sessions may not.
   *
   * Returns a defensive copy — mutating the result does not affect the
   * session's internal counters.
   *
   * @since v1.4.0
   */
  metrics?(): SessionMetrics

  /**
   * Marker — distinguishes a `ComputeSession` from a raw DuckDB-like service
   * at runtime. Used by `openComputeSession` to passthrough an existing
   * session instead of wrapping it twice.
   */
  readonly _isComputeSession?: true
}

/**
 * Minimal shape we accept for "DuckDB-like" services. The plugin used to
 * type this as `DuckDBService` (its own class), but the deposium_MCPs host
 * passes its own service via `as any`. Anything that exposes
 * `executeQuery(sql, params)` works.
 *
 * Optional `queryWrite` is the host's signal "this is a routed service —
 * pin all calls to my write connection so TEMP tables work".
 */
export interface DuckDBLike {
  executeQuery<T = any>(sql: string, params?: unknown[]): Promise<T[]>
  /**
   * Routed services (e.g. deposium_MCPs DuckDBService) expose this in
   * addition to `executeQuery`. When present, the factory uses it for ALL
   * statements — both writes and reads — so the algorithm's temp tables
   * are visible to the final SELECT.
   */
  queryWrite?<T = any>(sql: string, params?: unknown[]): Promise<T[]>
}

/**
 * Open a ComputeSession from a DuckDB-like service or pass through an
 * existing session.
 *
 * Resolution rules:
 *   1. Already a ComputeSession (`_isComputeSession` marker) → return as-is.
 *   2. Has `queryWrite(...)` (routed host service) → use it for all queries
 *      so TEMP tables remain visible across statements.
 *   3. Otherwise → fall back to `executeQuery(...)` (single-connection
 *      services and tests).
 *
 * The returned session does not own the underlying connection — `cleanup()`
 * is a no-op by default. Handlers continue to drop their own temp tables in
 * `finally` blocks.
 */
export function openComputeSession(target: DuckDBLike | ComputeSession): ComputeSession {
  // (1) Passthrough — caller already wrapped, do not double-instrument.
  if (
    target &&
    typeof (target as ComputeSession).exec === 'function' &&
    (target as ComputeSession)._isComputeSession === true
  ) {
    return target as ComputeSession
  }

  const dbLike = target as DuckDBLike

  // Pick the underlying executor once, then wrap it with metrics. A single
  // wrapper keeps the (2)/(3) branches symmetric and avoids duplicating the
  // instrumentation. @since v1.4.0
  let underlying: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>
  if (typeof dbLike.queryWrite === 'function') {
    // (2) Routed service — pin to write connection so TEMP tables remain
    // visible across reads/writes within the algorithm.
    underlying = (sql, params) => dbLike.queryWrite!(sql, params)
  } else if (typeof dbLike.executeQuery === 'function') {
    // (3) Legacy single-connection service
    underlying = (sql, params) => dbLike.executeQuery(sql, params)
  } else {
    throw new TypeError(
      'openComputeSession: target must be a ComputeSession, a routed service ' +
        'with queryWrite(), or a service with executeQuery(). Got: ' +
        (typeof target === 'object' ? Object.keys(target ?? {}).join(',') : typeof target)
    )
  }

  // Per-session counters — closed over by the returned session. A defensive
  // copy is returned from metrics() so callers cannot mutate the live state.
  const state: SessionMetrics = {
    queries_run: 0,
    total_duration_ms: 0,
    last_query_at: null,
    errors_count: 0,
  }

  return {
    _isComputeSession: true,
    async exec<T = any>(sql: string, params?: unknown[]): Promise<T[]> {
      const start = Date.now()
      try {
        return await underlying<T>(sql, params)
      } catch (error) {
        state.errors_count += 1
        throw error
      } finally {
        const now = Date.now()
        state.queries_run += 1
        state.total_duration_ms += now - start
        state.last_query_at = now
      }
    },
    metrics(): SessionMetrics {
      return { ...state }
    },
  }
}

/**
 * Backwards-compat helper for handlers that still receive
 * `DuckDBService`-typed parameters at the public API boundary. Wraps once at
 * function entry; pass the resulting session into all internal helpers.
 *
 * @internal
 */
export function ensureSession(target: DuckDBLike | ComputeSession): ComputeSession {
  return openComputeSession(target)
}
