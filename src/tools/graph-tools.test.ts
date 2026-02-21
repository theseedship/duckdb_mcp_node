/**
 * S2: Graph Algorithm MCP Tools — Integration Tests
 * Tests all 8 graph tools against a real DuckDB instance.
 *
 * Test graph (6 nodes, 10 edges with weights and periods):
 *   Nodes: A(1), B(2), C(3), D(4), E(5), F(6)
 *   Edges: A→B(0.9), A→C(0.7), B→C(0.8), B→D(0.6),
 *          C→D(0.5), C→E(0.4), D→E(0.9), D→F(0.3),
 *          E→F(0.7), A→D(0.2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DuckDBService } from '../duckdb/service.js'
import { handlePageRank } from './graph-centrality.js'
import { handleEigenvector } from './graph-centrality.js'
import { handleCommunityDetect, handleModularity } from './graph-community.js'
import { handleWeightedPath } from './graph-paths.js'
import { handleTemporalFilter, handleComparePeriods } from './graph-temporal.js'
import { handleGraphExport } from './graph-export.js'

describe('S2: Graph Algorithm Tools', () => {
  let duckdb: DuckDBService
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'graph-tools-test-'))
    duckdb = new DuckDBService({ memory: '512MB', threads: 1 })
    await duckdb.initialize()

    // Create test graph: 6 nodes, 10 edges
    await duckdb.executeQuery(`
      CREATE TABLE vars (
        var_id INTEGER PRIMARY KEY,
        name VARCHAR
      )
    `)
    await duckdb.executeQuery(`
      INSERT INTO vars VALUES
        (1, 'A'), (2, 'B'), (3, 'C'), (4, 'D'), (5, 'E'), (6, 'F')
    `)

    await duckdb.executeQuery(`
      CREATE TABLE drives (
        from_var INTEGER,
        to_var INTEGER,
        confidence DOUBLE,
        period VARCHAR
      )
    `)
    await duckdb.executeQuery(`
      INSERT INTO drives VALUES
        (1, 2, 0.9, 'P1'), (1, 3, 0.7, 'P1'), (2, 3, 0.8, 'P1'),
        (2, 4, 0.6, 'P1'), (3, 4, 0.5, 'P1'), (3, 5, 0.4, 'P1'),
        (4, 5, 0.9, 'P1'), (4, 6, 0.3, 'P1'), (5, 6, 0.7, 'P1'),
        (1, 4, 0.2, 'P1'),
        (1, 2, 0.5, 'P2'), (2, 3, 0.9, 'P2'), (3, 4, 0.8, 'P2'),
        (4, 5, 0.7, 'P2'), (5, 6, 0.6, 'P2')
    `)
  })

  afterEach(async () => {
    await duckdb.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  const baseArgs = {
    node_table: 'vars',
    edge_table: 'drives',
    node_id_column: 'var_id',
    source_column: 'from_var',
    target_column: 'to_var',
    weight_column: 'confidence',
  }

  // ── F1: Centrality ───────────────────────────────────────

  describe('F1: graph.pagerank', () => {
    it('should compute PageRank for all nodes', async () => {
      const result = await handlePageRank({ ...baseArgs, iterations: 20, damping: 0.85 }, duckdb)

      expect(result.success).toBe(true)
      expect(result.algorithm).toBe('pagerank')
      expect(result.total_nodes).toBe(6)
      expect(result.nodes.length).toBeGreaterThan(0)
      expect(result.nodes.length).toBeLessThanOrEqual(20)

      // All ranks should be positive
      for (const node of result.nodes) {
        expect(node.rank).toBeGreaterThan(0)
      }

      // Results should be sorted by rank descending
      for (let i = 1; i < result.nodes.length; i++) {
        expect(result.nodes[i - 1].rank).toBeGreaterThanOrEqual(result.nodes[i].rank)
      }
    })

    it('should respect top_n limit', async () => {
      const result = await handlePageRank({ ...baseArgs, top_n: 3 }, duckdb)

      expect(result.nodes.length).toBe(3)
    })

    it('should handle empty graph', async () => {
      await duckdb.executeQuery('CREATE TABLE empty_nodes (var_id INTEGER)')
      await duckdb.executeQuery(
        'CREATE TABLE empty_edges (from_var INTEGER, to_var INTEGER, confidence DOUBLE)'
      )

      const result = await handlePageRank(
        { ...baseArgs, node_table: 'empty_nodes', edge_table: 'empty_edges' },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.nodes).toEqual([])
      expect(result.total_nodes).toBe(0)
    })
  })

  describe('F1: graph.eigenvector', () => {
    it('should compute eigenvector centrality', async () => {
      const result = await handleEigenvector({ ...baseArgs, iterations: 30 }, duckdb)

      expect(result.success).toBe(true)
      expect(result.algorithm).toBe('eigenvector')
      expect(result.nodes.length).toBeGreaterThan(0)

      // Scores should be normalized between 0 and 1
      for (const node of result.nodes) {
        expect(node.score).toBeGreaterThanOrEqual(0)
        expect(node.score).toBeLessThanOrEqual(1.001) // small epsilon
      }

      // At least one node should have score = 1.0 (the max)
      const maxScore = Math.max(...result.nodes.map((n) => n.score))
      expect(maxScore).toBeCloseTo(1.0, 1)
    })
  })

  // ── F2: Community Detection ──────────────────────────────

  describe('F2: graph.community_detect', () => {
    it('should detect communities', async () => {
      const result = await handleCommunityDetect(baseArgs, duckdb)

      expect(result.success).toBe(true)
      expect(result.algorithm).toBe('label_propagation')
      expect(result.num_communities).toBeGreaterThan(0)
      expect(result.node_assignments.length).toBe(6)

      // Every node should have a community
      const assignedNodeIds = result.node_assignments.map((a) => a.node_id)
      expect(assignedNodeIds.length).toBe(6)

      // Total members across all communities = total nodes
      const totalMembers = result.communities.reduce((sum, c) => sum + c.size, 0)
      expect(totalMembers).toBe(6)
    })

    it('should converge within max_iterations', async () => {
      const result = await handleCommunityDetect({ ...baseArgs, max_iterations: 15 }, duckdb)

      expect(result.iterations_used).toBeLessThanOrEqual(15)
    })
  })

  describe('F2: graph.modularity', () => {
    it('should compute modularity score', async () => {
      const result = await handleModularity(baseArgs, duckdb)

      expect(result.success).toBe(true)
      expect(result.algorithm).toBe('modularity')
      // Modularity is between -0.5 and 1
      expect(result.modularity).toBeGreaterThanOrEqual(-0.5)
      expect(result.modularity).toBeLessThanOrEqual(1)
      expect(result.total_edges).toBeGreaterThan(0)
    })
  })

  // ── F3: Weighted Paths ───────────────────────────────────

  describe('F3: graph.weighted_path', () => {
    it('should find strongest path from source to target', async () => {
      const result = await handleWeightedPath(
        { ...baseArgs, source_node: 1, target_node: 6, mode: 'strongest', max_hops: 6 },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.algorithm).toBe('weighted_path')
      expect(result.mode).toBe('strongest')

      if (result.paths.length > 0) {
        const path = result.paths[0]
        expect(path.source).toBe(1)
        expect(path.target).toBe(6)
        expect(path.total_weight).toBeGreaterThan(0)
        expect(path.hops).toBeGreaterThanOrEqual(1)
      }
    })

    it('should find cheapest path', async () => {
      const result = await handleWeightedPath(
        { ...baseArgs, source_node: 1, target_node: 6, mode: 'cheapest', max_hops: 6 },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.mode).toBe('cheapest')

      if (result.paths.length > 0) {
        expect(result.paths[0].total_weight).toBeGreaterThanOrEqual(0)
      }
    })

    it('should find paths to all reachable nodes when no target', async () => {
      const result = await handleWeightedPath(
        { ...baseArgs, source_node: 1, mode: 'strongest', max_hops: 6 },
        duckdb
      )

      expect(result.success).toBe(true)
      // Should find paths to multiple nodes (at least B, C, D since A connects to them)
      expect(result.paths.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── F4: Temporal ─────────────────────────────────────────

  describe('F4: graph.temporal_filter', () => {
    it('should filter by period and return stats', async () => {
      const result = await handleTemporalFilter(
        { ...baseArgs, period_column: 'period', period_value: 'P1' },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.algorithm).toBe('temporal_filter')
      expect(result.period_value).toBe('P1')
      expect(result.edge_count).toBe(10) // 10 edges in P1
      expect(result.node_count).toBe(6) // all 6 nodes active in P1
      expect(result.avg_weight).toBeGreaterThan(0)
      expect(result.density).toBeGreaterThan(0)
    })

    it('should return fewer edges for P2', async () => {
      const result = await handleTemporalFilter(
        { ...baseArgs, period_column: 'period', period_value: 'P2' },
        duckdb
      )

      expect(result.edge_count).toBe(5) // 5 edges in P2
    })
  })

  describe('F4: graph.compare_periods', () => {
    it('should compare two periods and classify changes', async () => {
      const result = await handleComparePeriods(
        { ...baseArgs, period_column: 'period', period_a: 'P1', period_b: 'P2' },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.algorithm).toBe('compare_periods')
      expect(result.period_a.edge_count).toBe(10)
      expect(result.period_b.edge_count).toBe(5)

      // Should detect changes
      expect(result.changes.length).toBeGreaterThan(0)

      // Summary should have all categories
      expect(result.summary).toHaveProperty('new_edges')
      expect(result.summary).toHaveProperty('removed_edges')
      expect(result.summary).toHaveProperty('strengthened')
      expect(result.summary).toHaveProperty('weakened')
      expect(result.summary).toHaveProperty('stable')

      // P1 has edges not in P2 → some removed
      expect(result.summary.removed_edges).toBeGreaterThan(0)
    })
  })

  // ── F5: Export ───────────────────────────────────────────

  describe('F5: graph.export', () => {
    it('should export as JSON in-memory', async () => {
      const result = await handleGraphExport({ ...baseArgs, format: 'json' }, duckdb)

      expect(result.success).toBe(true)
      expect(result.format).toBe('json')
      expect(result.node_count).toBe(6)
      expect(result.edge_count).toBe(15) // 10 P1 + 5 P2
      expect(result.data).toBeDefined()

      const data = result.data as any
      expect(data.nodes.length).toBe(6)
      expect(data.edges.length).toBe(15)
    })

    it('should export as D3 format', async () => {
      const result = await handleGraphExport({ ...baseArgs, format: 'd3' }, duckdb)

      expect(result.success).toBe(true)
      expect(result.format).toBe('d3')

      const data = result.data as any
      expect(data).toHaveProperty('nodes')
      expect(data).toHaveProperty('links')
      expect(data.nodes.length).toBe(6)
      expect(data.links.length).toBe(15)
      expect(data.links[0]).toHaveProperty('source')
      expect(data.links[0]).toHaveProperty('target')
      expect(data.links[0]).toHaveProperty('value')
    })

    it('should export as CSV in-memory', async () => {
      const result = await handleGraphExport({ ...baseArgs, format: 'csv' }, duckdb)

      expect(result.success).toBe(true)
      expect(result.format).toBe('csv')

      const data = result.data as any
      expect(data.nodes[0]).toHaveProperty('Id')
      expect(data.edges[0]).toHaveProperty('Source')
      expect(data.edges[0]).toHaveProperty('Target')
    })

    it('should export as GraphML', async () => {
      const result = await handleGraphExport({ ...baseArgs, format: 'graphml' }, duckdb)

      expect(result.success).toBe(true)
      expect(result.format).toBe('graphml')

      const xml = result.data as string
      expect(xml).toContain('<?xml')
      expect(xml).toContain('<graphml')
      expect(xml).toContain('<node')
      expect(xml).toContain('<edge')
    })

    it('should export as parquet to file', async () => {
      const outputPath = join(tmpDir, 'graph.parquet')
      const result = await handleGraphExport(
        { ...baseArgs, format: 'parquet', output_path: outputPath },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.format).toBe('parquet')
      expect(result.output_path).toBe(outputPath)
    })

    it('should export JSON to file', async () => {
      const outputPath = join(tmpDir, 'graph.json')
      const result = await handleGraphExport(
        { ...baseArgs, format: 'json', output_path: outputPath },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.output_path).toBe(outputPath)
    })
  })
})
