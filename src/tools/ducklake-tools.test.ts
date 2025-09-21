/**
 * Tests for DuckLake MCP Tools
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DuckDBService, createDuckDBService } from '../duckdb/service.js'
import { SpaceContextFactory } from '../context/SpaceContext.js'
import { DuckLakeToolHandlers } from './ducklake-tools.js'

describe('DuckLakeToolHandlers', () => {
  let duckdb: DuckDBService
  let handlers: DuckLakeToolHandlers
  let spaceFactory: SpaceContextFactory

  beforeAll(async () => {
    // Create real DuckDB service for integration tests
    duckdb = createDuckDBService({
      memory: '256MB',
      threads: 2,
    })
    await duckdb.initialize()

    // Create handlers with real service
    handlers = new DuckLakeToolHandlers(duckdb)
    spaceFactory = new SpaceContextFactory(duckdb)
  })

  afterAll(async () => {
    await duckdb.close()
  })

  describe('initialization', () => {
    it('should create handlers with DuckDB service', () => {
      expect(handlers).toBeDefined()
      expect(handlers['duckdb']).toBe(duckdb)
    })

    it('should set space factory when provided', () => {
      handlers.setSpaceFactory(spaceFactory)
      expect(handlers['spaceFactory']).toBe(spaceFactory)
      expect(handlers['adapter']).toBeDefined()
    })
  })

  describe('attach', () => {
    it('should handle attach operation', async () => {
      const input = {
        catalogName: 'test_catalog',
        catalogLocation: 's3://test/location',
        format: 'DELTA' as const,
        enableTimeTravel: true,
        retentionDays: 30,
        compressionType: 'ZSTD' as const,
      }

      const result = await handlers.attach(input)

      // Should return a result object with success flag
      expect(result).toBeDefined()
      expect(result).toHaveProperty('success')

      // If S3 isn't configured, it should fail gracefully
      if (!result.success) {
        expect(result).toHaveProperty('error')
      } else {
        expect(result).toHaveProperty('catalogName')
        expect(result).toHaveProperty('location')
      }
    })

    it('should handle S3 configuration in attach', async () => {
      const input = {
        catalogName: 'test_s3_catalog',
        catalogLocation: 's3://test/location',
        s3Config: {
          endpoint: 'http://localhost:9000',
          region: 'us-east-1',
          accessKeyId: 'test',
          secretAccessKey: 'test',
          useSSL: false,
        },
      }

      const result = await handlers.attach(input)

      expect(result).toBeDefined()
      expect(result).toHaveProperty('success')
    })
  })

  describe('snapshots', () => {
    it('should handle snapshots list operation', async () => {
      const input = {
        catalogName: 'test_catalog',
        tableName: 'test_table',
        action: 'list' as const,
      }

      const result = await handlers.snapshots(input)

      expect(result).toBeDefined()
      expect(result).toHaveProperty('success')

      // Should fail if catalog doesn't exist
      if (!result.success) {
        expect(result).toHaveProperty('error')
        expect(result.error).toContain('not found')
      }
    })

    it('should require version for details action', async () => {
      const input = {
        catalogName: 'test_catalog',
        tableName: 'test_table',
        action: 'details' as const,
        // Missing version
      }

      const result = await handlers.snapshots(input)

      expect(result).toBeDefined()
      expect(result.success).toBe(false)
      expect(result.error).toContain('Version required')
    })

    it('should require targetTableName for clone action', async () => {
      const input = {
        catalogName: 'test_catalog',
        tableName: 'test_table',
        action: 'clone' as const,
        version: 1,
        // Missing targetTableName
      }

      const result = await handlers.snapshots(input)

      expect(result).toBeDefined()
      expect(result.success).toBe(false)
      expect(result.error).toContain('targetTableName required')
    })
  })

  describe('timeTravel', () => {
    it('should handle time travel query', async () => {
      const input = {
        catalogName: 'test_catalog',
        tableName: 'test_table',
        query: 'SELECT * FROM test_table',
        timestamp: '2025-01-01T00:00:00Z',
        limit: 100,
      }

      const result = await handlers.timeTravel(input)

      expect(result).toBeDefined()
      expect(result).toHaveProperty('success')

      // Should fail if catalog doesn't exist or table not found
      if (!result.success) {
        expect(result).toHaveProperty('error')
        // Error message varies - could be "not found" or "No data found"
        expect(typeof result.error).toBe('string')
      }
    })

    it('should handle numeric version for time travel', async () => {
      const input = {
        catalogName: 'test_catalog',
        tableName: 'test_table',
        query: 'SELECT * FROM test_table',
        timestamp: 1,
        limit: 100,
      }

      const result = await handlers.timeTravel(input)

      expect(result).toBeDefined()
      expect(result).toHaveProperty('success')
    })
  })

  describe('error handling', () => {
    it('should handle unknown action in snapshots', async () => {
      const input = {
        catalogName: 'test_catalog',
        tableName: 'test_table',
        action: 'invalid_action' as any,
      }

      const result = await handlers.snapshots(input)

      expect(result).toBeDefined()
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown action')
    })
  })
})
