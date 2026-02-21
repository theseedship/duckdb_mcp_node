/**
 * F1: Centrality algorithms — PageRank and Eigenvector centrality
 *
 * Uses iterative SQL with temp tables (no recursive CTEs — segfault risk).
 * Validated patterns from tests/fierce-f1-isolated.ts.
 */

import { PageRankInputSchema, EigenvectorInputSchema } from '../types/graph-schemas.js'
import type { PageRankResult, EigenvectorResult } from '../types/graph-types.js'
import type { DuckDBService } from '../duckdb/service.js'
import {
  validateGraphTables,
  tempTablePrefix,
  getColumnRefs,
  dropTempTable,
} from './graph-utils.js'
import { logger } from '../utils/logger.js'

/**
 * graph.pagerank — Iterative PageRank with damping factor
 */
export async function handlePageRank(
  args: unknown,
  duckdb: DuckDBService
): Promise<PageRankResult> {
  const input = PageRankInputSchema.parse(args)
  const { nodeCount } = await validateGraphTables(duckdb, input)
  const { nodeTable, nodeIdCol, sourceCol, targetCol, edgeSub } = getColumnRefs(input)
  const prefix = tempTablePrefix()
  const N = nodeCount

  if (N === 0) {
    return {
      success: true,
      algorithm: 'pagerank',
      nodes: [],
      iterations: 0,
      damping: input.damping,
      total_nodes: 0,
    }
  }

  const prTable = `${prefix}_pr`
  const outCntTable = `${prefix}_outdeg`
  const prNextTable = `${prefix}_pr_next`

  try {
    // Initialize rank = 1/N for all nodes
    await duckdb.executeQuery(
      `CREATE TEMP TABLE ${prTable} AS
       SELECT ${nodeIdCol} AS node_id, 1.0 / ${N} AS rank
       FROM ${nodeTable}`
    )

    // Compute out-degrees
    await duckdb.executeQuery(
      `CREATE TEMP TABLE ${outCntTable} AS
       SELECT ${sourceCol} AS node_id, COUNT(*) AS cnt
       FROM ${edgeSub} e
       GROUP BY ${sourceCol}`
    )

    const d = input.damping

    // Iterative PageRank
    for (let i = 0; i < input.iterations; i++) {
      await duckdb.executeQuery(
        `CREATE TEMP TABLE ${prNextTable} AS
         SELECT v.${nodeIdCol} AS node_id,
           (1.0 - ${d}) / ${N} + ${d} * COALESCE(
             (SELECT SUM(pr.rank / oc.cnt)
              FROM ${edgeSub} e
              JOIN ${prTable} pr ON e.${sourceCol} = pr.node_id
              JOIN ${outCntTable} oc ON e.${sourceCol} = oc.node_id
              WHERE e.${targetCol} = v.${nodeIdCol}), 0) AS rank
         FROM ${nodeTable} v`
      )
      await dropTempTable(duckdb, prTable)
      await duckdb.executeQuery(`ALTER TABLE ${prNextTable} RENAME TO ${prTable}`)
    }

    // Get top_n results
    const results = await duckdb.executeQuery(
      `SELECT node_id, rank FROM ${prTable} ORDER BY rank DESC LIMIT ${input.top_n}`
    )

    return {
      success: true,
      algorithm: 'pagerank',
      nodes: results.map((r: any) => ({ node_id: r.node_id, rank: Number(r.rank) })),
      iterations: input.iterations,
      damping: input.damping,
      total_nodes: N,
    }
  } catch (error) {
    logger.error('graph.pagerank failed', error)
    throw error
  } finally {
    await dropTempTable(duckdb, prTable)
    await dropTempTable(duckdb, outCntTable)
    await dropTempTable(duckdb, prNextTable)
  }
}

/**
 * graph.eigenvector — Power iteration eigenvector centrality
 */
export async function handleEigenvector(
  args: unknown,
  duckdb: DuckDBService
): Promise<EigenvectorResult> {
  const input = EigenvectorInputSchema.parse(args)
  const { nodeCount } = await validateGraphTables(duckdb, input)
  const { nodeTable, nodeIdCol, sourceCol, targetCol, edgeSub } = getColumnRefs(input)
  const prefix = tempTablePrefix()
  const N = nodeCount

  if (N === 0) {
    return {
      success: true,
      algorithm: 'eigenvector',
      nodes: [],
      iterations: 0,
      total_nodes: 0,
    }
  }

  const evTable = `${prefix}_ev`
  const evNextTable = `${prefix}_ev_next`

  try {
    // Initialize all scores = 1.0
    await duckdb.executeQuery(
      `CREATE TEMP TABLE ${evTable} AS
       SELECT ${nodeIdCol} AS node_id, 1.0 AS score
       FROM ${nodeTable}`
    )

    // Power iteration (undirected: sum scores from both directions)
    for (let i = 0; i < input.iterations; i++) {
      // Sum neighbor scores from both edge directions, then normalize by max
      await duckdb.executeQuery(
        `CREATE TEMP TABLE ${evNextTable} AS
         WITH raw_scores AS (
           SELECT v.${nodeIdCol} AS node_id,
             COALESCE(
               (SELECT SUM(ev.score)
                FROM ${edgeSub} e
                JOIN ${evTable} ev ON e.${sourceCol} = ev.node_id
                WHERE e.${targetCol} = v.${nodeIdCol}),
             0)
             + COALESCE(
               (SELECT SUM(ev.score)
                FROM ${edgeSub} e
                JOIN ${evTable} ev ON e.${targetCol} = ev.node_id
                WHERE e.${sourceCol} = v.${nodeIdCol}),
             0) AS raw_score
           FROM ${nodeTable} v
         ),
         max_score AS (
           SELECT GREATEST(MAX(raw_score), 1e-10) AS mx FROM raw_scores
         )
         SELECT node_id, raw_score / mx AS score
         FROM raw_scores, max_score`
      )
      await dropTempTable(duckdb, evTable)
      await duckdb.executeQuery(`ALTER TABLE ${evNextTable} RENAME TO ${evTable}`)
    }

    const results = await duckdb.executeQuery(
      `SELECT node_id, score FROM ${evTable} ORDER BY score DESC LIMIT ${input.top_n}`
    )

    return {
      success: true,
      algorithm: 'eigenvector',
      nodes: results.map((r: any) => ({ node_id: r.node_id, score: Number(r.score) })),
      iterations: input.iterations,
      total_nodes: N,
    }
  } catch (error) {
    logger.error('graph.eigenvector failed', error)
    throw error
  } finally {
    await dropTempTable(duckdb, evTable)
    await dropTempTable(duckdb, evNextTable)
  }
}
