import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryRouter, QueryPlan, QueryResult } from './QueryRouter'
import { DuckDBService } from '../duckdb/service'
import { MCPConnectionPool } from './ConnectionPool'
import { ResourceRegistry } from './ResourceRegistry'

// Mock the logger
vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock fs/promises for temp file operations
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

describe('QueryRouter', () => {
  let router: QueryRouter
  let mockDuckDB: any
  let mockConnectionPool: any
  let mockResourceRegistry: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock DuckDBService
    mockDuckDB = {
      executeQuery: vi.fn().mockResolvedValue([
        { id: 1, name: 'Row 1' },
        { id: 2, name: 'Row 2' },
      ]),
      createTableFromJSON: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }

    // Mock ConnectionPool
    mockConnectionPool = {
      getClient: vi.fn().mockResolvedValue({
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'query_sql', description: 'Execute SQL query' }],
        }),
        callTool: vi.fn().mockResolvedValue({
          content: [{ id: 1, value: 'remote' }],
        }),
        readResource: vi.fn().mockResolvedValue({
          contents: [{ text: JSON.stringify([{ id: 1, value: 'resource' }]) }],
        }),
      }),
    }

    // Mock ResourceRegistry
    mockResourceRegistry = {
      getServerResources: vi
        .fn()
        .mockReturnValue([{ uri: 'data.json', fullUri: 'mcp://server1/data.json' }]),
      resolve: vi.fn().mockReturnValue({
        server: 'server1',
        resource: { uri: 'data.json' },
      }),
    }

    router = new QueryRouter(mockDuckDB, mockConnectionPool, mockResourceRegistry)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Query Analysis', () => {
    it('should detect local queries without federation', () => {
      const sql = 'SELECT * FROM users WHERE age > 18'
      const plan = router.analyzeQuery(sql)

      expect(plan.requiresFederation).toBe(false)
      expect(plan.localQuery).toBe(sql)
      expect(plan.remoteQueries.size).toBe(0)
    })

    it('should detect MCP URI references requiring federation', () => {
      const sql = "SELECT * FROM 'mcp://github/data.json' WHERE value > 10"
      const plan = router.analyzeQuery(sql)

      expect(plan.requiresFederation).toBe(true)
      expect(plan.remoteQueries.has('github')).toBe(true)
      expect(plan.remoteQueries.get('github')).toContain('data.json')
    })

    it('should detect multiple MCP URIs in query', () => {
      const sql = `
        SELECT a.*, b.value
        FROM 'mcp://server1/table1.json' a
        JOIN 'mcp://server2/table2.json' b ON a.id = b.id
      `
      const plan = router.analyzeQuery(sql)

      expect(plan.requiresFederation).toBe(true)
      expect(plan.remoteQueries.size).toBe(2)
      expect(plan.remoteQueries.has('server1')).toBe(true)
      expect(plan.remoteQueries.has('server2')).toBe(true)
    })

    it('should detect server.table format references', () => {
      const sql = 'SELECT * FROM github.issues WHERE status = "open"'
      const plan = router.analyzeQuery(sql)

      expect(plan.requiresFederation).toBe(true)
      expect(plan.remoteQueries.has('github')).toBe(true)
    })

    it('should determine join strategy for multi-source queries', () => {
      const sql = `
        SELECT * FROM 'mcp://server1/data.json' a
        JOIN 'mcp://server2/data.json' b ON a.id = b.id
        ORDER BY a.name
      `
      const plan = router.analyzeQuery(sql)

      expect(plan.joinStrategy).toBe('merge') // Due to ORDER BY
    })

    it('should use hash join by default', () => {
      const sql = `
        SELECT * FROM 'mcp://server1/data.json' a
        JOIN 'mcp://server2/data.json' b ON a.id = b.id
      `
      const plan = router.analyzeQuery(sql)

      expect(plan.joinStrategy).toBe('hash')
    })

    it('should use nested join for IN clauses', () => {
      const sql = `
        SELECT * FROM 'mcp://server1/data.json'
        WHERE id IN (SELECT id FROM 'mcp://server2/data.json')
      `
      const plan = router.analyzeQuery(sql)

      expect(plan.joinStrategy).toBe('nested')
    })

    it('should handle complex nested queries', () => {
      const sql = `
        WITH remote_data AS (
          SELECT * FROM 'mcp://server1/data.json'
        )
        SELECT r.*, l.name
        FROM remote_data r
        JOIN local_table l ON r.id = l.remote_id
      `
      const plan = router.analyzeQuery(sql)

      expect(plan.requiresFederation).toBe(true)
      expect(plan.remoteQueries.has('server1')).toBe(true)
    })
  })

  describe('Query Execution', () => {
    it('should execute local queries without federation', async () => {
      const sql = 'SELECT * FROM users'
      const result = await router.executeQuery(sql)

      expect(result.data).toHaveLength(2)
      expect(result.metadata?.sourcesQueried).toEqual(['local'])
      expect(mockConnectionPool.getClient).not.toHaveBeenCalled()
    })

    it('should execute federated query with single remote source', async () => {
      const sql = "SELECT * FROM 'mcp://github/issues.json'"

      const result = await router.executeQuery(sql)

      expect(mockConnectionPool.getClient).toHaveBeenCalled()
      expect(mockDuckDB.createTableFromJSON).toHaveBeenCalled()
      expect(result.metadata?.sourcesQueried).toContain('github')
    })

    it('should execute federated query with multiple sources', async () => {
      const sql = `
        SELECT * FROM 'mcp://server1/data.json' a
        JOIN 'mcp://server2/data.json' b ON a.id = b.id
      `

      mockResourceRegistry.getServerResources.mockImplementation((server) => {
        return [{ uri: 'data.json', fullUri: `mcp://${server}/data.json` }]
      })

      const result = await router.executeQuery(sql)

      expect(mockConnectionPool.getClient).toHaveBeenCalledTimes(2)
      expect(result.metadata?.sourcesQueried).toContain('server1')
      expect(result.metadata?.sourcesQueried).toContain('server2')
    })

    it('should handle query tool if available on remote server', async () => {
      const sql = "SELECT * FROM 'mcp://analytics/metrics'"

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'execute_query', description: 'Run SQL query' }],
        }),
        callTool: vi.fn().mockResolvedValue({
          content: [{ metric: 'cpu', value: 85 }],
        }),
      }
      mockConnectionPool.getClient.mockResolvedValue(mockClient)

      await router.executeQuery(sql)

      expect(mockClient.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'execute_query',
        })
      )
    })

    it('should fallback to resource reading when no query tool', async () => {
      const sql = "SELECT * FROM 'mcp://storage/data.json'"

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        readResource: vi.fn().mockResolvedValue({
          contents: [{ text: JSON.stringify([{ id: 1 }]) }],
        }),
      }
      mockConnectionPool.getClient.mockResolvedValue(mockClient)

      await router.executeQuery(sql)

      expect(mockClient.readResource).toHaveBeenCalled()
    })

    it('should create temp tables for remote data', async () => {
      const sql = "SELECT * FROM 'mcp://remote/data.json'"

      await router.executeQuery(sql)

      expect(mockDuckDB.createTableFromJSON).toHaveBeenCalledWith(
        expect.stringMatching(/^temp_remote_\d+$/),
        expect.any(Array)
      )
    })

    it('should clean up temp tables after query', async () => {
      const sql = "SELECT * FROM 'mcp://remote/data.json'"

      await router.executeQuery(sql)

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(
        expect.stringMatching(/DROP TABLE IF EXISTS temp_remote_\d+/)
      )
    })

    it('should handle CSV data from remote source', async () => {
      const csvData = 'id,name\n1,Alice\n2,Bob'

      mockConnectionPool.getClient.mockResolvedValue({
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        readResource: vi.fn().mockResolvedValue({
          contents: [{ text: csvData }],
        }),
      })

      const sql = "SELECT * FROM 'mcp://csv/data.csv'"
      await router.executeQuery(sql)

      // Should write CSV to temp file and read it
      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(expect.stringContaining('read_csv_auto'))
    })

    it('should handle binary data (Parquet) from remote source', async () => {
      const binaryData = Buffer.from('parquet-data')

      mockConnectionPool.getClient.mockResolvedValue({
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        readResource: vi.fn().mockResolvedValue({
          contents: [{ blob: binaryData.toString('base64') }],
        }),
      })

      const sql = "SELECT * FROM 'mcp://storage/data.parquet'"
      await router.executeQuery(sql)

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(expect.stringContaining('read_parquet'))
    })

    it('should track execution time in metadata', async () => {
      const sql = 'SELECT * FROM users'
      const result = await router.executeQuery(sql)

      expect(result.metadata?.executionTime).toBeGreaterThanOrEqual(0)
      expect(typeof result.metadata?.executionTime).toBe('number')
    })

    it('should handle empty result sets', async () => {
      mockDuckDB.executeQuery.mockResolvedValue([])

      const sql = 'SELECT * FROM users WHERE 1=0'
      const result = await router.executeQuery(sql)

      expect(result.data).toEqual([])
      expect(result.metadata?.rowCount).toBe(0)
    })
  })

  describe('Query Streaming', () => {
    it('should stream local query results', async () => {
      const sql = 'SELECT * FROM users'
      const results = []

      for await (const row of router.executeQueryStream(sql)) {
        results.push(row)
      }

      expect(results).toHaveLength(2)
      expect(results[0]).toHaveProperty('id', 1)
    })

    it('should stream federated query results', async () => {
      const sql = "SELECT * FROM 'mcp://remote/data.json'"
      const results = []

      for await (const row of router.executeQueryStream(sql)) {
        results.push(row)
      }

      expect(results.length).toBeGreaterThan(0)
    })

    it('should handle non-array results in stream', async () => {
      mockDuckDB.executeQuery.mockResolvedValue({ count: 42 })

      const sql = 'SELECT COUNT(*) as count FROM users'
      const results = []

      for await (const row of router.executeQueryStream(sql)) {
        results.push(row)
      }

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({ count: 42 })
    })
  })

  describe('Error Handling', () => {
    it('should handle missing server resources', async () => {
      mockResourceRegistry.getServerResources.mockReturnValue([])

      const sql = "SELECT * FROM 'mcp://unknown/data.json'"

      await expect(router.executeQuery(sql)).rejects.toThrow('No resources found for server')
    })

    it('should handle unresolvable URIs', async () => {
      mockResourceRegistry.resolve.mockReturnValue(null)

      const sql = "SELECT * FROM 'mcp://server/data.json'"

      await expect(router.executeQuery(sql)).rejects.toThrow('Cannot resolve server URL')
    })

    it('should handle remote fetch failures', async () => {
      mockConnectionPool.getClient.mockRejectedValue(new Error('Connection failed'))

      const sql = "SELECT * FROM 'mcp://remote/data.json'"

      await expect(router.executeQuery(sql)).rejects.toThrow('Failed to fetch remote data')
    })

    it('should handle unsupported data types', async () => {
      mockConnectionPool.getClient.mockResolvedValue({
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        readResource: vi.fn().mockResolvedValue({
          contents: [{ unknown: 'format' }],
        }),
      })

      const sql = "SELECT * FROM 'mcp://remote/data'"

      await expect(router.executeQuery(sql)).rejects.toThrow()
    })

    it('should handle temp table cleanup failures gracefully', async () => {
      mockDuckDB.executeQuery.mockImplementation((sql) => {
        if (sql.includes('DROP TABLE')) {
          throw new Error('Cannot drop table')
        }
        return Promise.resolve([])
      })

      const sql = "SELECT * FROM 'mcp://remote/data.json'"

      // Should not throw even if cleanup fails
      await expect(router.executeQuery(sql)).resolves.toBeDefined()
    })

    it('should handle invalid JSON from remote source', async () => {
      mockConnectionPool.getClient.mockResolvedValue({
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        readResource: vi.fn().mockResolvedValue({
          contents: [{ text: 'invalid-json' }],
        }),
      })

      const sql = "SELECT * FROM 'mcp://remote/data.json'"

      // Should treat as CSV/text when JSON parse fails
      await router.executeQuery(sql)

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(expect.stringContaining('read_csv_auto'))
    })
  })

  describe('Query Explanation', () => {
    it('should explain local queries', () => {
      const sql = 'SELECT * FROM users'
      const explanation = router.explainQuery(sql)

      expect(explanation).toContain('Local query only')
      expect(explanation).toContain(sql)
    })

    it('should explain federated queries', () => {
      const sql = "SELECT * FROM 'mcp://github/issues.json' WHERE status = 'open'"
      const explanation = router.explainQuery(sql)

      expect(explanation).toContain('Federated query detected')
      expect(explanation).toContain('github')
      expect(explanation).toContain('2 (1 remote + 1 local)')
    })

    it('should include join strategy in explanation', () => {
      const sql = `
        SELECT * FROM 'mcp://server1/data.json'
        JOIN 'mcp://server2/data.json' USING(id)
        ORDER BY id
      `
      const explanation = router.explainQuery(sql)

      expect(explanation).toContain('Join Strategy: merge')
    })

    it('should show remote queries in explanation', () => {
      const sql = "SELECT name, value FROM 'mcp://analytics/metrics.json'"
      const explanation = router.explainQuery(sql)

      expect(explanation).toContain('Remote Queries:')
      expect(explanation).toContain('analytics:')
    })
  })

  describe('Statistics', () => {
    it('should track temp tables created', async () => {
      const sql1 = "SELECT * FROM 'mcp://server1/data.json'"
      const sql2 = "SELECT * FROM 'mcp://server2/data.json'"

      await router.executeQuery(sql1)
      await router.executeQuery(sql2)

      const stats = router.getStats()
      expect(stats.tempTablesCreated).toBe(2)
    })

    it('should track queries routed', async () => {
      await router.executeQuery('SELECT * FROM users')
      await router.executeQuery("SELECT * FROM 'mcp://remote/data.json'")

      const stats = router.getStats()
      expect(stats.queriesRouted).toBeGreaterThan(0)
    })
  })

  describe('Complex Federation Scenarios', () => {
    it('should handle mixed local and remote joins', async () => {
      const sql = `
        SELECT l.name, r.value
        FROM local_table l
        JOIN 'mcp://remote/data.json' r ON l.id = r.id
      `

      const result = await router.executeQuery(sql)

      expect(mockConnectionPool.getClient).toHaveBeenCalled()
      expect(result.metadata?.sourcesQueried).toContain('local')
      expect(result.metadata?.sourcesQueried).toContain('remote')
    })

    it('should handle subqueries with remote sources', async () => {
      const sql = `
        SELECT * FROM users
        WHERE id IN (
          SELECT user_id FROM 'mcp://analytics/active_users.json'
        )
      `

      await router.executeQuery(sql)

      expect(mockConnectionPool.getClient).toHaveBeenCalled()
      expect(mockDuckDB.createTableFromJSON).toHaveBeenCalled()
    })

    it('should handle UNION queries across sources', async () => {
      const sql = `
        SELECT id, name FROM local_users
        UNION ALL
        SELECT id, name FROM 'mcp://remote/users.json'
      `

      await router.executeQuery(sql)

      expect(mockConnectionPool.getClient).toHaveBeenCalled()
    })

    it('should handle aggregations on federated data', async () => {
      const sql = `
        SELECT
          source,
          COUNT(*) as count,
          AVG(value) as avg_value
        FROM (
          SELECT 'local' as source, value FROM local_metrics
          UNION ALL
          SELECT 'remote' as source, value FROM 'mcp://metrics/data.json'
        ) combined
        GROUP BY source
      `

      await router.executeQuery(sql)

      expect(mockConnectionPool.getClient).toHaveBeenCalled()
    })

    it('should handle window functions on federated data', async () => {
      const sql = `
        SELECT
          id,
          value,
          ROW_NUMBER() OVER (PARTITION BY source ORDER BY value DESC) as rank
        FROM (
          SELECT id, value, 'local' as source FROM local_data
          UNION ALL
          SELECT id, value, 'remote' as source FROM 'mcp://remote/data.json'
        ) combined
      `

      await router.executeQuery(sql)

      expect(mockDuckDB.executeQuery).toHaveBeenCalledWith(expect.stringContaining('ROW_NUMBER'))
    })
  })

  describe('Performance Optimizations', () => {
    it('should fetch remote data in parallel', async () => {
      const sql = `
        SELECT * FROM 'mcp://server1/data.json' a
        JOIN 'mcp://server2/data.json' b ON a.id = b.id
        JOIN 'mcp://server3/data.json' c ON b.id = c.id
      `

      mockResourceRegistry.getServerResources.mockImplementation((server) => {
        return [{ uri: 'data.json', fullUri: `mcp://${server}/data.json` }]
      })

      const fetchPromises: Promise<any>[] = []
      mockConnectionPool.getClient.mockImplementation(() => {
        const promise = new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              listTools: vi.fn().mockResolvedValue({ tools: [] }),
              readResource: vi.fn().mockResolvedValue({
                contents: [{ text: JSON.stringify([{ id: 1 }]) }],
              }),
            })
          }, 10)
        })
        fetchPromises.push(promise)
        return promise
      })

      await router.executeQuery(sql)

      // All fetches should start in parallel
      expect(fetchPromises).toHaveLength(3)
    })

    it('should reuse temp table names efficiently', async () => {
      const sql1 = "SELECT * FROM 'mcp://server1/data.json'"
      const sql2 = "SELECT * FROM 'mcp://server2/data.json'"

      await router.executeQuery(sql1)
      await router.executeQuery(sql2)

      const stats = router.getStats()
      expect(stats.tempTablesCreated).toBe(2)

      // Table names should be sequential
      expect(mockDuckDB.createTableFromJSON).toHaveBeenNthCalledWith(
        1,
        'temp_server1_1',
        expect.any(Array)
      )
      expect(mockDuckDB.createTableFromJSON).toHaveBeenNthCalledWith(
        2,
        'temp_server2_2',
        expect.any(Array)
      )
    })
  })

  describe('Edge Cases', () => {
    it('should handle queries with no FROM clause', () => {
      const sql = 'SELECT 1 as value, NOW() as timestamp'
      const plan = router.analyzeQuery(sql)

      expect(plan.requiresFederation).toBe(false)
      expect(plan.localQuery).toBe(sql)
    })

    it('should handle queries with comments', () => {
      const sql = `
        -- Get data from remote source
        SELECT * FROM 'mcp://remote/data.json'
        /* WHERE active = true */
      `
      const plan = router.analyzeQuery(sql)

      expect(plan.requiresFederation).toBe(true)
      expect(plan.remoteQueries.has('remote')).toBe(true)
    })

    it('should handle case-insensitive MCP URIs', () => {
      const sql = "SELECT * FROM 'MCP://REMOTE/DATA.JSON'"
      const plan = router.analyzeQuery(sql)

      expect(plan.requiresFederation).toBe(true)
      expect(plan.remoteQueries.has('REMOTE')).toBe(true)
    })

    it('should handle queries with CTEs', () => {
      const sql = `
        WITH remote_cte AS (
          SELECT * FROM 'mcp://remote/data.json'
        ),
        local_cte AS (
          SELECT * FROM users
        )
        SELECT * FROM remote_cte JOIN local_cte USING(id)
      `
      const plan = router.analyzeQuery(sql)

      expect(plan.requiresFederation).toBe(true)
    })

    it('should handle empty remote data gracefully', async () => {
      mockConnectionPool.getClient.mockResolvedValue({
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        readResource: vi.fn().mockResolvedValue({
          contents: [{ text: '[]' }],
        }),
      })

      const sql = "SELECT * FROM 'mcp://empty/data.json'"
      const result = await router.executeQuery(sql)

      expect(result.data).toEqual([])
      expect(result.metadata?.rowCount).toBe(0)
    })
  })
})
