/**
 * Shared utilities for graph algorithm tools (S2)
 * Handles table validation, temp table lifecycle, and edge subquery building.
 *
 * CRITICAL: All graph algorithms use iterative SQL with temp tables.
 * NO recursive CTEs (segfault risk on DuckDB 1.4.x).
 *
 * v1.2.0 update: utilities now operate on a `ComputeSession` instead of a
 * raw `DuckDBService`. The session pins all queries to a single connection
 * so TEMP tables created in one step are visible in later steps. See
 * `src/compute-session.ts` for the full rationale.
 *
 * Backward compat: existing callers can still pass a DuckDBService — the
 * helpers wrap it via `openComputeSession()` on entry.
 */

import { escapeIdentifier } from '../utils/sql-escape.js'
import { openComputeSession, type ComputeSession, type DuckDBLike } from '../compute-session.js'
import type { GraphInputBase } from '../types/graph-schemas.js'
import { GraphError } from '../errors/graph-errors.js'

/**
 * Generate a unique temp table prefix to avoid collisions.
 */
export function tempTablePrefix(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `_graph_${ts}_${rand}`
}

/**
 * Options for validateGraphTables.
 * @since v1.3.0
 */
export interface ValidateGraphTablesOptions {
  /**
   * If set, validateGraphTables returns the first N distinct node_ids in the
   * `topNodesPreview` field. Useful for visual diagnostic when a graph
   * algorithm is producing unexpected results — lets the caller see "what
   * does the plugin actually see" without re-running a query. Default: undefined
   * (no preview, no extra query).
   */
  previewNodes?: number
}

/**
 * Result of validateGraphTables.
 * @since v1.3.0 — `topNodesPreview` added (opt-in via options.previewNodes)
 */
export interface ValidateGraphTablesResult {
  nodeCount: number
  edgeCount: number
  /** @since v1.2.2 — DISTINCT count of node_id values, post-filter */
  distinctNodeCount: number
  /** @since v1.3.0 — opt-in via options.previewNodes; undefined otherwise */
  topNodesPreview?: Array<string | number>
}

/**
 * Validate that the graph tables and columns exist, return node/edge counts.
 *
 * Accepts a `ComputeSession` (preferred) or a `DuckDBLike` for backward
 * compat — the latter is auto-wrapped. All validation queries run on the
 * same pinned connection so the caller can rely on subsequent statements
 * (CREATE TEMP TABLE, etc.) seeing the same context.
 */
export async function validateGraphTables(
  target: ComputeSession | DuckDBLike,
  config: GraphInputBase,
  options?: ValidateGraphTablesOptions
): Promise<ValidateGraphTablesResult> {
  const session = openComputeSession(target)

  const nodeTable = escapeIdentifier(config.node_table)
  const edgeTable = escapeIdentifier(config.edge_table)
  const nodeIdCol = escapeIdentifier(config.node_id_column)
  const sourceCol = escapeIdentifier(config.source_column)
  const targetCol = escapeIdentifier(config.target_column)
  const where = config.filter ? ` WHERE ${config.filter}` : ''

  // v1.4.0: classify validation failures so hosts can route fallbacks
  // without grepping error messages. The single try wraps every probe
  // query — DuckDB binder/catalog/parser errors against a user filter
  // become INVALID_FILTER, everything else becomes INFRA.
  // @since v1.4.0
  try {
    // Verify node table has the id column
    const nodeCheck = await session.exec<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM ${nodeTable}${where} LIMIT 1`
    )
    const nodeCount = Number(nodeCheck[0]?.cnt ?? 0)

    // Verify the node_id column exists by selecting it
    await session.exec(`SELECT ${nodeIdCol} FROM ${nodeTable} LIMIT 0`)

    // Distinct node count — used by algorithms as N for the (1-d)/N term.
    // If `distinctNodeCount < nodeCount`, the table has duplicate rows per
    // node_id; algorithms must read from `nodeSub` (DISTINCT subquery) to
    // avoid the cascade-amplification bug — see buildNodeSubquery comment.
    // @since v1.2.2
    const distinctCheck = await session.exec<{ cnt: number | string }>(
      `SELECT COUNT(DISTINCT ${nodeIdCol}) AS cnt FROM ${nodeTable}${where}`
    )
    const distinctNodeCount = Number(distinctCheck[0]?.cnt ?? 0)

    // Verify edge table has source/target columns
    const edgeCheck = await session.exec<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM ${edgeTable} LIMIT 1`
    )
    const edgeCount = Number(edgeCheck[0]?.cnt ?? 0)

    await session.exec(`SELECT ${sourceCol}, ${targetCol} FROM ${edgeTable} LIMIT 0`)

    // Verify weight column if specified
    if (config.weight_column) {
      const weightCol = escapeIdentifier(config.weight_column)
      await session.exec(`SELECT ${weightCol} FROM ${edgeTable} LIMIT 0`)
    }

    // Opt-in preview of distinct node ids — does NOT run unless caller asks
    // for it, so default-path callers pay no extra query.
    // @since v1.3.0
    let topNodesPreview: Array<string | number> | undefined
    const previewN = options?.previewNodes
    if (previewN && previewN > 0 && distinctNodeCount > 0) {
      const limit = Math.min(previewN, 100)
      const previewRows = await session.exec<{ node_id: string | number }>(
        `SELECT DISTINCT ${nodeIdCol} AS node_id FROM ${nodeTable}${where} LIMIT ${limit}`
      )
      topNodesPreview = previewRows.map((r) => r.node_id)
    }

    return { nodeCount, edgeCount, distinctNodeCount, topNodesPreview }
  } catch (error) {
    throw GraphError.fromUnknown(error, {
      context: config.filter ? 'filter' : 'query',
    })
  }
}

