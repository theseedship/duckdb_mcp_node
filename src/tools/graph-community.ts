/**
 * F2: Community detection — Label Propagation and Modularity
 *
 * Uses iterative SQL with temp tables (no recursive CTEs — segfault risk).
 * Validated patterns from tests/fierce-f2f5.ts.
 */

import { CommunityDetectInputSchema, ModularityInputSchema } from '../types/graph-schemas.js'
import type { CommunityDetectResult, ModularityResult } from '../types/graph-types.js'
import type { DuckDBService } from '../duckdb/service.js'
import {
  validateGraphTables,
  tempTablePrefix,
  getColumnRefs,
  dropTempTable,
} from './graph-utils.js'
import { logger } from '../utils/logger.js'

/**
 * graph.community_detect — Label propagation
 * Each node adopts the most common label among its neighbors.
 */
export async function handleCommunityDetect(
  args: unknown,
  duckdb: DuckDBService
): Promise<CommunityDetectResult> {
  const input = CommunityDetectInputSchema.parse(args)
  const { nodeCount } = await validateGraphTables(duckdb, input)
  const { nodeTable, nodeIdCol, sourceCol, targetCol, edgeSub } = getColumnRefs(input)
  const prefix = tempTablePrefix()

  if (nodeCount === 0) {
    return {
      success: true,
      algorithm: 'label_propagation',
      communities: [],
      node_assignments: [],
      num_communities: 0,
      iterations_used: 0,
      converged: true,
    }
  }

  const compTable = `${prefix}_comp`
  const compNextTable = `${prefix}_comp_next`

  try {
    // Initialize: each node labeled with its own ID
    await duckdb.executeQuery(
      `CREATE TEMP TABLE ${compTable} AS
       SELECT ${nodeIdCol} AS node_id, ${nodeIdCol} AS cid
       FROM ${nodeTable}`
    )

    let converged = false
    let iterationsUsed = 0

    for (let i = 0; i < input.max_iterations; i++) {
      iterationsUsed = i + 1

      if (input.directed) {
        // Directed: only follow edge direction
        await duckdb.executeQuery(
          `CREATE TEMP TABLE ${compNextTable} AS
           SELECT v.node_id,
             LEAST(c.cid,
               COALESCE((SELECT MIN(c2.cid) FROM ${edgeSub} d
                          JOIN ${compTable} c2 ON d.${sourceCol} = c2.node_id
                          WHERE d.${targetCol} = v.node_id), c.cid)
             ) AS cid
           FROM ${compTable} c
           JOIN ${nodeTable} nv ON c.node_id = nv.${nodeIdCol}
           CROSS JOIN (SELECT node_id FROM ${compTable}) v(node_id)
           WHERE c.node_id = v.node_id`
        )
      } else {
        // Undirected: propagate in both directions
        await duckdb.executeQuery(
          `CREATE TEMP TABLE ${compNextTable} AS
           SELECT c.node_id,
             LEAST(c.cid,
               COALESCE((SELECT MIN(c2.cid) FROM ${edgeSub} d
                          JOIN ${compTable} c2 ON d.${sourceCol} = c2.node_id
                          WHERE d.${targetCol} = c.node_id), c.cid),
               COALESCE((SELECT MIN(c2.cid) FROM ${edgeSub} d
                          JOIN ${compTable} c2 ON d.${targetCol} = c2.node_id
                          WHERE d.${sourceCol} = c.node_id), c.cid)
             ) AS cid
           FROM ${compTable} c`
        )
      }

      // Convergence check
      const changes = await duckdb.executeQuery(
        `SELECT COUNT(*) AS cnt FROM ${compTable} o
         JOIN ${compNextTable} n ON o.node_id = n.node_id
         WHERE o.cid != n.cid`
      )

      await dropTempTable(duckdb, compTable)
      await duckdb.executeQuery(`ALTER TABLE ${compNextTable} RENAME TO ${compTable}`)

      if (Number(changes[0]?.cnt ?? 0) === 0) {
        converged = true
        break
      }
    }

    // Gather results
    const assignments = await duckdb.executeQuery(
      `SELECT node_id, cid AS community_id FROM ${compTable} ORDER BY cid, node_id`
    )

    const communityGroups = await duckdb.executeQuery(
      `SELECT cid AS community_id, COUNT(*) AS size,
              LIST(node_id ORDER BY node_id) AS members
       FROM ${compTable}
       GROUP BY cid
       ORDER BY size DESC`
    )

    return {
      success: true,
      algorithm: 'label_propagation',
      communities: communityGroups.map((c: any) => ({
        community_id: c.community_id,
        size: Number(c.size),
        members: Array.isArray(c.members) ? c.members : [],
      })),
      node_assignments: assignments.map((a: any) => ({
        node_id: a.node_id,
        community_id: a.community_id,
      })),
      num_communities: communityGroups.length,
      iterations_used: iterationsUsed,
      converged,
    }
  } catch (error) {
    logger.error('graph.community_detect failed', error)
    throw error
  } finally {
    await dropTempTable(duckdb, compTable)
    await dropTempTable(duckdb, compNextTable)
  }
}

