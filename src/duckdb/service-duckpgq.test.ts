/**
 * DuckDB 2.0 (experimental) - DuckPGQ SQL/PGQ grammar opt-in
 *
 * On DuckDB >= 2.0 the DuckPGQ parser extension is only consulted on a
 * connection that ran `SET active_grammar_extensions = ['duckpgq']`; without it
 * `CREATE PROPERTY GRAPH` and `GRAPH_TABLE` fail with a Parser Error. On 1.x the
 * setting does not exist (the grammar is always active) and must not be issued.
 *
 * The opt-in has to happen inside initialize(), BEFORE the engine sandbox seals
 * the configuration: `lock_configuration=true` rejects any later SET.
 *
 * Contract under test:
 *   1. 2.x engine: GRAPH_TABLE works right after initialize()
 *   2. 2.x engine + sandbox 'strict': GRAPH_TABLE still works (the opt-in
 *      precedes the configuration lock) and cannot be redone afterwards
 *   3. opt-in failure degrades like other DuckPGQ load failures (warn, throw
 *      only in DUCKPGQ_STRICT_MODE) - fault-injected, so engine/network independent
 *   4. 1.x engine: the opt-in is never issued (behaviour unchanged)
 *
 * Tests 1-2 skip themselves, with a reason, on a 1.x engine and when the DuckPGQ
 * community extension cannot be installed (offline CI, unsupported platform).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { DuckDBService, type DuckDBServiceConfig } from './service.js'
import { logger } from '../utils/logger.js'

const ENV_KEYS = [
  'ENABLE_DUCKPGQ',
  'DUCKPGQ_SOURCE',
  'DUCKPGQ_CUSTOM_REPO',
  'DUCKPGQ_VERSION',
  'DUCKPGQ_STRICT_MODE',
  'ENABLE_ONAGER',
  'MCP_SANDBOX',
  'MCP_SECURITY_MODE',
] as const

function resetEnv(): void {
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined)
}

/** 'v2.0.0' -> 2 (NaN when the string is not a DuckDB version). */
function majorOf(version: string): number {
  return Number(/^v?(\d+)\./.exec(version)?.[1])
}

const PROPERTY_GRAPH = `CREATE PROPERTY GRAPH pgq_social
  VERTEX TABLES (pgq_person)
  EDGE TABLES (pgq_knows SOURCE KEY (src) REFERENCES pgq_person(id)
                         DESTINATION KEY (dst) REFERENCES pgq_person(id))`

async function seedGraph(svc: DuckDBService): Promise<void> {
  await svc.executeQuery('CREATE TABLE pgq_person(id INTEGER, name VARCHAR)')
  await svc.executeQuery("INSERT INTO pgq_person VALUES (1, 'Ann'), (2, 'Bob'), (3, 'Cy')")
  await svc.executeQuery('CREATE TABLE pgq_knows(src INTEGER, dst INTEGER)')
  await svc.executeQuery('INSERT INTO pgq_knows VALUES (1, 2), (2, 3)')
  await svc.executeQuery(PROPERTY_GRAPH)
}

async function expectGraphQueriesWork(svc: DuckDBService): Promise<void> {
  const oneHop = await svc.executeQuery(`
    SELECT * FROM GRAPH_TABLE(pgq_social
      MATCH (a:pgq_person)-[k:pgq_knows]->(b:pgq_person)
      COLUMNS(a.name AS src, b.name AS dst)
    ) ORDER BY src, dst`)
  expect(oneHop).toEqual([
    { src: 'Ann', dst: 'Bob' },
    { src: 'Bob', dst: 'Cy' },
  ])

  const shortest = await svc.executeQuery(`
    SELECT * FROM GRAPH_TABLE(pgq_social
      MATCH p = ANY SHORTEST (a:pgq_person WHERE a.name = 'Ann')-[k:pgq_knows]->*(b:pgq_person WHERE b.name = 'Cy')
      COLUMNS(a.name AS src, b.name AS dst, path_length(p) AS hops)
    )`)
  expect(shortest).toHaveLength(1)
  expect(shortest[0]).toMatchObject({ src: 'Ann', dst: 'Cy' })
  expect(Number(shortest[0].hops)).toBe(2)
}

