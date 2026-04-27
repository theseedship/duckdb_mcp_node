/**
 * Structured error codes for graph handlers.
 *
 * Before v1.4.0 graph handlers threw raw `Error`s with string messages, so
 * hosts had to grep for substrings (`'Catalog Error'`, `'binder error'`, …)
 * to differentiate "graph data is empty" from "infrastructure broken" from
 * "user-supplied filter is bad". That made fallback routing fragile.
 *
 * `GraphError` extends `Error` (so `instanceof Error` keeps working and the
 * `message` field is unchanged) and adds a coarse `.code` enum the host can
 * pattern-match on:
 *
 *   - `'NO_NODES'` / `'NO_EDGES'`   — the graph has no nodes / no edges.
 *     Today handlers return `success: true` with empty results in this
 *     case, but a host that wants to short-circuit can throw a `GraphError`
 *     itself to trigger an alternate flow.
 *   - `'INVALID_FILTER'`            — the user-supplied `filter:` clause was
 *     rejected by DuckDB. Host should re-prompt the user, not retry.
 *   - `'INVALID_INPUT'`             — Zod validation failure or other input
 *     contract violation. Host should fix the call site, not retry.
 *   - `'NO_PATH'`                   — `graph.weighted_path` could not reach
 *     `target_node` from `source_node` within `max_hops`. Host can decide
 *     whether to relax max_hops or report no-path.
 *   - `'TIMEOUT'`                   — query exceeded its budget.
 *   - `'INFRA'`                     — anything else: connection lost, DuckDB
 *     internal error, OOM, etc. Host should treat as transient and retry
 *     with backoff, OR surface as "infra issue, please retry".
 *
 * @since v1.4.0
 */

export type GraphErrorCode =
  | 'NO_NODES'
  | 'NO_EDGES'
  | 'INVALID_FILTER'
  | 'INVALID_INPUT'
  | 'NO_PATH'
  | 'TIMEOUT'
  | 'INFRA'

export class GraphError extends Error {
  public readonly code: GraphErrorCode

  constructor(code: GraphErrorCode, message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'GraphError'
    this.code = code
    if (options?.cause !== undefined) {
      // ES2022 Error.cause — hosts that want the original error can read it
      // for logging without the plugin needing a custom cause field.
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
    // Preserve prototype chain across compilation targets (TS down-emit safety)
    Object.setPrototypeOf(this, GraphError.prototype)
  }

  /**
   * Wrap an arbitrary thrown value into a GraphError with the `INFRA` code,
   * preserving the original error as `cause`. No-op if the value is already
   * a GraphError.
   *
   * Heuristic: messages mentioning a "Binder", "Catalog", or "Parser" error
   * from DuckDB applied to a user filter become `INVALID_FILTER`; everything
   * else stays `INFRA`. This is a coarse but useful first cut — the audit
   * called this out as the v1.4.0 starting point, hosts can add finer
   * classification on top.
   */
  static fromUnknown(error: unknown, hint?: { context?: 'filter' | 'query' }): GraphError {
    if (error instanceof GraphError) return error

    const message = error instanceof Error ? error.message : String(error)

    // DuckDB filter-related errors — Binder/Catalog/Parser when the filter
    // SQL is malformed. We only flip to INVALID_FILTER when the caller
    // signals the failure happened while validating user-supplied SQL.
    if (hint?.context === 'filter' && /binder|catalog|parser/i.test(message)) {
      return new GraphError('INVALID_FILTER', message, { cause: error })
    }

    if (/timeout|timed out/i.test(message)) {
      return new GraphError('TIMEOUT', message, { cause: error })
    }

    return new GraphError('INFRA', message, { cause: error })
  }
}
