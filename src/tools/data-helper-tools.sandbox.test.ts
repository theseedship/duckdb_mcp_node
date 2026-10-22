import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DuckDBService } from '../duckdb/service.js'
import { handleJsonToParquet } from './data-helper-tools.js'

describe('json_to_parquet under the engine sandbox', () => {
  it('does not create directories with Node fs when a sandbox is active', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jtp-'))
    const svc = new DuckDBService({ sandbox: 'strict' })
    await svc.initialize()
    try {
      const target = join(root, 'created', 'by', 'attacker', 'out.parquet')
      const result = await handleJsonToParquet({ json_data: [{ a: 1 }], output_path: target }, svc)
      expect(result.success).toBe(false)
      expect(existsSync(join(root, 'created'))).toBe(false)
    } finally {
      await svc.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
