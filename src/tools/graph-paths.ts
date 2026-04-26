/**
 * F3: Weighted path algorithms — strongest, cheapest, combined
 *
 * Uses iterative SQL with temp tables (no recursive CTEs — segfault risk).
 * Validated patterns from tests/fierce-f3f5.ts.
 */

import { WeightedPathInputSchema } from '../types/graph-schemas.js'
import type { WeightedPathResult, PathResult } from '../types/graph-types.js'
import { openComputeSession, type ComputeSession, type DuckDBLike } from '../compute-session.js'
import {
  validateGraphTables,
  tempTablePrefix,
  getColumnRefs,
  dropTempTable,
} from './graph-utils.js'
import { logger } from '../utils/logger.js'

/**
 * graph.weighted_path — Find paths using one of three modes:
 * - strongest: BFS maximizing multiplicative weight
 * - cheapest: Bellman-Ford minimizing cost (1 - weight)
 * - combined: BFS with additive weight accumulation
 */
export async function handleWeightedPath(
  args: unknown,
  duckdb: DuckDBLike | ComputeSession
): Promise<WeightedPathResult> {
  const session = openComputeSession(duckdb)

  const input = WeightedPathInputSchema.parse(args)
  await validateGraphTables(session, input)
  const { nodeTable, nodeIdCol, sourceCol, targetCol, edgeSub, weightCol } = getColumnRefs(input)
  const prefix = tempTablePrefix()

  const weightExpr = weightCol ?? '1.0'
  const sourceNode = input.source_node
  const targetNode = input.target_node

  const distTable = `${prefix}_dist`
  const distNextTable = `${prefix}_dist_next`

  try {
    if (input.mode === 'cheapest') {
      return await runCheapestPath(
        session,
        input,
        prefix,
        distTable,
        distNextTable,
        nodeTable,
        nodeIdCol,
        sourceCol,
        targetCol,
        edgeSub,
        weightExpr,
        sourceNode,
        targetNode
      )
    } else {
      // strongest or combined use BFS with multiplication / addition
      return await runBFSPath(
        session,
        input,
        prefix,
        distTable,
        distNextTable,
        nodeTable,
        nodeIdCol,
        sourceCol,
        targetCol,
        edgeSub,
        weightExpr,
        sourceNode,
        targetNode
      )
    }
  } catch (error) {
    logger.error('graph.weighted_path failed', error)
    throw error
  } finally {
    await dropTempTable(session, distTable)
    await dropTempTable(session, distNextTable)
  }
}

/**
 * BFS path for 'strongest' and 'combined' modes.
 * strongest: strength = parent_weight * edge_weight (multiplicative, maximize)
 * combined: strength = parent_weight + edge_weight (additive, maximize)
 */
async function runBFSPath(
  session: ComputeSession,
  input: ReturnType<typeof WeightedPathInputSchema.parse>,
  prefix: string,
  distTable: string,
  distNextTable: string,
  nodeTable: string,
  nodeIdCol: string,
  sourceCol: string,
  targetCol: string,
  edgeSub: string,
  weightExpr: string,
  sourceNode: string | number,
  targetNode: string | number | undefined
): Promise<WeightedPathResult> {
  const sourceVal = typeof sourceNode === 'string' ? `'${sourceNode}'` : sourceNode
  const isMultiplicative = input.mode === 'strongest'

  // Initialize: source has weight 1.0 (mult) or 0.0 (additive), others 0/-Inf
  const initWeight = isMultiplicative ? '1.0' : '0.0'
  const defaultWeight = isMultiplicative ? '0.0' : '-999999.0'

  await session.exec(
    `CREATE TEMP TABLE ${distTable} AS
     SELECT ${nodeIdCol} AS node_id,
       CASE WHEN ${nodeIdCol} = ${sourceVal} THEN ${initWeight} ELSE ${defaultWeight} END AS weight,
       CASE WHEN ${nodeIdCol} = ${sourceVal} THEN CAST(${nodeIdCol} AS VARCHAR) ELSE '' END AS path
     FROM ${nodeTable}`
  )

  for (let hop = 0; hop < input.max_hops; hop++) {
    const combineExpr = isMultiplicative
      ? `d.weight * CAST(e.${weightExpr} AS DOUBLE)`
      : `d.weight + CAST(e.${weightExpr} AS DOUBLE)`

    await session.exec(
      `CREATE TEMP TABLE ${distNextTable} AS
       WITH candidates AS (
         SELECT e.${targetCol} AS node_id,
           ${combineExpr} AS new_weight,
           d.path || ',' || CAST(e.${targetCol} AS VARCHAR) AS new_path
         FROM ${distTable} d
         JOIN ${edgeSub} e ON d.node_id = e.${sourceCol}
         WHERE d.weight != ${defaultWeight}
       ),
       best_candidates AS (
         SELECT node_id, MAX(new_weight) AS new_weight,
                FIRST(new_path ORDER BY new_weight DESC) AS new_path
         FROM candidates
         GROUP BY node_id
       )
       SELECT cur.node_id,
         CASE WHEN bc.new_weight IS NOT NULL AND bc.new_weight > cur.weight
              THEN bc.new_weight ELSE cur.weight END AS weight,
         CASE WHEN bc.new_weight IS NOT NULL AND bc.new_weight > cur.weight
              THEN bc.new_path ELSE cur.path END AS path
       FROM ${distTable} cur
       LEFT JOIN best_candidates bc ON cur.node_id = bc.node_id`
    )

    await dropTempTable(session, distTable)
    await session.exec(`ALTER TABLE ${distNextTable} RENAME TO ${distTable}`)
  }

  // Collect results
  let resultQuery: string
  if (targetNode !== undefined) {
    const targetVal = typeof targetNode === 'string' ? `'${targetNode}'` : targetNode
    resultQuery = `SELECT node_id, weight, path FROM ${distTable}
                   WHERE node_id = ${targetVal} AND weight != ${defaultWeight}`
  } else {
    resultQuery = `SELECT node_id, weight, path FROM ${distTable}
                   WHERE weight != ${defaultWeight} AND node_id != ${sourceVal}
                   ORDER BY weight DESC`
  }

  const rows = await session.exec(resultQuery)

  const paths: PathResult[] = rows.map((r: any) => {
    const pathNodes = (r.path as string).split(',').filter(Boolean)
    return {
      source: sourceNode,
      target: r.node_id,
      path: pathNodes.map((nid, idx) => ({
        node_id: nid,
        cumulative_weight: idx === pathNodes.length - 1 ? Number(r.weight) : 0,
      })),
      total_weight: Number(r.weight),
      hops: pathNodes.length - 1,
    }
  })

  return {
    success: true,
    algorithm: 'weighted_path',
    mode: input.mode,
    paths,
    max_hops: input.max_hops,
  }
}

