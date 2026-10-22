import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { DuckDBService, type DuckDBServiceConfig } from './service.js'

// Requires an installed httpfs extension. Opt-in is explicit so a missing
// extension never masquerades as evidence that the network policy worked.
// DUCKDB_SANDBOX_NETWORK_TESTS=1 npm test -- --coverage.enabled=false src/duckdb/service.sandbox-network.test.ts
const networkTests = process.env.DUCKDB_SANDBOX_NETWORK_TESTS === '1'

describe.skipIf(!networkTests)('sandbox with loaded httpfs and a localhost canary', () => {
  let server: Server
  let endpoint: string
  let requests: string[]
  let services: DuckDBService[]

  beforeEach(async () => {
    services = []
    requests = []
    vi.stubEnv('MCP_SANDBOX', undefined)
    vi.stubEnv('MCP_SECURITY_MODE', 'production')
    const csv = 'value\nLOCAL_CANARY\n'
    server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`)
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Length', Buffer.byteLength(csv))
      res.end(req.method === 'HEAD' ? undefined : csv)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing localhost address')
    endpoint = `127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await Promise.all(services.map((svc) => svc.close()))
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    )
    vi.unstubAllEnvs()
  })

  async function mk(sandbox?: DuckDBServiceConfig['sandbox']): Promise<DuckDBService> {
    const svc = new DuckDBService({
      sandbox,
      s3Config: {
        endpoint,
        accessKey: 'CANARY_KEY',
        secretKey: 'CANARY_SECRET',
        useSSL: false,
      },
    })
    services.push(svc)
    await svc.initialize()
    // The httpfs-specific setting exists only after the extension is loaded.
    // duckdb_extensions() itself scans local directories and is sandboxed.
    expect(
      await svc.executeQuery("SELECT name FROM duckdb_settings() WHERE name='s3_region'")
    ).toEqual([{ name: 's3_region' }])
    return svc
  }

  it('default production blocks HTTP before a request, with a successful off-mode control', async () => {
    const control = await mk('off')
    const sql = `SELECT * FROM read_csv('http://${endpoint}/canary.csv')`
    expect(await control.executeQuery(sql)).toEqual([{ value: 'LOCAL_CANARY' }])
    expect(requests.length).toBeGreaterThan(0)
    requests.length = 0

    const protectedService = await mk()
    expect(protectedService.sandboxLevel).toBe('strict')
    await expect(protectedService.executeQuery(sql)).rejects.toThrow(/disabled/i)
    expect(requests).toEqual([])
  })

  it('default production blocks S3 access even when a temporary secret selects localhost', async () => {
    // The compatibility mode intentionally retains S3 access. This control
    // proves why lock_configuration by itself is not a network boundary.
    const compatibility = await mk('no-local-fs')
    const secret = `CREATE OR REPLACE TEMPORARY SECRET canary_secret (
      TYPE S3, KEY_ID 'CANARY_KEY', SECRET 'CANARY_SECRET',
      ENDPOINT '${endpoint}', REGION 'us-east-1', URL_STYLE 'path',
      USE_SSL false, SCOPE 's3://sandbox'
    )`
    const sql = "SELECT * FROM read_csv('s3://sandbox/canary.csv')"
    await compatibility.executeQuery(secret)
    expect(await compatibility.executeQuery(sql)).toEqual([{ value: 'LOCAL_CANARY' }])
    expect(requests.length).toBeGreaterThan(0)
    requests.length = 0

    const protectedService = await mk()
    await protectedService.executeQuery(secret)
    await expect(protectedService.executeQuery(sql)).rejects.toThrow(/disabled/i)
    expect(requests).toEqual([])
  })
  it('does not expose ambient AWS_* credentials through settings in hardened levels', async () => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'ENVCANARYKEYID0000')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'ENVCANARYSECRETVALUE0000')
    vi.stubEnv('AWS_SESSION_TOKEN', 'ENVCANARYSESSIONTOKEN')
    const settingsSql = `SELECT name, value FROM duckdb_settings() WHERE name LIKE 's3_%'`

    // current_setting() is the read path that survives on DuckDB 2.0, where the
    // legacy names are no longer listed by duckdb_settings().
    const directSql = `SELECT current_setting('s3_access_key_id') AS k, current_setting('s3_secret_access_key') AS s, current_setting('s3_session_token') AS t`

    // Control: without a sandbox the harness really sees the imported values.
    const control = await mk('off')
    expect(JSON.stringify(await control.executeQuery(settingsSql))).toContain('ENVCANARY')
    expect(JSON.stringify(await control.executeQuery(directSql))).toContain('ENVCANARY')

    for (const level of ['strict', 'no-local-fs'] as const) {
      const svc = await mk(level)
      expect(JSON.stringify(await svc.executeQuery(settingsSql))).not.toContain('ENVCANARY')
      const direct = await svc.executeQuery<{ k: unknown; s: unknown; t: unknown }>(directSql)
      expect(direct).toEqual([{ k: null, s: null, t: null }])
    }
  })
})
