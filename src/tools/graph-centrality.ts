/**
 * F1: Centrality algorithms — PageRank and Eigenvector centrality
 *
 * Uses iterative SQL with temp tables (no recursive CTEs — segfault risk).
 * Validated patterns from tests/fierce-f1-isolated.ts.
 *
 * v1.2.0: handlers wrap their `duckdb` argument in a `ComputeSession` so all
 * statements (CREATE TEMP, ALTER, DROP, SELECT) run on the same pinned
 * connection. See `src/compute-session.ts` for why this matters when the
 * host service routes reads/writes to different connections.
 */

import { PageRankInputSchema, EigenvectorInputSchema } from '../types/graph-schemas.js'
import type { PageRankResult, EigenvectorResult } from '../types/graph-types.js'
import { openComputeSession, type ComputeSession, type DuckDBLike } from '../compute-session.js'
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
  duckdb: DuckDBLike | ComputeSession
): Promise<PageRankResult> {
  const session = openComputeSession(duckdb)

  const input = PageRankInputSchema.parse(args)
  const { distinctNodeCount, nodeCount } = await validateGraphTables(session, input)
  const { nodeIdCol, sourceCol, targetCol, edgeSub, nodeSub } = getColumnRefs(input)
  const prefix = tempTablePrefix()
  // N must be the DISTINCT count: iteration reads from nodeSub (deduplicated).
  // Using nodeCount when duplicates exist would shrink the (1-d)/N term and
  // amplify the dividing-by-N initial rank. v1.2.2 fix.
  const N = distinctNodeCount
  if (distinctNodeCount < nodeCount) {
    logger.warn('graph.pagerank: node table has duplicate node_ids — using DISTINCT subquery', {
      nodeCount,
      distinctNodeCount,
      duplicates: nodeCount - distinctNodeCount,
    })
  }

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
    // Initialize rank = 1/N for all nodes (DEDUP — see buildNodeSubquery)
    await session.exec(
      `CREATE TEMP TABLE ${prTable} AS
       SELECT ${nodeIdCol} AS node_id, 1.0 / ${N} AS rank
       FROM ${nodeSub}`
    )

    // Compute out-degrees
    await session.exec(
      `CREATE TEMP TABLE ${outCntTable} AS
       SELECT ${sourceCol} AS node_id, COUNT(*) AS cnt
       FROM ${edgeSub} e
       GROUP BY ${sourceCol}`
    )

    const d = input.damping

    // Iterative PageRank — outer FROM uses nodeSub (DISTINCT) so each
    // logical node produces exactly one row per iteration. Without this,
    // duplicate rows compounded the JOIN amplification (cascade-explosion
    // bug, observed live at 9e16 scores on 5,332 duplicates / 50,062 rows).
    for (let i = 0; i < input.iterations; i++) {
      await session.exec(
        `CREATE TEMP TABLE ${prNextTable} AS
         SELECT v.${nodeIdCol} AS node_id,
           (1.0 - ${d}) / ${N} + ${d} * COALESCE(
             (SELECT SUM(pr.rank / oc.cnt)
              FROM ${edgeSub} e
              JOIN ${prTable} pr ON e.${sourceCol} = pr.node_id
              JOIN ${outCntTable} oc ON e.${sourceCol} = oc.node_id
              WHERE e.${targetCol} = v.${nodeIdCol}), 0) AS rank
         FROM ${nodeSub} v`
      )
      await dropTempTable(session, prTable)
      await session.exec(`ALTER TABLE ${prNextTable} RENAME TO ${prTable}`)
    }

    // Get top_n results — runs on the same pinned connection that holds
    // the temp table, so visibility is guaranteed.
    const results = await session.exec<{ node_id: string | number; rank: number | string }>(
      `SELECT node_id, rank FROM ${prTable} ORDER BY rank DESC LIMIT ${input.top_n}`
    )

    return {
      success: true,
      algorithm: 'pagerank',
      nodes: results.map((r) => ({ node_id: r.node_id, rank: Number(r.rank) })),
      iterations: input.iterations,
      damping: input.damping,
      total_nodes: N,
    }
  } catch (error) {
    logger.error('graph.pagerank failed', error)
    throw error
  } finally {
    await dropTempTable(session, prTable)
    await dropTempTable(session, outCntTable)
    await dropTempTable(session, prNextTable)
  }
}

/**
 * graph.eigenvector — Power iteration eigenvector centrality
 */
export async function handleEigenvector(
  args: unknown,
  duckdb: DuckDBLike | ComputeSession
): Promise<EigenvectorResult> {
  const session = openComputeSession(duckdb)

  const input = EigenvectorInputSchema.parse(args)
  const { distinctNodeCount, nodeCount } = await validateGraphTables(session, input)
  const { nodeIdCol, sourceCol, targetCol, edgeSub, nodeSub } = getColumnRefs(input)
  const prefix = tempTablePrefix()
  // Eigenvector has the same JOIN-amplification vulnerability as PageRank
  // when nodeTable contains duplicate node_ids — see buildNodeSubquery.
  const N = distinctNodeCount
  if (distinctNodeCount < nodeCount) {
    logger.warn('graph.eigenvector: node table has duplicate node_ids — using DISTINCT subquery', {
      nodeCount,
      distinctNodeCount,
      duplicates: nodeCount - distinctNodeCount,
    })
  }

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
    // Initialize all scores = 1.0 (DEDUP)
    await session.exec(
      `CREATE TEMP TABLE ${evTable} AS
       SELECT ${nodeIdCol} AS node_id, 1.0 AS score
       FROM ${nodeSub}`
    )

    // Power iteration (undirected: sum scores from both directions)
    for (let i = 0; i < input.iterations; i++) {
      // Sum neighbor scores from both edge directions, then normalize by max
      await session.exec(
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
           FROM ${nodeSub} v
         ),
         max_score AS (
           SELECT GREATEST(MAX(raw_score), 1e-10) AS mx FROM raw_scores
         )
         SELECT node_id, raw_score / mx AS score
         FROM raw_scores, max_score`
      )
      await dropTempTable(session, evTable)
      await session.exec(`ALTER TABLE ${evNextTable} RENAME TO ${evTable}`)
    }

    const results = await session.exec<{ node_id: string | number; score: number | string }>(
      `SELECT node_id, score FROM ${evTable} ORDER BY score DESC LIMIT ${input.top_n}`
    )

    return {
      success: true,
      algorithm: 'eigenvector',
      nodes: results.map((r) => ({ node_id: r.node_id, score: Number(r.score) })),
      iterations: input.iterations,
      total_nodes: N,
    }
  } catch (error) {
    logger.error('graph.eigenvector failed', error)
    throw error
  } finally {
    await dropTempTable(session, evTable)
    await dropTempTable(session, evNextTable)
  }
}
