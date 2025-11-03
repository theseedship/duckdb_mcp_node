/**
 * Unit tests for process mining tools
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DuckDBService } from '../duckdb/service.js'
import { handleProcessDescribe, handleProcessCompose } from './process-tools.js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Process Mining Tools', () => {
  let duckdb: DuckDBService
  const testDataDir = path.join(__dirname, '../../test-data/process')

  beforeAll(async () => {
    // Initialize DuckDB
    duckdb = new DuckDBService({
      memory: '1GB',
      threads: 2,
    })
    await duckdb.initialize()

    // Create test data directory
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true })
    }

    // Create mock parquet files
    await createMockProcessSummary(duckdb, testDataDir)
    await createMockProcessSteps(duckdb, testDataDir)
    await createMockProcessEdges(duckdb, testDataDir)
  })

  afterAll(async () => {
    await duckdb.close()
  })

  describe('process.describe', () => {
    it('should return top-N processes by confidence', async () => {
      const result = await handleProcessDescribe(
        {
          topN: 2,
          parquet_url: path.join(testDataDir, 'process_summary.parquet'),
        },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.processes).toHaveLength(2)
      expect(result.processes[0].confidence).toBeGreaterThanOrEqual(result.processes[1].confidence)
    })

    it('should validate topN parameter', async () => {
      await expect(
        handleProcessDescribe(
          {
            topN: -1,
            parquet_url: path.join(testDataDir, 'process_summary.parquet'),
          },
          duckdb
        )
      ).rejects.toThrow()
    })

    it('should handle missing parquet URL', async () => {
      const oldEnv = process.env.PROCESS_SUMMARY_URL
      delete process.env.PROCESS_SUMMARY_URL

      await expect(
        handleProcessDescribe(
          {
            topN: 5,
          },
          duckdb
        )
      ).rejects.toThrow('Parquet URL not configured')

      process.env.PROCESS_SUMMARY_URL = oldEnv
    })
  })

  describe('process.compose', () => {
    it('should merge steps from multiple documents', async () => {
      const result = await handleProcessCompose(
        {
          doc_ids: ['doc1', 'doc2'],
          steps_url: path.join(testDataDir, 'process_steps.parquet'),
          edges_url: path.join(testDataDir, 'process_edges.parquet'),
        },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.steps.length).toBeGreaterThan(0)
      expect(result.source_docs).toEqual(['doc1', 'doc2'])
    })

    it('should deduplicate steps by step_key', async () => {
      const result = await handleProcessCompose(
        {
          doc_ids: ['doc1', 'doc2'],
          steps_url: path.join(testDataDir, 'process_steps.parquet'),
          edges_url: path.join(testDataDir, 'process_edges.parquet'),
        },
        duckdb
      )

      const stepKeys = result.steps.map((s) => s.step_key)
      const uniqueKeys = new Set(stepKeys)
      expect(stepKeys.length).toBe(uniqueKeys.size)
    })

    it('should preserve edge relationships', async () => {
      const result = await handleProcessCompose(
        {
          doc_ids: ['doc1'],
          steps_url: path.join(testDataDir, 'process_steps.parquet'),
          edges_url: path.join(testDataDir, 'process_edges.parquet'),
        },
        duckdb
      )

      expect(result.edges.length).toBeGreaterThan(0)
      expect(result.edges[0]).toHaveProperty('from_step_id')
      expect(result.edges[0]).toHaveProperty('to_step_id')
    })
  })
})

/**
 * Create mock process summary parquet file
 */
async function createMockProcessSummary(duckdb: DuckDBService, dataDir: string) {
  const summaryPath = path.join(dataDir, 'process_summary.parquet')

  await duckdb.executeQuery(`
    CREATE OR REPLACE TABLE temp_summary AS
    SELECT
      doc_id::VARCHAR AS doc_id,
      process_id::VARCHAR AS process_id,
      type::VARCHAR AS type,
      one_liner::VARCHAR AS one_liner,
      steps_count::INTEGER AS steps_count,
      confidence::DOUBLE AS confidence,
      mermaid::VARCHAR AS mermaid
    FROM (VALUES
      ('doc1', 'proc1', 'Approval', 'Standard approval workflow', 3, 0.95, NULL),
      ('doc2', 'proc2', 'Signature', 'Document signature process', 4, 0.88, NULL),
      ('doc3', 'proc3', 'Review', 'Document review process', 2, 0.75, NULL)
    ) AS t(doc_id, process_id, type, one_liner, steps_count, confidence, mermaid);

    COPY temp_summary TO '${summaryPath}' (FORMAT PARQUET);
    DROP TABLE temp_summary;
  `)
}

/**
 * Create mock process steps parquet file
 */
async function createMockProcessSteps(duckdb: DuckDBService, dataDir: string) {
  const stepsPath = path.join(dataDir, 'process_steps.parquet')

  await duckdb.executeQuery(`
    CREATE OR REPLACE TABLE temp_steps AS
    SELECT
      doc_id::VARCHAR AS doc_id,
      process_id::VARCHAR AS process_id,
      step_id::VARCHAR AS step_id,
      "order"::INTEGER AS "order",
      step_key::VARCHAR AS step_key,
      label::VARCHAR AS label,
      evidence::VARCHAR AS evidence,
      CAST(NULL AS DOUBLE[]) AS embedding
    FROM (VALUES
      ('doc1', 'proc1', 'step1', 0, 'submit', 'Submit request', 'User submits form'),
      ('doc1', 'proc1', 'step2', 1, 'review', 'Review request', 'Manager reviews'),
      ('doc1', 'proc1', 'step3', 2, 'approve', 'Approve request', 'Final approval'),
      ('doc2', 'proc2', 'step1', 0, 'submit', 'Submit document', 'Upload document'),
      ('doc2', 'proc2', 'step2', 1, 'verify', 'Verify document', 'Check validity'),
      ('doc2', 'proc2', 'step3', 2, 'sign', 'Sign document', 'Apply signature'),
      ('doc2', 'proc2', 'step4', 3, 'archive', 'Archive document', 'Store in system')
    ) AS t(doc_id, process_id, step_id, "order", step_key, label, evidence);

    COPY temp_steps TO '${stepsPath}' (FORMAT PARQUET);
    DROP TABLE temp_steps;
  `)
}

/**
 * Create mock process edges parquet file
 */
async function createMockProcessEdges(duckdb: DuckDBService, dataDir: string) {
  const edgesPath = path.join(dataDir, 'process_edges.parquet')

  await duckdb.executeQuery(`
    COPY (
      SELECT * FROM (VALUES
        ('doc1', 'proc1', 'step1', 'step2', 'next', NULL),
        ('doc1', 'proc1', 'step2', 'step3', 'next', NULL),
        ('doc2', 'proc2', 'step1', 'step2', 'next', NULL),
        ('doc2', 'proc2', 'step2', 'step3', 'next', NULL),
        ('doc2', 'proc2', 'step3', 'step4', 'next', NULL)
      ) AS t(doc_id, process_id, from_step_id, to_step_id, relation, evidence)
    ) TO '${edgesPath}' (FORMAT PARQUET)
  `)
}
