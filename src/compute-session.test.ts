/**
 * Tests for ComputeSession + openComputeSession factory.
 *
 * Covers the regression motivating its introduction: when the host service
 * routes reads and writes to different connections (deposium_MCPs pattern),
 * the plugin used to silently lose temp tables between CREATE and final
 * SELECT. The session-pinned executor fixes this.
 *
 * @since v1.2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi } from 'vitest'
import {
  openComputeSession,
  ensureSession,
  type ComputeSession,
  type DuckDBLike,
} from './compute-session.js'

describe('openComputeSession — factory', () => {
  it('passes through an existing ComputeSession (marker check)', async () => {
    const calls: string[] = []
    const session: ComputeSession = {
      _isComputeSession: true,
      async exec(sql: string) {
        calls.push(sql)
        return [{ ok: true }] as any
      },
    }
    const out = openComputeSession(session)
    expect(out).toBe(session) // same reference, no wrapping
    await out.exec('SELECT 1')
    expect(calls).toEqual(['SELECT 1'])
  })

  it('wraps a routed service (queryWrite present) so all queries pin to write connection', async () => {
    const writeCalls: string[] = []
    const readCalls: string[] = []
    const dbLike: DuckDBLike & { queryWrite: any } = {
      executeQuery: async (sql: string) => {
        readCalls.push(sql)
        return [] as any
      },
      queryWrite: async (sql: string) => {
        writeCalls.push(sql)
        return [{ pinned: true }] as any
      },
    }
    const session = openComputeSession(dbLike)
    expect(session._isComputeSession).toBe(true)

    await session.exec('CREATE TEMP TABLE foo AS SELECT 1 AS x')
    await session.exec('SELECT * FROM foo')
    await session.exec('DROP TABLE foo')

    // Critical: every call goes to queryWrite (the pinned write connection).
    // None route to executeQuery's auto-routing (which would have split
    // SELECT into the read pool and lost the temp table).
    expect(writeCalls).toEqual([
      'CREATE TEMP TABLE foo AS SELECT 1 AS x',
      'SELECT * FROM foo',
      'DROP TABLE foo',
    ])
    expect(readCalls).toEqual([])
  })

  it('falls back to executeQuery when no queryWrite is available (single-connection service)', async () => {
    const calls: string[] = []
    const dbLike: DuckDBLike = {
      executeQuery: async (sql: string) => {
        calls.push(sql)
        return [] as any
      },
    }
    const session = openComputeSession(dbLike)
    await session.exec('SELECT 1')
    await session.exec('CREATE TEMP TABLE bar AS SELECT 1 AS x')
    expect(calls).toEqual(['SELECT 1', 'CREATE TEMP TABLE bar AS SELECT 1 AS x'])
  })

  it('throws on inputs missing both exec and executeQuery', () => {
    expect(() => openComputeSession({} as any)).toThrow(/must be a ComputeSession/i)
    expect(() => openComputeSession(undefined as any)).toThrow()
  })

  it('does not wrap an already-wrapped session twice', async () => {
    const original: DuckDBLike = {
      executeQuery: vi.fn(async () => [] as any),
    }
    const first = openComputeSession(original)
    const second = openComputeSession(first)
    expect(second).toBe(first)
  })

  it('ensureSession is the same as openComputeSession (alias for backward-compat)', () => {
    const dbLike: DuckDBLike = {
      executeQuery: async () => [] as any,
    }
    const a = openComputeSession(dbLike)
    const b = ensureSession(dbLike)
    expect(a._isComputeSession).toBe(true)
    expect(b._isComputeSession).toBe(true)
  })
})

describe('ComputeSession — multi-connection regression scenario', () => {
  /**
   * Reproduces the deposium_MCPs DuckDBService routing pattern:
   * - executeQuery() looks at the SQL; reads go to a "read pool" stub,
   *   writes go to the "write connection" stub.
   * - Each "connection" maintains its own private TEMP table set.
   *
   * Without ComputeSession (raw executeQuery), the plugin's
   * `CREATE TEMP TABLE foo` would land on the write connection and the
   * subsequent `SELECT * FROM foo` would land on the read pool, which has
   * no `foo` — failing with `Catalog Error: Table foo does not exist`.
   *
   * With ComputeSession (queryWrite-aware factory), every statement pins
   * to the write connection and the temp table stays visible.
   */
  function makeRoutedHost() {
    // Each "connection" has its own temp tables map
    const writeTemps = new Set<string>()
    const readTemps = new Set<string>()

    const isWrite = (sql: string) => /\b(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE)\b/i.test(sql)

    return {
      writeTemps,
      readTemps,
      // Mimics deposium_MCPs DuckDBService: routes reads vs writes
      executeQuery: async (sql: string) => {
        const target = isWrite(sql) ? writeTemps : readTemps
        const m = sql.match(/CREATE TEMP TABLE (\w+)/i)
        if (m) {
          target.add(m[1])
          return [] as any[]
        }
        const sm = sql.match(/SELECT\s+\*\s+FROM\s+(\w+)/i)
        if (sm) {
          if (!target.has(sm[1])) {
            throw new Error(`Catalog Error: Table ${sm[1]} does not exist`)
          }
          return [{ ok: true }] as any[]
        }
        return [] as any[]
      },
      // The signal that this is a routed host: queryWrite always pins write
      queryWrite: async (sql: string) => {
        const m = sql.match(/CREATE TEMP TABLE (\w+)/i)
        if (m) {
          writeTemps.add(m[1])
          return [] as any[]
        }
        const sm = sql.match(/SELECT\s+\*\s+FROM\s+(\w+)/i)
        if (sm) {
          if (!writeTemps.has(sm[1])) {
            throw new Error(`Catalog Error: Table ${sm[1]} does not exist`)
          }
          return [{ ok: true }] as any[]
        }
        return [] as any[]
      },
    }
  }

  it('REGRESSION: raw executeQuery on a routed host loses temp tables across CREATE/SELECT', async () => {
    const host = makeRoutedHost()
    // Simulate the OLD plugin behavior: call executeQuery directly
    await host.executeQuery('CREATE TEMP TABLE foo AS SELECT 1')
    // Now query — without pinning, SELECT routes to the read pool which
    // has no foo → throws.
    await expect(host.executeQuery('SELECT * FROM foo')).rejects.toThrow(/does not exist/)
  })

  it('FIX: ComputeSession pins all queries to the write connection (queryWrite)', async () => {
    const host = makeRoutedHost()
    const session = openComputeSession(host)

    await session.exec('CREATE TEMP TABLE foo AS SELECT 1')
    const result = await session.exec('SELECT * FROM foo')
    expect(result).toEqual([{ ok: true }])

    // Critical invariant: temp lives in writeTemps, not readTemps
    expect(host.writeTemps.has('foo')).toBe(true)
    expect(host.readTemps.has('foo')).toBe(false)
  })
})
