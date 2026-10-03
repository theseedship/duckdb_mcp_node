import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DuckDBService, type DuckDBServiceConfig } from './service.js'

describe('DuckDBService security sandbox', () => {
  let dir: string
  let canary: string
  let services: DuckDBService[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sbx-'))
    canary = join(dir, 'canary.txt')
    writeFileSync(canary, 'CANARY_OK')
    services = []
    vi.stubEnv('MCP_SECURITY_MODE', undefined)
    vi.stubEnv('MCP_SANDBOX', undefined)
    vi.stubEnv('NODE_ENV', undefined)
  })

  afterEach(async () => {
    await Promise.all(services.map((svc) => svc.close()))
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  })

  async function mk(config: Partial<DuckDBServiceConfig> = {}): Promise<DuckDBService> {
    const svc = new DuckDBService(config)
    services.push(svc)
    await svc.initialize()
    return svc
  }

  describe.each(['strict', 'no-local-fs'] as const)('%s', (sandbox) => {
    it('blocks local reads through text and blob readers', async () => {
      const svc = await mk({ sandbox })
      for (const reader of ['read_text', 'read_blob']) {
        await expect(
          svc.executeQuery(`SELECT content FROM ${reader}('${canary}')`)
        ).rejects.toThrow(/disabled/i)
      }
    })

    it('blocks COPY TO and leaves the target absent', async () => {
      const svc = await mk({ sandbox })
      const target = join(dir, 'out.csv')
      await expect(svc.executeQuery(`COPY (SELECT 1 AS a) TO '${target}'`)).rejects.toThrow(
        /disabled/i
      )
      expect(existsSync(target)).toBe(false)
    })

    it('blocks a file read within a multi-statement query', async () => {
      const svc = await mk({ sandbox })
      await expect(
        svc.executeQuery(`SELECT 1; SELECT content FROM read_text('${canary}')`)
      ).rejects.toThrow(/disabled/i)
    })

    it('blocks code-loading and attachment statements including comments', async () => {
      const svc = await mk({ sandbox })
      for (const sql of [
        'INSTALL httpfs',
        'LOAD httpfs',
        "ATTACH ':memory:' AS x",
        '/* before */ LOAD httpfs',
        'SELECT 1; -- next statement\n INSTALL httpfs',
      ]) {
        await expect(svc.executeQuery(sql)).rejects.toThrow(/sandbox/i)
      }
    })

    it('keeps the required engine policy locked', async () => {
      const svc = await mk({ sandbox })
      expect(
        await svc.executeScalar("SELECT current_setting('lock_configuration') AS locked")
      ).toEqual({ locked: true })
      for (const sql of [
        'SET lock_configuration=false',
        'RESET lock_configuration',
        'SET enable_external_access=true',
        "SET disabled_filesystems=''",
        'SET autoload_known_extensions=true',
        'SET autoinstall_known_extensions=true',
        'SET allow_persistent_secrets=true',
      ]) {
        await expect(svc.executeQuery(sql)).rejects.toThrow()
      }
      await expect(svc.executeQuery(`SELECT content FROM read_text('${canary}')`)).rejects.toThrow(
        /disabled/i
      )
    })

    it('supports in-memory table creation and queries', async () => {
      const svc = await mk({ sandbox })
      await svc.executeQuery('CREATE TABLE example AS SELECT 42 AS value')
      expect(await svc.executeQuery('SELECT * FROM example')).toEqual([{ value: 42 }])
    })
  })

  it('strict blocks HTTP and S3 readers at the engine', async () => {
    const svc = await mk({ sandbox: 'strict' })
    // External access is rejected before extension loading or any network I/O.
    for (const path of ['http://127.0.0.1:1/canary.csv', 's3://sandbox/canary.csv']) {
      await expect(svc.executeQuery(`SELECT * FROM read_csv('${path}')`)).rejects.toThrow(
        /disabled/i
      )
    }
  })

  it('off retains legacy local-file support', async () => {
    const svc = await mk({ sandbox: 'off' })
    expect(svc.sandboxLevel).toBe('off')
    expect(await svc.executeQuery(`SELECT content FROM read_text('${canary}')`)).toEqual([
      { content: 'CANARY_OK' },
    ])
  })

  it('production defaults to strict and blocks the local read vector', async () => {
    vi.stubEnv('MCP_SECURITY_MODE', 'production')
    const svc = await mk()
    expect(svc.sandboxLevel).toBe('strict')
    await expect(svc.executeQuery(`SELECT content FROM read_text('${canary}')`)).rejects.toThrow(
      /disabled/i
    )
  })

  it('NODE_ENV alone does not change the legacy default', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const svc = await mk()
    expect(svc.sandboxLevel).toBe('off')
  })

  it('explicit MCP_SANDBOX overrides the production mode default', async () => {
    vi.stubEnv('MCP_SECURITY_MODE', 'production')
    vi.stubEnv('MCP_SANDBOX', 'off')
    expect((await mk()).sandboxLevel).toBe('off')
  })

  it('constructor sandbox takes precedence over the environment', async () => {
    vi.stubEnv('MCP_SANDBOX', 'off')
    expect((await mk({ sandbox: 'strict' })).sandboxLevel).toBe('strict')
  })

  it('an invalid sandbox environment cannot silently disable hardening', async () => {
    vi.stubEnv('MCP_SANDBOX', 'strcit')
    await expect(mk()).rejects.toThrow()
  })
})