/**
 * graph.modularity — Compute modularity score Q
 * Q = (1/2m) * SUM[(A_ij - k_i*k_j/2m) * delta(c_i, c_j)]
 * If no community_column is given, runs community_detect first.
 */
export async function handleModularity(
  args: unknown,
  duckdb: DuckDBService
): Promise<ModularityResult> {
  const input = ModularityInputSchema.parse(args)
  const { edgeCount } = await validateGraphTables(duckdb, input)
  const { edgeSub, sourceCol, targetCol } = getColumnRefs(input)
  const prefix = tempTablePrefix()

  if (edgeCount === 0) {
    return {
      success: true,
      algorithm: 'modularity',
      modularity: 0,
      num_communities: 0,
      total_edges: 0,
    }
  }

  const commTable = `${prefix}_mod_comm`
  const communityColumn = input.community_column
  let createdCommTable = false

  try {
    // If no community column, detect communities first
    if (!communityColumn) {
      const detectResult = await handleCommunityDetect(
        { ...input, max_iterations: input.max_iterations },
        duckdb
      )
      // Create temp table with assignments
      await duckdb.executeQuery(
        `CREATE TEMP TABLE ${commTable} (node_id VARCHAR, community_id VARCHAR)`
      )
      for (const a of detectResult.node_assignments) {
        await duckdb.executeQuery(
          `INSERT INTO ${commTable} VALUES ('${a.node_id}', '${a.community_id}')`
        )
      }
      createdCommTable = true
    }

    // Compute modularity
    // m = total edges (undirected: count each once)
    const m = edgeCount
    const twoM = 2 * m

    let modQuery: string
    if (createdCommTable) {
      // Use temp community table
      modQuery = `
        WITH degrees AS (
          SELECT node_id, SUM(deg) AS k FROM (
            SELECT ${sourceCol} AS node_id, COUNT(*) AS deg FROM ${edgeSub} GROUP BY ${sourceCol}
            UNION ALL
            SELECT ${targetCol} AS node_id, COUNT(*) AS deg FROM ${edgeSub} GROUP BY ${targetCol}
          ) GROUP BY node_id
        ),
        edge_comm AS (
          SELECT e.${sourceCol} AS src, e.${targetCol} AS tgt,
                 cs.community_id AS c_src, ct.community_id AS c_tgt,
                 ds.k AS k_src, dt.k AS k_tgt
          FROM ${edgeSub} e
          JOIN ${commTable} cs ON e.${sourceCol} = cs.node_id
          JOIN ${commTable} ct ON e.${targetCol} = ct.node_id
          JOIN degrees ds ON e.${sourceCol} = ds.node_id
          JOIN degrees dt ON e.${targetCol} = dt.node_id
        )
        SELECT SUM(
          CASE WHEN c_src = c_tgt
            THEN 1.0 - (CAST(k_src AS DOUBLE) * k_tgt / ${twoM})
            ELSE 0.0 - (CAST(k_src AS DOUBLE) * k_tgt / ${twoM})
          END
        ) / ${twoM} AS Q,
        COUNT(DISTINCT c_src) AS num_comm
        FROM edge_comm`
    } else {
      // Use existing community column on the node table
      const { nodeTable, nodeIdCol } = getColumnRefs(input)
      const commCol = communityColumn!
      modQuery = `
        WITH degrees AS (
          SELECT node_id, SUM(deg) AS k FROM (
            SELECT ${sourceCol} AS node_id, COUNT(*) AS deg FROM ${edgeSub} GROUP BY ${sourceCol}
            UNION ALL
            SELECT ${targetCol} AS node_id, COUNT(*) AS deg FROM ${edgeSub} GROUP BY ${targetCol}
          ) GROUP BY node_id
        ),
        edge_comm AS (
          SELECT e.${sourceCol} AS src, e.${targetCol} AS tgt,
                 ns."${commCol}" AS c_src, nt."${commCol}" AS c_tgt,
                 ds.k AS k_src, dt.k AS k_tgt
          FROM ${edgeSub} e
          JOIN ${nodeTable} ns ON e.${sourceCol} = ns.${nodeIdCol}
          JOIN ${nodeTable} nt ON e.${targetCol} = nt.${nodeIdCol}
          JOIN degrees ds ON e.${sourceCol} = ds.node_id
          JOIN degrees dt ON e.${targetCol} = dt.node_id
        )
        SELECT SUM(
          CASE WHEN c_src = c_tgt
            THEN 1.0 - (CAST(k_src AS DOUBLE) * k_tgt / ${twoM})
            ELSE 0.0 - (CAST(k_src AS DOUBLE) * k_tgt / ${twoM})
          END
        ) / ${twoM} AS Q,
        COUNT(DISTINCT c_src) AS num_comm
        FROM edge_comm`
    }

    const result = await duckdb.executeQuery(modQuery)
    const Q = Number(result[0]?.Q ?? 0)
    const numComm = Number(result[0]?.num_comm ?? 0)

    return {
      success: true,
      algorithm: 'modularity',
      modularity: Q,
      num_communities: numComm,
      total_edges: m,
    }
  } catch (error) {
    logger.error('graph.modularity failed', error)
    throw error
  } finally {
    if (createdCommTable) {
      await dropTempTable(duckdb, commTable)
    }
  }
}
