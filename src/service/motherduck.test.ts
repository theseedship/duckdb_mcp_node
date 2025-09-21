/**
 * MotherDuck Service Tests
 * Tests for MotherDuck cloud integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MotherDuckService } from './motherduck.js'
import { DuckDBService } from '../duckdb/service.js'

// Mock the DuckDBService
vi.mock('../duckdb/service.js')

describe('MotherDuckService', () => {
  let motherduck: MotherDuckService
  let mockDuckDB: DuckDBService

  beforeEach(() => {
    // Create mock DuckDB service
    mockDuckDB = {
      executeQuery: vi.fn(),
      executeScalar: vi.fn(),
      initialize: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
    } as any

    // Create MotherDuck service
    motherduck = new MotherDuckService(mockDuckDB)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('attach', () => {
    it('should attach to MotherDuck with token', async () => {
      const config = {
        token: 'test-token-123',
      }

      await motherduck.attach(config)

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining("ATTACH 'md:?motherduck_token=test-token-123' AS motherduck")
      )
    })

    it('should attach to specific database', async () => {
      const config = {
        token: 'test-token-123',
        database: 'mydb',
      }

      await motherduck.attach(config)

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining("ATTACH 'md:mydb?motherduck_token=test-token-123' AS motherduck")
      )
      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith('USE motherduck.mydb')
    })

    it('should attach with custom endpoint', async () => {
      const config = {
        token: 'test-token-123',
        endpoint: 'custom.motherduck.com',
      }

      await motherduck.attach(config)

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('motherduck_endpoint=custom.motherduck.com')
      )
    })

    it('should throw error on connection failure', async () => {
      mockDuckDB.executeQuery = vi.fn().mockRejectedValue(new Error('Connection failed'))

      const config = {
        token: 'test-token-123',
      }

      await expect(motherduck.attach(config)).rejects.toThrow(
        'Failed to connect to MotherDuck: Connection failed'
      )
    })
  })

  describe('detach', () => {
    it('should detach from MotherDuck when connected', async () => {
      // First attach
      await motherduck.attach({ token: 'test-token' })
      vi.clearAllMocks()

      // Then detach
      await motherduck.detach()

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith('DETACH motherduck')
      expect(motherduck.isAttached()).toBe(false)
    })

    it('should throw error when not connected', async () => {
      await expect(motherduck.detach()).rejects.toThrow('Not connected to MotherDuck')
    })
  })

  describe('getStatus', () => {
    it('should return status when connected', async () => {
      // Attach first
      await motherduck.attach({ token: 'test-token', database: 'testdb' })

      // Mock storage info response
      mockDuckDB.executeQuery = vi.fn().mockResolvedValue([
        {
          bytes_used: 1024000,
          bytes_limit: 10240000,
        },
      ])

      const status = await motherduck.getStatus()

      expect(status.connected).toBe(true)
      expect(status.database).toBe('testdb')
      expect(status.bytesUsed).toBe(1024000)
      expect(status.bytesLimit).toBe(10240000)
    })

    it('should return disconnected status when not connected', async () => {
      const status = await motherduck.getStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Not connected to MotherDuck')
    })
  })

  describe('listDatabases', () => {
    it('should list databases when connected', async () => {
      await motherduck.attach({ token: 'test-token' })

      mockDuckDB.executeQuery = vi
        .fn()
        .mockResolvedValue([
          { database_name: 'db1' },
          { database_name: 'db2' },
          { database_name: 'db3' },
        ])

      const databases = await motherduck.listDatabases()

      expect(databases).toEqual(['db1', 'db2', 'db3'])
      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM motherduck.information_schema.schemata')
      )
    })

    it('should throw error when not connected', async () => {
      await expect(motherduck.listDatabases()).rejects.toThrow('Not connected to MotherDuck')
    })
  })

  describe('createDatabase', () => {
    it('should create database when connected', async () => {
      await motherduck.attach({ token: 'test-token' })
      vi.clearAllMocks()

      await motherduck.createDatabase('newdb')

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(
        'CREATE DATABASE IF NOT EXISTS motherduck.newdb'
      )
    })

    it('should throw error when not connected', async () => {
      await expect(motherduck.createDatabase('newdb')).rejects.toThrow(
        'Not connected to MotherDuck'
      )
    })
  })

  describe('shareTable', () => {
    it('should share local table to MotherDuck', async () => {
      await motherduck.attach({ token: 'test-token', database: 'mydb' })
      vi.clearAllMocks()

      await motherduck.shareTable('local_users')

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(
        'CREATE OR REPLACE TABLE motherduck.mydb.local_users AS SELECT * FROM local_users'
      )
    })

    it('should share with custom cloud table name', async () => {
      await motherduck.attach({ token: 'test-token', database: 'mydb' })
      vi.clearAllMocks()

      await motherduck.shareTable('local_users', 'cloud_users')

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(
        'CREATE OR REPLACE TABLE motherduck.mydb.cloud_users AS SELECT * FROM local_users'
      )
    })

    it('should throw error when not connected', async () => {
      await expect(motherduck.shareTable('local_users')).rejects.toThrow(
        'Not connected to MotherDuck'
      )
    })
  })

  describe('importTable', () => {
    it('should import table from MotherDuck', async () => {
      await motherduck.attach({ token: 'test-token', database: 'mydb' })
      vi.clearAllMocks()

      await motherduck.importTable('cloud_users')

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(
        'CREATE OR REPLACE TABLE cloud_users AS SELECT * FROM motherduck.mydb.cloud_users'
      )
    })

    it('should import with custom local table name', async () => {
      await motherduck.attach({ token: 'test-token', database: 'mydb' })
      vi.clearAllMocks()

      await motherduck.importTable('cloud_users', 'local_users')

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(
        'CREATE OR REPLACE TABLE local_users AS SELECT * FROM motherduck.mydb.cloud_users'
      )
    })

    it('should throw error when not connected', async () => {
      await expect(motherduck.importTable('cloud_users')).rejects.toThrow(
        'Not connected to MotherDuck'
      )
    })
  })

  describe('query', () => {
    it('should execute query on MotherDuck', async () => {
      await motherduck.attach({ token: 'test-token' })

      const mockResults = [
        { id: 1, name: 'User 1' },
        { id: 2, name: 'User 2' },
      ]
      mockDuckDB.executeQuery = vi.fn().mockResolvedValue(mockResults)

      const results = await motherduck.query('SELECT * FROM users')

      expect(results).toEqual(mockResults)
      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith('SELECT * FROM users')
    })

    it('should throw error when not connected', async () => {
      await expect(motherduck.query('SELECT * FROM users')).rejects.toThrow(
        'Not connected to MotherDuck'
      )
    })
  })

  describe('configuration', () => {
    it('should return configuration when attached', async () => {
      const config = {
        token: 'test-token',
        database: 'mydb',
      }

      await motherduck.attach(config)

      const currentConfig = motherduck.getConfig()
      expect(currentConfig).toEqual(config)
    })

    it('should return undefined when not attached', () => {
      const config = motherduck.getConfig()
      expect(config).toBeUndefined()
    })
  })
})