/**
 * Cheapest path using Bellman-Ford (cost = 1 - weight, minimize).
 */
async function runCheapestPath(
  session: ComputeSession,
  input: ReturnType<typeof WeightedPathInputSchema.parse>,
  prefix: string,
  distTable: string,
  distNextTable: string,
  nodeTable: string,
  nodeIdCol: string,
  sourceCol: string,
  targetCol: string,
  edgeSub: string,
  weightExpr: string,
  sourceNode: string | number,
  targetNode: string | number | undefined
): Promise<WeightedPathResult> {
  const sourceVal = typeof sourceNode === 'string' ? `'${sourceNode}'` : sourceNode
  const INF = 999999.0

  // Initialize: source cost = 0, others = INF
  await session.exec(
    `CREATE TEMP TABLE ${distTable} AS
     SELECT ${nodeIdCol} AS node_id,
       CASE WHEN ${nodeIdCol} = ${sourceVal} THEN 0.0 ELSE ${INF} END AS cost,
       CASE WHEN ${nodeIdCol} = ${sourceVal} THEN CAST(${nodeIdCol} AS VARCHAR) ELSE '' END AS path,
       FALSE AS visited
     FROM ${nodeTable}`
  )

  for (let hop = 0; hop < input.max_hops; hop++) {
    // Bellman-Ford: relax edges from current minimum unvisited node
    await session.exec(
      `CREATE TEMP TABLE ${distNextTable} AS
       WITH current_min AS (
         SELECT node_id, cost, path FROM ${distTable}
         WHERE NOT visited AND cost < ${INF}
         ORDER BY cost LIMIT 1
       ),
       relaxed AS (
         SELECT e.${targetCol} AS node_id,
           cm.cost + (1.0 - CAST(e.${weightExpr} AS DOUBLE)) AS new_cost,
           cm.path || ',' || CAST(e.${targetCol} AS VARCHAR) AS new_path
         FROM current_min cm
         JOIN ${edgeSub} e ON cm.node_id = e.${sourceCol}
       )
       SELECT d.node_id,
         CASE WHEN r.new_cost IS NOT NULL AND r.new_cost < d.cost
              THEN r.new_cost ELSE d.cost END AS cost,
         CASE WHEN r.new_cost IS NOT NULL AND r.new_cost < d.cost
              THEN r.new_path ELSE d.path END AS path,
         d.visited OR d.node_id = (SELECT node_id FROM current_min) AS visited
       FROM ${distTable} d
       LEFT JOIN relaxed r ON d.node_id = r.node_id`
    )

    await dropTempTable(session, distTable)
    await session.exec(`ALTER TABLE ${distNextTable} RENAME TO ${distTable}`)
  }

  let resultQuery: string
  if (targetNode !== undefined) {
    const targetVal = typeof targetNode === 'string' ? `'${targetNode}'` : targetNode
    resultQuery = `SELECT node_id, cost, path FROM ${distTable}
                   WHERE node_id = ${targetVal} AND cost < ${INF}`
  } else {
    resultQuery = `SELECT node_id, cost, path FROM ${distTable}
                   WHERE cost < ${INF} AND node_id != ${sourceVal}
                   ORDER BY cost ASC`
  }

  const rows = await session.exec(resultQuery)

  const paths: PathResult[] = rows.map((r: any) => {
    const pathNodes = (r.path as string).split(',').filter(Boolean)
    return {
      source: sourceNode,
      target: r.node_id,
      path: pathNodes.map((nid, idx) => ({
        node_id: nid,
        cumulative_weight: idx === pathNodes.length - 1 ? Number(r.cost) : 0,
      })),
      total_weight: Number(r.cost),
      hops: pathNodes.length - 1,
    }
  })

  return {
    success: true,
    algorithm: 'weighted_path',
    mode: input.mode,
    paths,
    max_hops: input.max_hops,
  }
}
