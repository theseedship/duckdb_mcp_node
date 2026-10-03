import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DuckDBService } from './service.js'

/**
 * Regression tests for the engine-level security sandbox (CVE / GHSA fix).
 *
 * These replay the three vectors from the disclosure and assert they are
 * blocked under the hardened sandbox, while normal queries keep working.
 * See SECURITY-DISCLOSURE-2026-10-03.md.
 */
describe('DuckDBService security sandbox', () => {
  let dir: string
  let canary: string
  const savedEnv = {
    mode: process.env.MCP_SECURITY_MODE,
    sandbox: process.env.MCP_SANDBOX,
    node: process.env.NODE_ENV,
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sbx-'))
    canary = join(dir, 'canary.txt')
    writeFileSync(canary, 'CANARY_OK')
    delete process.env.MCP_SECURITY_MODE
    delete process.env.MCP_SANDBOX
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    process.env.MCP_SECURITY_MODE = savedEnv.mode
    process.env.MCP_SANDBOX = savedEnv.sandbox
    process.env.NODE_ENV = savedEnv.node
    if (savedEnv.mode === undefined) delete process.env.MCP_SECURITY_MODE
    if (savedEnv.sandbox === undefined) delete process.env.MCP_SANDBOX
    if (savedEnv.node === undefined) delete process.env.NODE_ENV
  })

  async function mk(config: Record<string, unknown>): Promise<DuckDBService> {
    const svc = new DuckDBService(config)
    await svc.initialize()
    return svc
  }

  describe("level 'no-local-fs' (default production posture)", () => {
    it('blocks arbitrary local file READ (CWE-22)', async () => {
      const svc = await mk({ sandbox: 'no-local-fs' })
      expect(svc.sandboxLevel).toBe('no-local-fs')
      await expect(svc.executeQuery(`SELECT content FROM read_text('${canary}')`)).rejects.toThrow(
        /disabled/i
      )
    })

    it('blocks arbitrary local file WRITE / COPY TO (CWE-73 → RCE)', async () => {
      const svc = await mk({ sandbox: 'no-local-fs' })
      await expect(
        svc.executeQuery(`COPY (SELECT 1 AS a) TO '${join(dir, 'out.csv')}'`)
      ).rejects.toThrow(/disabled/i)
    })

    it('blocks http(s) SSRF reads (CWE-918)', async () => {
      const svc = await mk({ sandbox: 'no-local-fs' })
      // Safety property: the request must not be reachable (disabled FS, or
      // httpfs refuses to load). No real network call is asserted.
      await expect(
        svc.executeQuery(`SELECT * FROM read_csv_auto('http://169.254.169.254/x') LIMIT 0`)
      ).rejects.toThrow()
    })

    it('blocks INSTALL / LOAD / ATTACH via the statement gate', async () => {
      const svc = await mk({ sandbox: 'no-local-fs' })
      await expect(svc.executeQuery(`INSTALL httpfs`)).rejects.toThrow(/sandbox/i)
      await expect(svc.executeQuery(`LOAD httpfs`)).rejects.toThrow(/sandbox/i)
      await expect(svc.executeQuery(`ATTACH 'x.db' AS x`)).rejects.toThrow(/sandbox/i)
    })

    it('still runs normal in-memory queries', async () => {
      const svc = await mk({ sandbox: 'no-local-fs' })
      const rows = await svc.executeQuery<{ x: number }>(`SELECT 42 AS x`)
      expect(rows[0].x).toBe(42)
    })
  })

  describe("level 'strict' (opt-in full lockdown)", () => {
    it('blocks local file access', async () => {
      const svc = await mk({ sandbox: 'strict' })
      expect(svc.sandboxLevel).toBe('strict')
      await expect(svc.executeQuery(`SELECT content FROM read_text('${canary}')`)).rejects.toThrow(
        /disabled/i
      )
    })

    it('still runs normal in-memory queries', async () => {
      const svc = await mk({ sandbox: 'strict' })
      const rows = await svc.executeQuery<{ x: number }>(`SELECT 1 AS x`)
      expect(rows[0].x).toBe(1)
    })
  })

  describe("level 'off' (legacy dev default)", () => {
    it('leaves local file read enabled (no sandbox requested)', async () => {
      const svc = await mk({ sandbox: 'off' })
      expect(svc.sandboxLevel).toBe('off')
      const rows = await svc.executeQuery<{ content: string }>(
        `SELECT content FROM read_text('${canary}')`
      )
      expect(rows[0].content).toContain('CANARY_OK')
    })
  })

  describe('level resolution (NODE_ENV footgun guard)', () => {
    it('hardens to no-local-fs when MCP_SECURITY_MODE=production', async () => {
      process.env.MCP_SECURITY_MODE = 'production'
      const svc = await mk({})
      expect(svc.sandboxLevel).toBe('no-local-fs')
    })

    it('does NOT harden when only NODE_ENV=production (MCP_SECURITY_MODE unset)', async () => {
      process.env.NODE_ENV = 'production'
      const svc = await mk({})
      expect(svc.sandboxLevel).toBe('off')
    })

    it('explicit MCP_SANDBOX overrides the mode default', async () => {
      process.env.MCP_SECURITY_MODE = 'production'
      process.env.MCP_SANDBOX = 'off'
      const svc = await mk({})
      expect(svc.sandboxLevel).toBe('off')
    })
  })
})
