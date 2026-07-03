/**
 * v1.6.0 — optional Onager extension loading (ENABLE_ONAGER)
 *
 * Onager is opt-IN (alpha extension), unlike DuckPGQ which is opt-out.
 * Contract under test:
 *   1. Default: Onager is NOT loaded (onagerLoaded === false)
 *   2. ENABLE_ONAGER=true without allowUnsignedExtensions: NOT loaded
 *   3. ENABLE_ONAGER=true + allowUnsignedExtensions: loads when the
 *      community binary is reachable; on failure (offline CI, unsupported
 *      platform) the service MUST stay fully functional and the flag stays
 *      false — graceful degradation, never a crash.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { DuckDBService } from './service.js'

const ENV_KEYS = ['ENABLE_ONAGER', 'ONAGER_STRICT_MODE'] as const
const savedEnv: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) savedEnv[k] = process.env[k]

describe('v1.6.0: optional Onager loading', () => {
  let duckdb: DuckDBService | null = null

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
    if (duckdb) {
      await duckdb.close()
      duckdb = null
    }
  })

  it('does NOT load Onager by default (opt-in)', async () => {
    delete process.env.ENABLE_ONAGER
    duckdb = new DuckDBService({ memory: '256MB', threads: 1, allowUnsignedExtensions: true })
    await duckdb.initialize()
    expect(duckdb.onagerLoaded).toBe(false)
  })

  it('does NOT load Onager when allowUnsignedExtensions is false', async () => {
    process.env.ENABLE_ONAGER = 'true'
    duckdb = new DuckDBService({ memory: '256MB', threads: 1 })
    await duckdb.initialize()
    expect(duckdb.onagerLoaded).toBe(false)
  })

  it('loads Onager with ENABLE_ONAGER=true, or degrades gracefully when unavailable', async () => {
    process.env.ENABLE_ONAGER = 'true'
    duckdb = new DuckDBService({ memory: '256MB', threads: 1, allowUnsignedExtensions: true })
    await duckdb.initialize()

    if (duckdb.onagerLoaded) {
      // Binary reachable — the functions must actually work
      const v = await duckdb.executeQuery('SELECT onager_version() AS v')
      expect(typeof v[0]?.v).toBe('string')

      const rows = await duckdb.executeQuery(`
        SELECT * FROM onager_ctr_pagerank(
          (SELECT * FROM (VALUES (1::BIGINT, 2::BIGINT), (2::BIGINT, 3::BIGINT),
                                 (3::BIGINT, 1::BIGINT)) t(src, dst))
        ) ORDER BY node_id
      `)
      expect(rows.length).toBe(3)
      expect(Number(rows[0].rank)).toBeGreaterThan(0)
    } else {
      // Offline / unsupported platform — service must remain functional
      const r = await duckdb.executeQuery('SELECT 1 AS ok')
      expect(Number(r[0]?.ok)).toBe(1)
    }
  })

  it('never throws on load failure in non-strict mode (service stays usable)', async () => {
    process.env.ENABLE_ONAGER = 'true'
    delete process.env.ONAGER_STRICT_MODE
    duckdb = new DuckDBService({ memory: '256MB', threads: 1, allowUnsignedExtensions: true })
    // Must not reject regardless of network/platform state
    await expect(duckdb.initialize()).resolves.toBeUndefined()
    const r = await duckdb.executeQuery('SELECT 42 AS x')
    expect(Number(r[0]?.x)).toBe(42)
  })
})
