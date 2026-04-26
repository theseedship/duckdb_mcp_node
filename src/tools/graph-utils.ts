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

/**
 * Generate a unique temp table prefix to avoid collisions.
 */
export function tempTablePrefix(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `_graph_${ts}_${rand}`
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
  config: GraphInputBase
): Promise<{ nodeCount: number; edgeCount: number }> {
  const session = openComputeSession(target)

  const nodeTable = escapeIdentifier(config.node_table)
  const edgeTable = escapeIdentifier(config.edge_table)
  const nodeIdCol = escapeIdentifier(config.node_id_column)
  const sourceCol = escapeIdentifier(config.source_column)
  const targetCol = escapeIdentifier(config.target_column)

  // Verify node table has the id column
  const nodeCheck = await session.exec<{ cnt: number | string }>(
    `SELECT COUNT(*) AS cnt FROM ${nodeTable} LIMIT 1`
  )
  const nodeCount = Number(nodeCheck[0]?.cnt ?? 0)

  // Verify the node_id column exists by selecting it
  await session.exec(`SELECT ${nodeIdCol} FROM ${nodeTable} LIMIT 0`)

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

  return { nodeCount, edgeCount }
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
 * Get column references for a graph config.
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