/**
 * Build an edge subquery that applies optional WHERE filter.
 * Returns a subquery alias that can be used as a table reference.
 */
export function buildEdgeSubquery(config: GraphInputBase): string {
  const edgeTable = escapeIdentifier(config.edge_table)
  if (config.filter) {
    // The filter is a raw WHERE clause — wrap in subquery
    return `(SELECT * FROM ${edgeTable} WHERE ${config.filter})`
  }
  return edgeTable
}

/**
 * Build a deduplicated node subquery. Robust against pathological input
 * data — many real-world entity tables (e.g. deposium_MCPs'
 * uploaded_files_graph_entities) keep soft-deleted orphans or have
 * imperfect dedup, leaving multiple rows per logical node_id.
 *
 * **Why this matters for iterative algorithms** (PageRank, Eigenvector,
 * Community label propagation): the iteration formula
 *
 *   new_rank(v) = (1-d)/N + d * SUM(pr[s].rank / oc[s].cnt for in-edges)
 *
 * is correct only when each node appears once. If `nodeTable` has K
 * duplicate rows for source s, the JOIN `pr ON e.source = pr.node_id`
 * matches K rows and contributes K × (rank/oc.cnt) per edge — amplifying
 * the rank by factor K each iteration. Over 20 iterations with K≈7,
 * scores explode to ~9×10^16 (observed live 2026-04-26 on space
 * 89b04306 with 5,332 duplicates / 50,062 nodes).
 *
 * Behaviour:
 *   - Without filter: `(SELECT DISTINCT node_id_col AS node_id_col FROM table)`
 *   - With filter: `(SELECT DISTINCT node_id_col FROM table WHERE filter)`
 *
 * The DISTINCT collapses duplicate rows by node_id_col only — any
 * additional metadata (entity_name, type, …) is dropped here. Algorithms
 * that need names should JOIN back to nodeTable AT THE END.
 *
 * @since v1.2.2 (Sprint α — root cause: dedup-cascade-explosion)
 */
export function buildNodeSubquery(config: GraphInputBase): string {
  const nodeTable = escapeIdentifier(config.node_table)
  const nodeIdCol = escapeIdentifier(config.node_id_column)
  const where = config.filter ? ` WHERE ${config.filter}` : ''
  return `(SELECT DISTINCT ${nodeIdCol} FROM ${nodeTable}${where})`
}

/**
 * Get column references for a graph config.
 *
 * `nodeSub` is the dedup-safe view of the node table — algorithms
 * iterating over nodes should always read from `nodeSub`, never from raw
 * `nodeTable`, to avoid the cascade-amplification bug. Use `nodeTable`
 * only for things like JOIN-back-for-metadata at the end of an algorithm.
 */
export function getColumnRefs(config: GraphInputBase) {
  return {
    nodeTable: escapeIdentifier(config.node_table),
    edgeTable: escapeIdentifier(config.edge_table),
    nodeIdCol: escapeIdentifier(config.node_id_column),
    sourceCol: escapeIdentifier(config.source_column),
    targetCol: escapeIdentifier(config.target_column),
    weightCol: config.weight_column ? escapeIdentifier(config.weight_column) : null,
    edgeSub: buildEdgeSubquery(config),
    nodeSub: buildNodeSubquery(config),
  }
}

/**
 * Safely drop a temp table if it exists. Operates on the session's pinned
 * connection — must be the same connection that created the table.
 */
export async function dropTempTable(
  target: ComputeSession | DuckDBLike,
  name: string
): Promise<void> {
  const session = openComputeSession(target)
  await session.exec(`DROP TABLE IF EXISTS ${name}`)
}

/**
 * Clean up all temp tables matching a prefix.
 */
export async function cleanupTempTables(
  target: ComputeSession | DuckDBLike,
  prefix: string,
  names: string[]
): Promise<void> {
  const session = openComputeSession(target)
  for (const name of names) {
    await dropTempTable(session, `${prefix}_${name}`)
  }
}
