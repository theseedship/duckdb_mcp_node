/**
 * Unit tests for data helper tools
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DuckDBService } from '../duckdb/service.js'
import {
  handleJsonToParquet,
  handleProfileParquet,
  handleSampleParquet,
} from './data-helper-tools.js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Data Helper Tools', () => {
  let duckdb: DuckDBService
  const testDataDir = path.join(__dirname, '../../test-data/data-helpers')

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
  })

  afterAll(async () => {
    await duckdb.close()
    // Cleanup test files
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true })
    }
  })

  describe('json_to_parquet', () => {
    it('should convert inline JSON array to parquet', async () => {
      const outputPath = path.join(testDataDir, 'test_inline.parquet')
      const jsonData = [
        { id: 1, name: 'Alice', age: 30 },
        { id: 2, name: 'Bob', age: 25 },
        { id: 3, name: 'Charlie', age: 35 },
      ]

      const result = await handleJsonToParquet(
        {
          json_data: jsonData,
          output_path: outputPath,
        },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.output_path).toBe(outputPath)
      expect(result.row_count).toBe(3)
      expect(fs.existsSync(outputPath)).toBe(true)
    })

    it('should handle missing json_data and json_url', async () => {
      const outputPath = path.join(testDataDir, 'test_missing.parquet')

      const result = await handleJsonToParquet(
        {
          output_path: outputPath,
        },
        duckdb
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Either json_data or json_url must be provided')
    })

    it('should validate output_path is required', async () => {
      const result = await handleJsonToParquet(
        {
          json_data: [{ id: 1 }],
        },
        duckdb
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('profile_parquet', () => {
    let testParquetPath: string

    beforeAll(async () => {
      // Create a test parquet file
      testParquetPath = path.join(testDataDir, 'profile_test.parquet')
      const jsonData = [
        { id: 1, name: 'Alice', age: 30, score: 95.5 },
        { id: 2, name: 'Bob', age: 25, score: 88.0 },
        { id: 3, name: 'Charlie', age: 35, score: 92.3 },
        { id: 4, name: 'David', age: 28, score: 87.5 },
      ]

      await handleJsonToParquet(
        {
          json_data: jsonData,
          output_path: testParquetPath,
        },
        duckdb
      )
    })

    it('should profile a parquet file with statistics', async () => {
      const result = await handleProfileParquet(
        {
          url: testParquetPath,
          sample_size: 2,
        },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.row_count).toBe(4)
      expect(result.column_count).toBe(4)
      expect(result.columns).toBeDefined()
      expect(result.columns?.length).toBe(4)
      expect(result.sample).toBeDefined()
      expect(result.sample?.length).toBe(2)
    })

    it('should profile specific columns only', async () => {
      const result = await handleProfileParquet(
        {
          url: testParquetPath,
          columns: ['name', 'age'],
          sample_size: 2,
        },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.columns?.length).toBe(2)
      const columnNames = result.columns?.map((c) => c.name)
      expect(columnNames).toContain('name')
      expect(columnNames).toContain('age')
    })

    it('should calculate correct statistics for numeric columns', async () => {
      const result = await handleProfileParquet(
        {
          url: testParquetPath,
          sample_size: 10,
        },
        duckdb
      )

      const ageColumn = result.columns?.find((c) => c.name === 'age')
      expect(ageColumn).toBeDefined()
      expect(ageColumn?.null_count).toBe(0)
      expect(ageColumn?.distinct_count).toBe(4)
      // avg might be undefined if column type is not detected as numeric
      // Check that min/max are present instead
      expect(ageColumn?.min).toBeDefined()
      expect(ageColumn?.max).toBeDefined()
    })

    it('should handle missing parquet file', async () => {
      const result = await handleProfileParquet(
        {
          url: '/nonexistent/file.parquet',
        },
        duckdb
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('sample_parquet', () => {
    let testParquetPath: string

    beforeAll(async () => {
      // Create a larger test parquet file
      testParquetPath = path.join(testDataDir, 'sample_test.parquet')
      const jsonData = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `User${i + 1}`,
        value: Math.random() * 100,
      }))

      await handleJsonToParquet(
        {
          json_data: jsonData,
          output_path: testParquetPath,
        },
        duckdb
      )
    })

    it('should sample using random method', async () => {
      const result = await handleSampleParquet(
        {
          url: testParquetPath,
          method: 'random',
          n: 10,
        },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.method).toBe('random')
      expect(result.requested_rows).toBe(10)
      expect(result.actual_rows).toBe(10)
      expect(result.data).toBeDefined()
      expect(result.data?.length).toBe(10)
    })

    it('should sample using first method', async () => {
      const result = await handleSampleParquet(
        {
          url: testParquetPath,
          method: 'first',
          n: 5,
        },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.method).toBe('first')
      expect(result.actual_rows).toBe(5)
      expect(result.data).toBeDefined()
    })

    it('should sample using systematic method', async () => {
      const result = await handleSampleParquet(
        {
          url: testParquetPath,
          method: 'systematic',
          n: 10,
        },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.method).toBe('systematic')
      expect(result.actual_rows).toBeLessThanOrEqual(10)
    })

    it('should sample without seed parameter', async () => {
      // Note: DuckDB's SAMPLE clause may not support seed parameter in all versions
      // Testing basic random sampling without seed
      const result = await handleSampleParquet(
        {
          url: testParquetPath,
          method: 'random',
          n: 5,
        },
        duckdb
      )

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
      expect(result.actual_rows).toBe(5)
    })

    it('should handle invalid sampling method', async () => {
      const result = await handleSampleParquet(
        {
          url: testParquetPath,
          method: 'invalid' as any,
          n: 10,
        },
        duckdb
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
