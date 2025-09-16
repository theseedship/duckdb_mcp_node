import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { DuckDBService, createDuckDBService } from './service.js'

describe('DuckDBService', () => {
  let service: DuckDBService

  beforeAll(async () => {
    service = createDuckDBService({
      memory: '256MB',
      threads: 2,
    })
    await service.initialize()
  })

  afterAll(async () => {
    await service.close()
  })

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(service.isReady()).toBe(true)
    })
  })

  describe('query execution', () => {
    it('should execute simple SELECT query', async () => {
      const result = await service.executeQuery('SELECT 1 as test')
      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('test', 1)
    })

    it('should create and query a table', async () => {
      // Create table
      await service.executeQuery('CREATE TABLE test_table (id INTEGER, name VARCHAR)')

      // Insert data
      await service.executeQuery("INSERT INTO test_table VALUES (1, 'Alice'), (2, 'Bob')")

      // Query data
      const result = await service.executeQuery('SELECT * FROM test_table ORDER BY id')
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ id: 1, name: 'Alice' })
      expect(result[1]).toEqual({ id: 2, name: 'Bob' })
    })

    it('should handle executeScalar correctly', async () => {
      const result = await service.executeScalar('SELECT COUNT(*) as count FROM test_table')
      expect(result).toEqual({ count: '2' })
    })
  })

  describe('table operations', () => {
    it('should check if table exists', async () => {
      const exists = await service.tableExists('test_table')
      expect(exists).toBe(true)

      const notExists = await service.tableExists('non_existent_table')
      expect(notExists).toBe(false)
    })

    it('should get row count', async () => {
      const count = await service.getRowCount('test_table')
      expect(count).toBe(2)
    })

    it('should get table columns', async () => {
      const columns = await service.getTableColumns('test_table')
      expect(columns).toHaveLength(2)
      expect(columns[0]).toHaveProperty('column_name', 'id')
      expect(columns[1]).toHaveProperty('column_name', 'name')
    })
  })

  describe('JSON operations', () => {
    it('should create table from JSON data', async () => {
      const jsonData = [
        { id: 1, value: 'test1' },
        { id: 2, value: 'test2' },
      ]

      await service.createTableFromJSON('json_table', jsonData)

      const result = await service.executeQuery('SELECT * FROM json_table')
      // DuckDB returns numbers as strings when stored in VARCHAR columns
      expect(result).toEqual([
        { id: '1', value: 'test1' },
        { id: '2', value: 'test2' },
      ])
    })
  })

  describe('error handling', () => {
    it('should throw error for invalid SQL', async () => {
      await expect(service.executeQuery('SELECT * FROM non_existent_table')).rejects.toThrow()
    })
  })
})