describe('DuckPGQ SQL/PGQ grammar opt-in', () => {
  const services: DuckDBService[] = []
  // Filled once by beforeAll from an unhardened probe instance.
  let engine = { version: 'unknown', major: NaN, duckpgqLoaded: false }

  async function create(config: Partial<DuckDBServiceConfig> = {}): Promise<DuckDBService> {
    const svc = new DuckDBService({ memory: '256MB', threads: 1, ...config })
    services.push(svc)
    return svc
  }

  beforeAll(async () => {
    resetEnv()
    // duckdb_extensions() scans local directories, so it is unavailable once the
    // sandbox is applied: probe with an unhardened instance.
    const probe = new DuckDBService({
      memory: '256MB',
      threads: 1,
      allowUnsignedExtensions: true,
      sandbox: 'off',
    })
    try {
      await probe.initialize()
      const [{ version }] = await probe.executeQuery<{ version: string }>(
        'SELECT version() AS version'
      )
      const loaded = await probe.executeQuery<{ loaded: boolean }>(
        "SELECT loaded FROM duckdb_extensions() WHERE extension_name = 'duckpgq'"
      )
      engine = { version, major: majorOf(version), duckpgqLoaded: loaded[0]?.loaded === true }
    } finally {
      await probe.close()
      vi.unstubAllEnvs()
    }
  }, 120_000)

  beforeEach(() => {
    resetEnv()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(services.splice(0).map((svc) => svc.close()))
    vi.unstubAllEnvs()
  })

  describe('real engine', () => {
    function requireGrammarOptIn(skip: (condition: boolean, note?: string) => void): void {
      skip(
        !(engine.major >= 2),
        `DuckDB ${engine.version}: the SQL/PGQ grammar is always active on 1.x, the opt-in applies to >= 2.0`
      )
      skip(
        !engine.duckpgqLoaded,
        'DuckPGQ community extension unavailable (offline or unsupported platform)'
      )
    }

    it('GRAPH_TABLE works right after initialize() on a 2.x engine', async (ctx) => {
      requireGrammarOptIn(ctx.skip)
      const svc = await create({ allowUnsignedExtensions: true })
      await svc.initialize()
      await seedGraph(svc)
      await expectGraphQueriesWork(svc)
    }, 60_000)

    it('enables the grammar before the sandbox seals the configuration (strict)', async (ctx) => {
      requireGrammarOptIn(ctx.skip)
      const svc = await create({ allowUnsignedExtensions: true, sandbox: 'strict' })
      await svc.initialize()
      expect(svc.sandboxLevel).toBe('strict')
      expect(
        await svc.executeScalar("SELECT current_setting('lock_configuration') AS locked")
      ).toEqual({ locked: true })

      await seedGraph(svc)
      await expectGraphQueriesWork(svc)

      // Control: this is why the order matters. Once sealed, the opt-in is rejected.
      await expect(svc.executeQuery("SET active_grammar_extensions = ['duckpgq']")).rejects.toThrow(
        /locked/i
      )
    }, 60_000)
  })

  describe('control flow (fault-injected, independent of engine and network)', () => {
    /**
     * Pretend that INSTALL + LOAD succeeded, report `engineVersion` for version(), and
     * answer the grammar opt-in locally (optionally failing it). Everything else is
     * forwarded to the real engine, so sandbox hardening still runs for real.
     */
    function stubConnection(engineVersion: string, grammarFailure?: Error): string[] {
      const statements: string[] = []
      const connect = DuckDBInstance.prototype.connect
      vi.spyOn(DuckDBInstance.prototype, 'connect').mockImplementation(async function (
        this: DuckDBInstance
      ) {
        const connection: DuckDBConnection = await connect.call(this)
        const run = connection.run.bind(connection)
        vi.spyOn(connection, 'run').mockImplementation((async (sql: string, ...rest: unknown[]) => {
          statements.push(sql)
          if (/INSTALL duckpgq/.test(sql)) return undefined
          if (/version\(\)/i.test(sql))
            return { getRowObjectsJson: async () => [{ version: engineVersion }] }
          if (/active_grammar_extensions/.test(sql)) {
            if (grammarFailure) throw grammarFailure
            return undefined
          }
          return (run as (...args: unknown[]) => unknown)(sql, ...rest)
        }) as unknown as DuckDBConnection['run'])
        return connection
      })
      return statements
    }

    const OPT_IN = "SET active_grammar_extensions = ['duckpgq']"

    it('issues the opt-in on a 2.x engine, before the configuration lock', async () => {
      const statements = stubConnection('v2.0.0')
      const svc = await create({ allowUnsignedExtensions: true, sandbox: 'strict' })
      await svc.initialize()

      const optIn = statements.findIndex((sql) => sql.trim() === OPT_IN)
      const lock = statements.findIndex((sql) => /lock_configuration\s*=\s*true/i.test(sql))
      expect(optIn).toBeGreaterThan(-1)
      expect(lock).toBeGreaterThan(-1)
      expect(optIn).toBeLessThan(lock)
      expect(statements.filter((sql) => /active_grammar_extensions/.test(sql))).toHaveLength(1)
    })

    it('never issues the opt-in on a 1.x engine (behaviour unchanged)', async () => {
      const statements = stubConnection('v1.5.4', new Error('must not be issued on 1.x'))
      const warn = vi.spyOn(logger, 'warn')
      const svc = await create({ allowUnsignedExtensions: true })
      await svc.initialize()

      expect(svc.isReady()).toBe(true)
      expect(statements.some((sql) => /active_grammar_extensions/.test(sql))).toBe(false)
      expect(warn).not.toHaveBeenCalled()
    })

    it('warns and keeps the service usable when the opt-in fails (non-strict)', async () => {
      stubConnection('v2.0.0', new Error('injected grammar failure'))
      const warn = vi.spyOn(logger, 'warn')
      const svc = await create({ allowUnsignedExtensions: true })

      await expect(svc.initialize()).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('injected grammar failure'))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('active_grammar_extensions'))
      expect(svc.isReady()).toBe(true)
      expect(await svc.executeQuery('SELECT 42 AS answer')).toEqual([{ answer: 42 }])
    })

    it('throws only in DUCKPGQ_STRICT_MODE when the opt-in fails', async () => {
      stubConnection('v2.0.0', new Error('injected grammar failure'))
      vi.stubEnv('DUCKPGQ_STRICT_MODE', 'true')
      const svc = await create({ allowUnsignedExtensions: true })

      await expect(svc.initialize()).rejects.toThrow(/strict mode.*injected grammar failure/i)
      expect(svc.isReady()).toBe(false)
    })
  })
})
