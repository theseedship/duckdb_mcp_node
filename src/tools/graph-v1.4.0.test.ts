/**
 * v1.4.0 — additive features
 *
 *   1. GraphError class + structured codes (B.2)
 *      - extends Error so existing message-based code keeps working
 *      - validateGraphTables classifies filter errors as INVALID_FILTER
 *      - handlers wrap their catch errors as GraphError
 *
 *   2. ComputeSession.metrics() (B.4)
 *      - sessions opened by openComputeSession track queries_run,
 *        total_duration_ms, last_query_at, errors_count
 *      - metrics() returns a defensive copy (mutation isolation)
 *      - error path increments errors_count and still updates queries_run
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DuckDBService } from '../duckdb/service.js'
import { openComputeSession } from '../compute-session.js'
import { GraphError } from '../errors/graph-errors.js'
import { handlePageRank } from './graph-centrality.js'
import { validateGraphTables } from './graph-utils.js'
import * as packageRoot from '../index.js'

describe('v1.4.0: GraphError', () => {
  it('extends Error and carries a code', () => {
    const err = new GraphError('NO_NODES', 'graph is empty')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(GraphError)
    expect(err.message).toBe('graph is empty')
    expect(err.code).toBe('NO_NODES')
    expect(err.name).toBe('GraphError')
  })

  it('preserves the original error as cause when provided', () => {
    const original = new Error('underlying duckdb error')
    const err = new GraphError('INFRA', 'wrapping', { cause: original })
    expect((err as Error & { cause?: unknown }).cause).toBe(original)
  })

  describe('fromUnknown', () => {
    it('returns the same instance if already a GraphError', () => {
      const original = new GraphError('NO_PATH', 'no route')
      const wrapped = GraphError.fromUnknown(original)
      expect(wrapped).toBe(original)
    })

    it('classifies a Binder error against a filter as INVALID_FILTER', () => {
      const err = new Error('Binder Error: column "missing_col" does not exist')
      const wrapped = GraphError.fromUnknown(err, { context: 'filter' })
      expect(wrapped.code).toBe('INVALID_FILTER')
      expect(wrapped.message).toContain('Binder Error')
    })

    it('classifies a Catalog/Parser error against a filter as INVALID_FILTER', () => {
      const c = GraphError.fromUnknown(new Error('Catalog Error: nope'), { context: 'filter' })
      expect(c.code).toBe('INVALID_FILTER')
      const p = GraphError.fromUnknown(new Error('Parser Error: bad SQL'), { context: 'filter' })
      expect(p.code).toBe('INVALID_FILTER')
    })

    it('does NOT classify Binder errors without filter context', () => {
      const err = new Error('Binder Error: something else')
      const wrapped = GraphError.fromUnknown(err) // no context
      expect(wrapped.code).toBe('INFRA')
    })

    it('classifies timeout patterns as TIMEOUT regardless of context', () => {
      const t1 = GraphError.fromUnknown(new Error('Query timeout exceeded'))
      expect(t1.code).toBe('TIMEOUT')
      const t2 = GraphError.fromUnknown(new Error('Operation timed out after 30s'))
      expect(t2.code).toBe('TIMEOUT')
    })

    it('falls back to INFRA for anything unrecognised', () => {
      const wrapped = GraphError.fromUnknown(new Error('mysterious failure'))
      expect(wrapped.code).toBe('INFRA')
    })

    it('handles non-Error values (string, undefined)', () => {
      const w1 = GraphError.fromUnknown('a string error')
      expect(w1.code).toBe('INFRA')
      expect(w1.message).toBe('a string error')
      const w2 = GraphError.fromUnknown(undefined)
      expect(w2.code).toBe('INFRA')
    })
  })

  describe('integration: validateGraphTables surfaces INVALID_FILTER', () => {
    let duckdb: DuckDBService

    beforeEach(async () => {
      duckdb = new DuckDBService({ memory: '256MB', threads: 1 })
      await duckdb.initialize()
      await duckdb.executeQuery(`CREATE TABLE n (id VARCHAR PRIMARY KEY)`)
      await duckdb.executeQuery(`INSERT INTO n VALUES ('a'), ('b')`)
      await duckdb.executeQuery(`CREATE TABLE e (src VARCHAR, dst VARCHAR)`)
    })

    afterEach(async () => {
      await duckdb.close()
    })

    it('throws GraphError(INVALID_FILTER) when the filter references a missing column', async () => {
      let caught: unknown
      try {
        await validateGraphTables(duckdb, {
          node_table: 'n',
          edge_table: 'e',
          node_id_column: 'id',
          source_column: 'src',
          target_column: 'dst',
          filter: 'this_column_does_not_exist = 1',
        })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(GraphError)
      expect((caught as GraphError).code).toBe('INVALID_FILTER')
    })

    it('throws GraphError(INFRA) when the table itself does not exist', async () => {
      let caught: unknown
      try {
        await validateGraphTables(duckdb, {
          node_table: 'nope_does_not_exist',
          edge_table: 'e',
          node_id_column: 'id',
          source_column: 'src',
          target_column: 'dst',
        })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(GraphError)
      // No filter set → context: 'query' → Binder/Catalog stays INFRA
      expect((caught as GraphError).code).toBe('INFRA')
    })
  })
})

describe('v1.4.0: ComputeSession.metrics()', () => {
  let duckdb: DuckDBService

  beforeEach(async () => {
    duckdb = new DuckDBService({ memory: '256MB', threads: 1 })
    await duckdb.initialize()
  })

  afterEach(async () => {
    await duckdb.close()
  })

  it('starts at zero', () => {
    const session = openComputeSession(duckdb)
    const m = session.metrics!()
    expect(m).toEqual({
      queries_run: 0,
      total_duration_ms: 0,
      last_query_at: null,
      errors_count: 0,
    })
  })

  it('increments queries_run and updates last_query_at on success', async () => {
    const session = openComputeSession(duckdb)
    await session.exec('SELECT 1 AS x')
    const m1 = session.metrics!()
    expect(m1.queries_run).toBe(1)
    expect(m1.errors_count).toBe(0)
    expect(m1.last_query_at).not.toBeNull()
    expect(m1.total_duration_ms).toBeGreaterThanOrEqual(0)

    await session.exec('SELECT 2 AS x')
    const m2 = session.metrics!()
    expect(m2.queries_run).toBe(2)
    expect(m2.errors_count).toBe(0)
    expect(m2.last_query_at).toBeGreaterThanOrEqual(m1.last_query_at!)
  })

  it('increments errors_count when exec throws, and still counts the query', async () => {
    const session = openComputeSession(duckdb)
    await expect(session.exec('SELECT * FROM no_such_table')).rejects.toThrow()
    const m = session.metrics!()
    expect(m.queries_run).toBe(1)
    expect(m.errors_count).toBe(1)
    expect(m.last_query_at).not.toBeNull()
  })

  it('returns a defensive copy — mutating the result does not affect the session', async () => {
    const session = openComputeSession(duckdb)
    await session.exec('SELECT 1')
    const snap = session.metrics!()
    snap.queries_run = 999
    const fresh = session.metrics!()
    expect(fresh.queries_run).toBe(1)
  })

  it('does not double-instrument when openComputeSession is called twice', async () => {
    const session = openComputeSession(duckdb)
    const passthrough = openComputeSession(session)
    // Same instance — passthrough must not re-wrap
    expect(passthrough).toBe(session)
    await passthrough.exec('SELECT 1')
    const m = session.metrics!()
    expect(m.queries_run).toBe(1)
  })

  it('integrates: handlePageRank fills the session metrics for the host', async () => {
    await duckdb.executeQuery(`CREATE TABLE pg_n (id VARCHAR PRIMARY KEY)`)
    await duckdb.executeQuery(`INSERT INTO pg_n VALUES ('a'),('b'),('c')`)
    await duckdb.executeQuery(`CREATE TABLE pg_e (src VARCHAR, dst VARCHAR)`)
    await duckdb.executeQuery(`INSERT INTO pg_e VALUES ('a','b'),('b','c'),('c','a'),('a','c')`)
    const session = openComputeSession(duckdb)
    const result = await handlePageRank(
      {
        node_table: 'pg_n',
        edge_table: 'pg_e',
        node_id_column: 'id',
        source_column: 'src',
        target_column: 'dst',
        iterations: 5,
        top_n: 3,
      },
      session
    )
    expect(result.success).toBe(true)
    const m = session.metrics!()
    // PageRank runs many statements (validation × 4-5, init × 2, iterations,
    // final SELECT, drops). We don't assert exact count — only that the
    // session counted them and timing is non-negative.
    expect(m.queries_run).toBeGreaterThan(5)
    expect(m.errors_count).toBe(0)
    expect(m.total_duration_ms).toBeGreaterThanOrEqual(0)
  })
})

describe('v1.4.0: package-root smoke imports', () => {
  it('exports GraphError as a class', () => {
    expect(typeof packageRoot.GraphError).toBe('function')
    const e = new packageRoot.GraphError('NO_PATH', 'test')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('NO_PATH')
  })

  it('GraphError from package root === internal GraphError', async () => {
    const internal = await import('../errors/graph-errors.js')
    expect(packageRoot.GraphError).toBe(internal.GraphError)
  })
})
