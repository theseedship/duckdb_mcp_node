/**
 * F4: Temporal graph tools — filter by period and compare periods
 *
 * Validated patterns from tests/fierce-f2f5.ts:193-233.
 */

import { TemporalFilterInputSchema, ComparePeriodsInputSchema } from '../types/graph-schemas.js'
import type {
  TemporalFilterResult,
  ComparePeriodsResult,
  EdgeChange,
  PeriodMetrics,
} from '../types/graph-types.js'
import { openComputeSession, type ComputeSession, type DuckDBLike } from '../compute-session.js'
import { validateGraphTables, getColumnRefs } from './graph-utils.js'
import { escapeIdentifier, escapeString } from '../utils/sql-escape.js'
import { logger } from '../utils/logger.js'

/**
 * graph.temporal_filter — Filter edges by a period column/value, return graph stats.
 */
export async function handleTemporalFilter(
  args: unknown,
  duckdb: DuckDBLike | ComputeSession
): Promise<TemporalFilterResult> {
  const session = openComputeSession(duckdb)

  const input = TemporalFilterInputSchema.parse(args)
  await validateGraphTables(session, input)
  const { edgeTable, sourceCol, targetCol, weightCol } = getColumnRefs(input)
  const periodCol = escapeIdentifier(input.period_column)
  const periodVal = escapeString(input.period_value)

  try {
    // Count edges in this period
    const edgeStats = await session.exec(
      `SELECT COUNT(*) AS edge_count
              ${weightCol ? `, AVG(CAST(${weightCol} AS DOUBLE)) AS avg_weight` : ''}
       FROM ${edgeTable}
       WHERE ${periodCol} = ${periodVal}`
    )

    const edgeCount = Number(edgeStats[0]?.edge_count ?? 0)
    const avgWeight = weightCol ? Number(edgeStats[0]?.avg_weight ?? 0) : null

    // Count distinct nodes active in this period
    const nodeStats = await session.exec(
      `SELECT COUNT(DISTINCT node_id) AS node_count FROM (
         SELECT ${sourceCol} AS node_id FROM ${edgeTable} WHERE ${periodCol} = ${periodVal}
         UNION
         SELECT ${targetCol} AS node_id FROM ${edgeTable} WHERE ${periodCol} = ${periodVal}
       )`
    )
    const nodeCount = Number(nodeStats[0]?.node_count ?? 0)

    // Density = edges / (nodes * (nodes-1)) for directed, or *2 for undirected
    const maxEdges = nodeCount * (nodeCount - 1) || 1
    const density = edgeCount / maxEdges

    return {
      success: true,
      algorithm: 'temporal_filter',
      period_column: input.period_column,
      period_value: input.period_value,
      node_count: nodeCount,
      edge_count: edgeCount,
      avg_weight: avgWeight,
      density,
    }
  } catch (error) {
    logger.error('graph.temporal_filter failed', error)
    throw error
  }
}

/**
 * Compute metrics for a single period.
 */
async function computePeriodMetrics(
  session: ComputeSession,
  edgeTable: string,
  sourceCol: string,
  targetCol: string,
  weightCol: string | null,
  periodCol: string,
  periodVal: string
): Promise<PeriodMetrics> {
  const edgeStats = await session.exec(
    `SELECT COUNT(*) AS edge_count
            ${weightCol ? `, AVG(CAST(${weightCol} AS DOUBLE)) AS avg_weight` : ''}
     FROM ${edgeTable}
     WHERE ${periodCol} = ${periodVal}`
  )

  const edgeCount = Number(edgeStats[0]?.edge_count ?? 0)
  const avgWeight = weightCol ? Number(edgeStats[0]?.avg_weight ?? 0) : null

  const nodeStats = await session.exec(
    `SELECT COUNT(DISTINCT node_id) AS node_count FROM (
       SELECT ${sourceCol} AS node_id FROM ${edgeTable} WHERE ${periodCol} = ${periodVal}
       UNION
       SELECT ${targetCol} AS node_id FROM ${edgeTable} WHERE ${periodCol} = ${periodVal}
     )`
  )
  const nodeCount = Number(nodeStats[0]?.node_count ?? 0)
  const maxEdges = nodeCount * (nodeCount - 1) || 1

  return {
    edge_count: edgeCount,
    avg_weight: avgWeight,
    density: edgeCount / maxEdges,
    node_count: nodeCount,
  }
}

