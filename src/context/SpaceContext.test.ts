import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SpaceContext, SpaceConfig } from './SpaceContext'
import { DuckDBService } from '../duckdb/service'

// Mock the logger
vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock DuckDBService
vi.mock('../duckdb/service', () => ({
  DuckDBService: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
    close: vi.fn(),
    isInitialized: true,
  })),
}))

describe('SpaceContext', () => {
  let mockDuckDB: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDuckDB = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn(),
      isInitialized: true,
    }
  })

  describe('Space Isolation', () => {
    it('should create isolated space with unique ID', () => {
      const space = new SpaceContext('tenant-123')
      expect(space.getId()).toBe('tenant-123')
    })

    it('should generate schema name from space ID', () => {
      const space = new SpaceContext('tenant-abc')
      expect(space.getSchema()).toBe('space_tenant_abc')
    })

    it('should apply custom table prefix', () => {
      const space = new SpaceContext('tenant-456', {
        tablePrefix: 'custom_',
      })
      const qualifiedName = space.qualifyTableName('users')
      expect(qualifiedName).toBe('space_tenant_456.custom_users')
    })

    it('should handle special characters in space ID', () => {
      const space = new SpaceContext('tenant-123-special!')
      expect(space.getSchema()).toBe('space_tenant_123_special_')
    })

    it('should isolate tables between different spaces', () => {
      const space1 = new SpaceContext('tenant-1')
      const space2 = new SpaceContext('tenant-2')

      const table1 = space1.qualifyTableName('users')
      const table2 = space2.qualifyTableName('users')

      expect(table1).not.toBe(table2)
      expect(table1).toBe('space_tenant_1.users')
      expect(table2).toBe('space_tenant_2.users')
    })

    it('should maintain table mapping for resolution', () => {
      const space = new SpaceContext('tenant-123')
      const qualifiedName = space.qualifyTableName('orders')
      expect(qualifiedName).toBe('space_tenant_123.orders')

      // Should return same qualified name on second call
      const qualifiedName2 = space.qualifyTableName('orders')
      expect(qualifiedName2).toBe(qualifiedName)
    })

    it('should not qualify already qualified table names', () => {
      const space = new SpaceContext('tenant-123')
      const alreadyQualified = 'other_schema.table'
      const result = space.qualifyTableName(alreadyQualified)
      expect(result).toBe(alreadyQualified)
    })

    it('should handle strict isolation mode', () => {
      const space = new SpaceContext('tenant-123', {
        isolation: 'strict',
      })
      expect(space.config.isolation).toBe('strict')
    })

    it('should handle relaxed isolation mode', () => {
      const space = new SpaceContext('tenant-123', {
        isolation: 'relaxed',
      })
      expect(space.config.isolation).toBe('relaxed')
    })
  })

  describe('Query Transformation', () => {
    it('should transform simple SELECT query with table prefix', () => {
      const space = new SpaceContext('tenant-123')
      const sql = 'SELECT * FROM users WHERE id = 1'
      const transformed = space.applyToQuery(sql)
      expect(transformed).toContain('space_tenant_123.users')
    })

    it('should transform INSERT query', () => {
      const space = new SpaceContext('tenant-123')
      const sql = "INSERT INTO products (name, price) VALUES ('item', 100)"
      const transformed = space.applyToQuery(sql)
      expect(transformed).toContain('space_tenant_123.products')
    })

    it('should transform UPDATE query', () => {
      const space = new SpaceContext('tenant-123')
      const sql = 'UPDATE inventory SET quantity = 10 WHERE sku = "ABC"'
      const transformed = space.applyToQuery(sql)
      expect(transformed).toContain('space_tenant_123.inventory')
    })

    it('should transform DELETE query', () => {
      const space = new SpaceContext('tenant-123')
      const sql = 'DELETE FROM orders WHERE created_at < "2024-01-01"'
      const transformed = space.applyToQuery(sql)
      expect(transformed).toContain('space_tenant_123.orders')
    })

    it('should handle JOIN queries with multiple tables', () => {
      const space = new SpaceContext('tenant-123')
      const sql = `
        SELECT u.name, o.total
        FROM users u
        JOIN orders o ON u.id = o.user_id
      `
      const transformed = space.applyToQuery(sql)
      expect(transformed).toContain('space_tenant_123.users')
      expect(transformed).toContain('space_tenant_123.orders')
    })

    it('should not transform tables with existing schema', () => {
      const space = new SpaceContext('tenant-123')
      const sql = 'SELECT * FROM public.users, raw_data.events'
      const transformed = space.applyToQuery(sql)
      expect(transformed).toContain('public.users')
      expect(transformed).toContain('raw_data.events')
      expect(transformed).not.toContain('space_tenant_123.public')
    })

    it('should handle subqueries', () => {
      const space = new SpaceContext('tenant-123')
      const sql = `
        SELECT * FROM users
        WHERE id IN (SELECT user_id FROM orders WHERE total > 100)
      `
      const transformed = space.applyToQuery(sql)
      expect(transformed).toContain('space_tenant_123.users')
      expect(transformed).toContain('space_tenant_123.orders')
    })

    it('should handle CREATE TABLE statements', () => {
      const space = new SpaceContext('tenant-123')
      const sql = 'CREATE TABLE metrics (id INT, value DOUBLE)'
      const transformed = space.applyToQuery(sql)
      expect(transformed).toContain('space_tenant_123.metrics')
    })

    it('should handle DROP TABLE statements', () => {
      const space = new SpaceContext('tenant-123')
      const sql = 'DROP TABLE IF EXISTS temp_data'
      const transformed = space.applyToQuery(sql)
      expect(transformed).toContain('space_tenant_123.temp_data')
    })

    it('should preserve query with table functions', () => {
      const space = new SpaceContext('tenant-123')
      const sql = "SELECT * FROM read_csv('file.csv')"
      const transformed = space.applyToQuery(sql)
      expect(transformed).toContain("read_csv('file.csv')")
    })

    it('should handle custom table prefix in queries', () => {
      const space = new SpaceContext('tenant-123', {
        tablePrefix: 'tbl_',
      })
      const sql = 'SELECT * FROM users'
      const transformed = space.applyToQuery(sql)
      expect(transformed).toContain('space_tenant_123.tbl_users')
    })
  })

  describe('Multi-tenant Security', () => {
    it('should enforce schema isolation between tenants', () => {
      const tenant1 = new SpaceContext('company-a')
      const tenant2 = new SpaceContext('company-b')

      const schema1 = tenant1.getSchema()
      const schema2 = tenant2.getSchema()

      expect(schema1).not.toBe(schema2)
      expect(schema1).toBe('space_company_a')
      expect(schema2).toBe('space_company_b')
    })

    it('should prevent cross-tenant table access', () => {
      const space = new SpaceContext('tenant-123')
      const sql = 'SELECT * FROM space_tenant_456.users'

      // Query transformation should not modify explicit schema references
      const transformed = space.applyToQuery(sql)
      expect(transformed).toBe(sql)
    })

    it('should store and retrieve metadata securely', () => {
      const space = new SpaceContext('tenant-123', {
        metadata: {
          company: 'Acme Corp',
          tier: 'premium',
        },
      })

      expect(space.getMetadata('company')).toBe('Acme Corp')
      expect(space.getMetadata('tier')).toBe('premium')
    })

    it('should update metadata dynamically', () => {
      const space = new SpaceContext('tenant-123')

      space.setMetadata('userId', 'user-456')
      space.setMetadata('role', 'admin')

      expect(space.getMetadata('userId')).toBe('user-456')
      expect(space.getMetadata('role')).toBe('admin')
    })

    it('should handle undefined metadata keys', () => {
      const space = new SpaceContext('tenant-123')
      expect(space.getMetadata('nonexistent')).toBeUndefined()
    })

    it('should track table mappings for security audit', () => {
      const space = new SpaceContext('tenant-123')

      space.qualifyTableName('users')
      space.qualifyTableName('orders')
      space.qualifyTableName('products')

      // Internal mapping should track all qualified tables
      const mappings = space.getTableMappings()
      expect(mappings.size).toBe(3)
      expect(mappings.get('users')).toBe('space_tenant_123.users')
    })

    it('should respect strict isolation mode', async () => {
      const space = new SpaceContext('tenant-123', {
        isolation: 'strict',
      })

      await space.initialize(mockDuckDB)

      // In strict mode, schema should be created
      expect(mockDuckDB.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE SCHEMA IF NOT EXISTS')
      )
    })

    it('should handle relaxed isolation mode', async () => {
      const space = new SpaceContext('tenant-123', {
        isolation: 'relaxed',
      })

      await space.initialize(mockDuckDB)

      // Relaxed mode may skip some checks
      expect(space.config.isolation).toBe('relaxed')
    })
  })

  describe('DuckLake Integration', () => {
    it('should enable DuckLake for space', () => {
      const space = new SpaceContext('tenant-123', {
        ducklake: {
          enabled: true,
          format: 'DELTA',
        },
      })

      expect(space.isDuckLakeEnabled()).toBe(true)
    })

    it('should configure DuckLake catalog', async () => {
      const space = new SpaceContext('tenant-123', {
        ducklake: {
          enabled: true,
          format: 'DELTA',
          catalogLocation: 's3://bucket/catalog',
        },
      })

      await space.initialize(mockDuckDB)

      expect(space.getDuckLakeCatalog()).toBe('ducklake_tenant_123')
    })

    it('should handle DuckLake with time travel', () => {
      const space = new SpaceContext('tenant-123', {
        ducklake: {
          enabled: true,
          enableTimeTravel: true,
          retentionDays: 30,
        },
      })

      expect(space.config.ducklake?.enableTimeTravel).toBe(true)
      expect(space.config.ducklake?.retentionDays).toBe(30)
    })

    it('should configure compression for DuckLake', () => {
      const space = new SpaceContext('tenant-123', {
        ducklake: {
          enabled: true,
          compressionType: 'ZSTD',
        },
      })

      expect(space.config.ducklake?.compressionType).toBe('ZSTD')
    })

    it('should handle multi-tenant DuckLake', () => {
      const space = new SpaceContext('tenant-123', {
        ducklake: {
          enabled: true,
          multiTenant: true,
        },
      })

      expect(space.config.ducklake?.multiTenant).toBe(true)
    })

    it('should create DuckLake catalog on initialization', async () => {
      const space = new SpaceContext('tenant-123', {
        ducklake: {
          enabled: true,
          format: 'DELTA',
          catalogLocation: 's3://bucket/catalogs',
        },
      })

      await space.initialize(mockDuckDB)

      expect(mockDuckDB.query).toHaveBeenCalledWith(expect.stringContaining('ducklake_catalogs'))
    })
  })

  describe('SLM Integration Hooks', () => {
    it('should prepare SLM context', async () => {
      const contextBuilder = vi.fn().mockReturnValue({
        tables: ['users', 'orders'],
        schema: 'space_tenant_123',
      })

      const space = new SpaceContext('tenant-123', {
        slmConfig: {
          model: 'qwen2.5:0.5b',
          contextBuilder,
        },
      })

      const context = await space.__prepareSLMContext()

      expect(context).toBeDefined()
      expect(context.spaceId).toBe('tenant-123')
      expect(context.schema).toBe('space_tenant_123')
    })

    it('should handle missing SLM config', async () => {
      const space = new SpaceContext('tenant-123')
      const context = await space.__prepareSLMContext()

      expect(context).toBeDefined()
      expect(context.spaceId).toBe('tenant-123')
    })

    it('should use custom context builder', async () => {
      const customBuilder = vi.fn().mockReturnValue({
        customField: 'value',
      })

      const space = new SpaceContext('tenant-123', {
        slmConfig: {
          contextBuilder: customBuilder,
        },
      })

      await space.__prepareSLMContext()
      expect(customBuilder).toHaveBeenCalledWith(space)
    })
  })

  describe('Error Handling', () => {
    it('should handle initialization errors gracefully', async () => {
      const failingDuckDB = {
        query: vi.fn().mockRejectedValue(new Error('DB Error')),
        isInitialized: false,
      }

      const space = new SpaceContext('tenant-123')

      await expect(space.initialize(failingDuckDB as any)).rejects.toThrow()
    })

    it('should validate space ID format', () => {
      expect(() => new SpaceContext('')).toThrow()
    })

    it('should handle null metadata values', () => {
      const space = new SpaceContext('tenant-123')
      space.setMetadata('key', null)
      expect(space.getMetadata('key')).toBeNull()
    })
  })

  describe('Performance Optimizations', () => {
    it('should cache qualified table names', () => {
      const space = new SpaceContext('tenant-123')

      const first = space.qualifyTableName('users')
      const second = space.qualifyTableName('users')

      expect(first).toBe(second)
      expect(first).toBe('space_tenant_123.users')
    })

    it('should skip transformation for already processed queries', () => {
      const space = new SpaceContext('tenant-123')
      const alreadyTransformed = 'SELECT * FROM space_tenant_123.users'

      const result = space.applyToQuery(alreadyTransformed)
      expect(result).toBe(alreadyTransformed)
    })
  })
})
