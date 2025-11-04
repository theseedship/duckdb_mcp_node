/**
 * Phase 3.2: Median Calculation Tests
 * Validates P2.9.2 conflict resolution with correct median calculation
 *
 * Tests that median is calculated correctly for:
 * - Even-length arrays (average of middle two elements)
 * - Odd-length arrays (middle element)
 * - Edge cases (identical values, outliers)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DuckDBService } from '../duckdb/service.js'
import { handleProcessCompose } from './process-tools.js'

describe('P2.9.2: Median Calculation for Conflict Resolution', () => {
  let duckdb: DuckDBService

  beforeEach(async () => {
    duckdb = new DuckDBService({ memory: '512MB', threads: 1 })
    await duckdb.initialize()
  })

  afterEach(async () => {
    await duckdb.close()
  })

  describe('Even-length arrays (critical fix validation)', () => {
    it('should calculate median as average for 2 duplicates', async () => {
      // Create test data: 2 processes with same step "test_step" but different orders
      await duckdb.executeQuery(`
        CREATE TABLE process_steps (
          doc_id VARCHAR,
          process_id VARCHAR,
          step_id VARCHAR,
          "order" INTEGER,
          step_key VARCHAR,
          label VARCHAR,
          embedding FLOAT[1024]
        )
      `)

      await duckdb.executeQuery(`
        INSERT INTO process_steps VALUES
          ('doc1', 'proc1', 'step1', 5, 'test_step', 'Test Step', NULL),
          ('doc2', 'proc1', 'step2', 15, 'test_step', 'Test Step', NULL)
      `)

      await duckdb.executeQuery(`
        CREATE TABLE process_edges (
          doc_id VARCHAR,
          process_id VARCHAR,
          from_step_id VARCHAR,
          to_step_id VARCHAR,
          edge_type VARCHAR
        )
      `)

      // Compose
      const result = await handleProcessCompose(
        {
          doc_ids: ['doc1', 'doc2'],
        },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.steps.length).toBe(1) // Deduplicated to 1 step

      // CRITICAL: Median of [5, 15] should be 10 (average), not 15 (upper-middle)
      const mergedStep = result.steps.find((s: any) => s.step_key === 'test_step')
      expect(mergedStep).toBeDefined()
      expect(mergedStep.order).toBeCloseTo(10, 1) // 10 ± 0.1
    })

    it('should calculate median as average for 4 duplicates', async () => {
      await duckdb.executeQuery(`
        CREATE TABLE process_steps (
          doc_id VARCHAR,
          process_id VARCHAR,
          step_id VARCHAR,
          "order" INTEGER,
          step_key VARCHAR,
          label VARCHAR,
          embedding FLOAT[1024]
        )
      `)

      await duckdb.executeQuery(`
        INSERT INTO process_steps VALUES
          ('doc1', 'proc1', 'step1', 0, 'test_step', 'Test', NULL),
          ('doc2', 'proc1', 'step2', 5, 'test_step', 'Test', NULL),
          ('doc3', 'proc1', 'step3', 10, 'test_step', 'Test', NULL),
          ('doc4', 'proc1', 'step4', 15, 'test_step', 'Test', NULL)
      `)

      await duckdb.executeQuery(`
        CREATE TABLE process_edges (
          doc_id VARCHAR,
          process_id VARCHAR,
          from_step_id VARCHAR,
          to_step_id VARCHAR,
          edge_type VARCHAR
        )
      `)

      const result = await handleProcessCompose(
        { doc_ids: ['doc1', 'doc2', 'doc3', 'doc4'] },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.steps.length).toBe(1)

      // CRITICAL: Median of [0, 5, 10, 15] should be 7.5 (average of 5 and 10), not 10
      const mergedStep = result.steps.find((s: any) => s.step_key === 'test_step')
      expect(mergedStep.order).toBeCloseTo(7.5, 1)
    })

    it('should handle identical orders correctly', async () => {
      await duckdb.executeQuery(`
        CREATE TABLE process_steps (
          doc_id VARCHAR,
          process_id VARCHAR,
          step_id VARCHAR,
          "order" INTEGER,
          step_key VARCHAR,
          label VARCHAR,
          embedding FLOAT[1024]
        )
      `)

      await duckdb.executeQuery(`
        INSERT INTO process_steps VALUES
          ('doc1', 'proc1', 'step1', 0, 'test_step', 'Test', NULL),
          ('doc2', 'proc1', 'step2', 0, 'test_step', 'Test', NULL)
      `)

      await duckdb.executeQuery(`
        CREATE TABLE process_edges (
          doc_id VARCHAR,
          process_id VARCHAR,
          from_step_id VARCHAR,
          to_step_id VARCHAR,
          edge_type VARCHAR
        )
      `)

      const result = await handleProcessCompose({ doc_ids: ['doc1', 'doc2'] }, duckdb)

      expect(result.success).toBe(true)

      // Median of [0, 0] should be 0 (average)
      const mergedStep = result.steps.find((s: any) => s.step_key === 'test_step')
      expect(mergedStep.order).toBe(0)
    })
  })

  describe('Odd-length arrays (should work as before)', () => {
    it('should calculate median as middle element for 3 duplicates', async () => {
      await duckdb.executeQuery(`
        CREATE TABLE process_steps (
          doc_id VARCHAR,
          process_id VARCHAR,
          step_id VARCHAR,
          "order" INTEGER,
          step_key VARCHAR,
          label VARCHAR,
          embedding FLOAT[1024]
        )
      `)

      await duckdb.executeQuery(`
        INSERT INTO process_steps VALUES
          ('doc1', 'proc1', 'step1', 5, 'test_step', 'Test', NULL),
          ('doc2', 'proc1', 'step2', 10, 'test_step', 'Test', NULL),
          ('doc3', 'proc1', 'step3', 15, 'test_step', 'Test', NULL)
      `)

      await duckdb.executeQuery(`
        CREATE TABLE process_edges (
          doc_id VARCHAR,
          process_id VARCHAR,
          from_step_id VARCHAR,
          to_step_id VARCHAR,
          edge_type VARCHAR
        )
      `)

      const result = await handleProcessCompose({ doc_ids: ['doc1', 'doc2', 'doc3'] }, duckdb)

      expect(result.success).toBe(true)

      // Median of [5, 10, 15] should be 10 (middle element)
      const mergedStep = result.steps.find((s: any) => s.step_key === 'test_step')
      expect(mergedStep.order).toBe(10)
    })

    it('should handle outliers correctly for 5 duplicates', async () => {
      await duckdb.executeQuery(`
        CREATE TABLE process_steps (
          doc_id VARCHAR,
          process_id VARCHAR,
          step_id VARCHAR,
          "order" INTEGER,
          step_key VARCHAR,
          label VARCHAR,
          embedding FLOAT[1024]
        )
      `)

      await duckdb.executeQuery(`
        INSERT INTO process_steps VALUES
          ('doc1', 'proc1', 'step1', 1, 'test_step', 'Test', NULL),
          ('doc2', 'proc1', 'step2', 2, 'test_step', 'Test', NULL),
          ('doc3', 'proc1', 'step3', 3, 'test_step', 'Test', NULL),
          ('doc4', 'proc1', 'step4', 4, 'test_step', 'Test', NULL),
          ('doc5', 'proc1', 'step5', 100, 'test_step', 'Test', NULL)
      `)

      await duckdb.executeQuery(`
        CREATE TABLE process_edges (
          doc_id VARCHAR,
          process_id VARCHAR,
          from_step_id VARCHAR,
          to_step_id VARCHAR,
          edge_type VARCHAR
        )
      `)

      const handler = processToolHandlers['process.compose']
      const result = await handler({ doc_ids: ['doc1', 'doc2', 'doc3', 'doc4', 'doc5'] }, duckdb)

      expect(result.success).toBe(true)

      // Median of [1, 2, 3, 4, 100] should be 3 (middle element, outlier ignored)
      const mergedStep = result.steps.find((s: any) => s.step_key === 'test_step')
      expect(mergedStep.order).toBe(3)
    })
  })

  describe('Step selection (closest to median)', () => {
    it('should select step with order closest to median', async () => {
      await duckdb.executeQuery(`
        CREATE TABLE process_steps (
          doc_id VARCHAR,
          process_id VARCHAR,
          step_id VARCHAR,
          "order" INTEGER,
          step_key VARCHAR,
          label VARCHAR,
          embedding FLOAT[1024]
        )
      `)

      await duckdb.executeQuery(`
        INSERT INTO process_steps VALUES
          ('doc1', 'proc1', 'step1', 5, 'test_step', 'Label A', NULL),
          ('doc2', 'proc1', 'step2', 15, 'test_step', 'Label B', NULL)
      `)

      await duckdb.executeQuery(`
        CREATE TABLE process_edges (
          doc_id VARCHAR,
          process_id VARCHAR,
          from_step_id VARCHAR,
          to_step_id VARCHAR,
          edge_type VARCHAR
        )
      `)

      const result = await handleProcessCompose({ doc_ids: ['doc1', 'doc2'] }, duckdb)

      expect(result.success).toBe(true)

      // Median = 10 (average of 5 and 15)
      // Both steps are equally close (diff = 5)
      // Should select either one consistently
      const mergedStep = result.steps.find((s: any) => s.step_key === 'test_step')
      expect(mergedStep.order).toBeCloseTo(10, 1)
      expect(['Label A', 'Label B']).toContain(mergedStep.label)
    })
  })
})