/**
 * graph.compare_periods — FULL OUTER JOIN edges from two periods, classify changes.
 */
export async function handleComparePeriods(
  args: unknown,
  duckdb: DuckDBLike | ComputeSession
): Promise<ComparePeriodsResult> {
  const session = openComputeSession(duckdb)

  const input = ComparePeriodsInputSchema.parse(args)
  await validateGraphTables(session, input)
  const { edgeTable, sourceCol, targetCol, weightCol } = getColumnRefs(input)
  const periodCol = escapeIdentifier(input.period_column)
  const periodA = escapeString(input.period_a)
  const periodB = escapeString(input.period_b)

  try {
    // Compute metrics for each period
    const metricsA = await computePeriodMetrics(
      session,
      edgeTable,
      sourceCol,
      targetCol,
      weightCol,
      periodCol,
      periodA
    )
    const metricsB = await computePeriodMetrics(
      session,
      edgeTable,
      sourceCol,
      targetCol,
      weightCol,
      periodCol,
      periodB
    )

    // FULL OUTER JOIN edges from both periods
    const changeQuery = `
      WITH edges_a AS (
        SELECT ${sourceCol} AS src, ${targetCol} AS tgt
               ${weightCol ? `, CAST(${weightCol} AS DOUBLE) AS w` : ', 1.0 AS w'}
        FROM ${edgeTable}
        WHERE ${periodCol} = ${periodA}
      ),
      edges_b AS (
        SELECT ${sourceCol} AS src, ${targetCol} AS tgt
               ${weightCol ? `, CAST(${weightCol} AS DOUBLE) AS w` : ', 1.0 AS w'}
        FROM ${edgeTable}
        WHERE ${periodCol} = ${periodB}
      )
      SELECT
        COALESCE(a.src, b.src) AS source,
        COALESCE(a.tgt, b.tgt) AS target,
        a.w AS weight_a,
        b.w AS weight_b,
        CASE
          WHEN a.w IS NULL THEN 'NEW'
          WHEN b.w IS NULL THEN 'REMOVED'
          WHEN b.w > a.w THEN 'STRENGTHENED'
          WHEN b.w < a.w THEN 'WEAKENED'
          ELSE 'STABLE'
        END AS change_type
      FROM edges_a a
      FULL OUTER JOIN edges_b b
        ON a.src = b.src AND a.tgt = b.tgt
      ORDER BY change_type, source, target`

    const changes = await session.exec(changeQuery)

    const edgeChanges: EdgeChange[] = changes.map((c: any) => ({
      source: c.source,
      target: c.target,
      weight_a: c.weight_a !== null ? Number(c.weight_a) : null,
      weight_b: c.weight_b !== null ? Number(c.weight_b) : null,
      change_type: c.change_type,
    }))

    const summary = {
      new_edges: edgeChanges.filter((c) => c.change_type === 'NEW').length,
      removed_edges: edgeChanges.filter((c) => c.change_type === 'REMOVED').length,
      strengthened: edgeChanges.filter((c) => c.change_type === 'STRENGTHENED').length,
      weakened: edgeChanges.filter((c) => c.change_type === 'WEAKENED').length,
      stable: edgeChanges.filter((c) => c.change_type === 'STABLE').length,
    }

    return {
      success: true,
      algorithm: 'compare_periods',
      period_a: metricsA,
      period_b: metricsB,
      changes: edgeChanges,
      summary,
    }
  } catch (error) {
    logger.error('graph.compare_periods failed', error)
    throw error
  }
}
