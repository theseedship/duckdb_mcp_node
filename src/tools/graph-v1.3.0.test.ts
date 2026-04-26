/**
 * v1.3.0 — additive features
 *
 * Three things ship in v1.3.0; this file covers each by contract:
 *   1. AVAILABLE_OPS — discovery API for host-side boot validation
 *   2. validateGraphTables `previewNodes` opt-in — must NOT cost an extra
 *      query unless the caller asks for it
 *   3. Helper utilities are reachable from the package root entry point
 *      (smoke-import test — protects against future refactors that
 *      accidentally drop the export)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DuckDBService } from '../duckdb/service.js'
import { validateGraphTables } from './graph-utils.js'
import { AVAILABLE_OPS } from './available-ops.js'
import * as packageRoot from '../index.js'

describe('v1.3.0: AVAILABLE_OPS discovery API', () => {
  it('every entry has the required shape', () => {
    expect(AVAILABLE_OPS.length).toBeGreaterThan(0)
    for (const op of AVAILABLE_OPS) {
      expect(typeof op.name).toBe('string')
      expect(op.name).toMatch(/^(graph|process|data)\./)
      expect(['graph', 'process', 'data']).toContain(op.family)
      expect(typeof op.description).toBe('string')
      expect(op.description.length).toBeGreaterThan(10)
      expect(['cheap', 'medium', 'heavy']).toContain(op.costClass)
      expect(Array.isArray(op.inputs)).toBe(true)
      expect(op.inputs.length).toBeGreaterThan(0)
      for (const input of op.inputs) {
        expect(typeof input).toBe('string')
      }
    }
  })

  it('lists every graph handler shipped in S2', () => {
    const names = AVAILABLE_OPS.map((op) => op.name)
    const expectedGraphOps = [
      'graph.pagerank',
      'graph.eigenvector',
      'graph.community_detect',
      'graph.modularity',
      'graph.weighted_path',
      'graph.temporal_filter',
      'graph.compare_periods',
      'graph.export',
    ]
    for (const expected of expectedGraphOps) {
      expect(names).toContain(expected)
    }
  })

  it('lists every process op shipped in P2.8/P2.9', () => {
    const names = AVAILABLE_OPS.map((op) => op.name)
    expect(names).toContain('process.describe')
    expect(names).toContain('process.similar')
    expect(names).toContain('process.compose')
  })

  it('has no duplicate op names', () => {
    const names = AVAILABLE_OPS.map((op) => op.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it('every graph op declares the GraphInputBase fields', () => {
    const baseFields = ['node_table', 'edge_table']
    for (const op of AVAILABLE_OPS.filter((o) => o.family === 'graph')) {
      for (const field of baseFields) {
        expect(op.inputs).toContain(field)
      }
    }
  })
})

describe('v1.3.0: validateGraphTables previewNodes opt-in', () => {
  let duckdb: DuckDBService

  beforeEach(async () => {
    duckdb = new DuckDBService({ memory: '256MB', threads: 1 })
    await duckdb.initialize()
    await duckdb.executeQuery(`
      CREATE TABLE nodes (id VARCHAR PRIMARY KEY, name VARCHAR)
    `)
    await duckdb.executeQuery(`
      INSERT INTO nodes VALUES
        ('n1', 'Alice'), ('n2', 'Bob'), ('n3', 'Carol'),
        ('n4', 'Dan'), ('n5', 'Eve')
    `)
    await duckdb.executeQuery(`
      CREATE TABLE edges (src VARCHAR, dst VARCHAR)
    `)
    await duckdb.executeQuery(`
      INSERT INTO edges VALUES
        ('n1', 'n2'), ('n2', 'n3'), ('n3', 'n4'), ('n4', 'n5')
    `)
  })

  afterEach(async () => {
    await duckdb.close()
  })

  const baseConfig = {
    node_table: 'nodes',
    edge_table: 'edges',
    node_id_column: 'id',
    source_column: 'src',
    target_column: 'dst',
  }

  it('does NOT include topNodesPreview when previewNodes is unset (default backward-compat)', async () => {
    const result = await validateGraphTables(duckdb, baseConfig)
    expect(result.nodeCount).toBe(5)
    expect(result.distinctNodeCount).toBe(5)
    expect(result.edgeCount).toBe(4)
    expect(result.topNodesPreview).toBeUndefined()
  })

  it('does NOT include topNodesPreview when previewNodes is 0 or negative', async () => {
    const r1 = await validateGraphTables(duckdb, baseConfig, { previewNodes: 0 })
    expect(r1.topNodesPreview).toBeUndefined()
    const r2 = await validateGraphTables(duckdb, baseConfig, { previewNodes: -5 })
    expect(r2.topNodesPreview).toBeUndefined()
  })

  it('returns topNodesPreview with up to N distinct ids when requested', async () => {
    const result = await validateGraphTables(duckdb, baseConfig, { previewNodes: 3 })
    expect(result.topNodesPreview).toBeDefined()
    expect(Array.isArray(result.topNodesPreview)).toBe(true)
    expect(result.topNodesPreview!.length).toBe(3)
    // Each id must be a known node id
    const known = new Set(['n1', 'n2', 'n3', 'n4', 'n5'])
    for (const id of result.topNodesPreview!) {
      expect(known.has(String(id))).toBe(true)
    }
  })

  it('caps topNodesPreview at 100 even if caller asks for more', async () => {
    const result = await validateGraphTables(duckdb, baseConfig, { previewNodes: 1000 })
    expect(result.topNodesPreview).toBeDefined()
    // We only have 5 nodes total — preview returns DISTINCT ids capped
    // by both LIMIT(min(N, 100)) and the actual data
    expect(result.topNodesPreview!.length).toBeLessThanOrEqual(100)
    expect(result.topNodesPreview!.length).toBe(5)
  })

  it('omits topNodesPreview when graph is empty (distinctNodeCount === 0)', async () => {
    await duckdb.executeQuery(`DELETE FROM nodes`)
    const result = await validateGraphTables(duckdb, baseConfig, { previewNodes: 5 })
    expect(result.distinctNodeCount).toBe(0)
    // No preview query runs when there are no nodes — nothing to preview
    expect(result.topNodesPreview).toBeUndefined()
  })

  it('respects the filter clause when computing the preview', async () => {
    // Filter: only ids starting with 'n1' or 'n2'
    const result = await validateGraphTables(
      duckdb,
      { ...baseConfig, filter: "id IN ('n1', 'n2')" },
      { previewNodes: 10 }
    )
    expect(result.distinctNodeCount).toBe(2)
    expect(result.topNodesPreview).toBeDefined()
    expect(result.topNodesPreview!.length).toBe(2)
    const ids = new Set(result.topNodesPreview!.map(String))
    expect(ids).toEqual(new Set(['n1', 'n2']))
  })
})

describe('v1.3.0: package-root smoke imports', () => {
  it('exports the new graph helper utilities', () => {
    expect(typeof packageRoot.validateGraphTables).toBe('function')
    expect(typeof packageRoot.buildNodeSubquery).toBe('function')
    expect(typeof packageRoot.buildEdgeSubquery).toBe('function')
    expect(typeof packageRoot.getColumnRefs).toBe('function')
    expect(typeof packageRoot.tempTablePrefix).toBe('function')
    expect(typeof packageRoot.dropTempTable).toBe('function')
    expect(typeof packageRoot.cleanupTempTables).toBe('function')
  })

  it('exports AVAILABLE_OPS as a non-empty array', () => {
    expect(Array.isArray(packageRoot.AVAILABLE_OPS)).toBe(true)
    expect(packageRoot.AVAILABLE_OPS.length).toBeGreaterThan(0)
  })

  it('helpers from the package root are the same instances as the internal exports', async () => {
    const internal = await import('./graph-utils.js')
    expect(packageRoot.validateGraphTables).toBe(internal.validateGraphTables)
    expect(packageRoot.buildNodeSubquery).toBe(internal.buildNodeSubquery)
  })
})
