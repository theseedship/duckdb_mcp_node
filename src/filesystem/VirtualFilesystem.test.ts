/**
 * Tests for Virtual Filesystem
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { URIParser } from './URIParser.js'
import { FormatDetector } from './FormatDetector.js'
import { QueryPreprocessor } from './QueryPreprocessor.js'
import { CacheManager } from './CacheManager.js'
import { VirtualFilesystem } from './VirtualFilesystem.js'
import { ResourceRegistry } from '../federation/ResourceRegistry.js'
import { MCPConnectionPool } from '../federation/ConnectionPool.js'

describe('URIParser', () => {
  describe('parse', () => {
    it('should parse basic MCP URI', () => {
      const result = URIParser.parse('mcp://weather-server/data/forecast.csv')

      expect(result.protocol).toBe('mcp')
      expect(result.server).toBe('weather-server')
      expect(result.path).toBe('/data/forecast.csv')
      expect(result.filename).toBe('forecast.csv')
      expect(result.extension).toBe('csv')
      expect(result.format).toBe('csv')
      expect(result.isGlob).toBe(false)
    })

    it('should parse URI with query parameters', () => {
      const result = URIParser.parse('mcp://server/path?param1=value1&param2=value2')

      expect(result.server).toBe('server')
      expect(result.path).toBe('/path')
      expect(result.queryParams?.get('param1')).toBe('value1')
      expect(result.queryParams?.get('param2')).toBe('value2')
    })

    it('should detect glob patterns', () => {
      const result = URIParser.parse('mcp://*/logs/*.json')

      expect(result.isGlob).toBe(true)
      expect(result.server).toBe('*')
      expect(result.path).toBe('/logs/*.json')
    })

    it('should detect format from extension', () => {
      expect(URIParser.parse('mcp://server/data.json').format).toBe('json')
      expect(URIParser.parse('mcp://server/data.parquet').format).toBe('parquet')
      expect(URIParser.parse('mcp://server/data.csv').format).toBe('csv')
      expect(URIParser.parse('mcp://server/data.xlsx').format).toBe('excel')
      expect(URIParser.parse('mcp://server/data.arrow').format).toBe('arrow')
    })

    it('should throw on invalid URI', () => {
      expect(() => URIParser.parse('http://server/path')).toThrow('Invalid MCP URI')
      expect(() => URIParser.parse('server/path')).toThrow('Invalid MCP URI')
    })
  })

  describe('extractFromSQL', () => {
    it('should extract MCP URIs from SQL queries', () => {
      const sql = `
        SELECT * FROM 'mcp://weather-server/forecast.csv'
        JOIN "mcp://database-server/users.json" USING (user_id)
        WHERE data IN (SELECT * FROM read_csv('mcp://logs/2024.csv'))
      `

      const uris = URIParser.extractFromSQL(sql)

      expect(uris).toContain('mcp://weather-server/forecast.csv')
      expect(uris).toContain('mcp://database-server/users.json')
      expect(uris).toContain('mcp://logs/2024.csv')
      expect(uris.length).toBe(3)
    })

    it('should handle read_* functions', () => {
      const sql = `
        SELECT * FROM read_parquet('mcp://data/file.parquet')
        UNION ALL
        SELECT * FROM read_json_auto(mcp://data/file.json)
      `

      const uris = URIParser.extractFromSQL(sql)

      expect(uris).toContain('mcp://data/file.parquet')
      expect(uris).toContain('mcp://data/file.json')
    })
  })

  describe('expandGlob', () => {
    it('should expand glob patterns', () => {
      const resources = [
        { server: 'server1', path: '/logs/2024-01.json' },
        { server: 'server1', path: '/logs/2024-02.json' },
        { server: 'server2', path: '/logs/2024-01.json' },
        { server: 'server1', path: '/data/users.csv' },
      ]

      const expanded = URIParser.expandGlob('mcp://server1/logs/*.json', resources)

      expect(expanded).toContain('mcp://server1/logs/2024-01.json')
      expect(expanded).toContain('mcp://server1/logs/2024-02.json')
      expect(expanded.length).toBe(2)
    })

    it('should handle server wildcards', () => {
      const resources = [
        { server: 'server1', path: '/data.json' },
        { server: 'server2', path: '/data.json' },
      ]

      const expanded = URIParser.expandGlob('mcp://*/data.json', resources)

      expect(expanded).toContain('mcp://server1/data.json')
      expect(expanded).toContain('mcp://server2/data.json')
      expect(expanded.length).toBe(2)
    })
  })
})

describe('FormatDetector', () => {
  describe('fromExtension', () => {
    it('should detect common formats', () => {
      expect(FormatDetector.fromExtension('file.csv')).toBe('csv')
      expect(FormatDetector.fromExtension('file.json')).toBe('json')
      expect(FormatDetector.fromExtension('file.parquet')).toBe('parquet')
      expect(FormatDetector.fromExtension('file.arrow')).toBe('arrow')
      expect(FormatDetector.fromExtension('file.xlsx')).toBe('excel')
      expect(FormatDetector.fromExtension('file.unknown')).toBe('unknown')
    })

    it('should be case-insensitive', () => {
      expect(FormatDetector.fromExtension('FILE.CSV')).toBe('csv')
      expect(FormatDetector.fromExtension('File.JSON')).toBe('json')
    })
  })

  describe('fromContent', () => {
    it('should detect JSON from content', () => {
      const jsonBuffer = Buffer.from('{"key": "value"}')
      expect(FormatDetector.fromContent(jsonBuffer)).toBe('json')

      const arrayBuffer = Buffer.from('[1, 2, 3]')
      expect(FormatDetector.fromContent(arrayBuffer)).toBe('json')
    })

    it('should detect CSV from content', () => {
      const csvBuffer = Buffer.from('name,age,city\nJohn,30,NYC\nJane,25,LA')
      expect(FormatDetector.fromContent(csvBuffer)).toBe('csv')
    })

    it('should detect Parquet magic number', () => {
      // Parquet starts with PAR1
      const parquetBuffer = Buffer.from([0x50, 0x41, 0x52, 0x31])
      expect(FormatDetector.fromContent(parquetBuffer)).toBe('parquet')
    })
  })

  describe('buildReadQuery', () => {
    it('should build correct DuckDB read functions', () => {
      expect(FormatDetector.buildReadQuery('/path/file.csv', 'csv')).toBe(
        "read_csv_auto('/path/file.csv')"
      )

      expect(FormatDetector.buildReadQuery('/path/file.json', 'json')).toBe(
        "read_json_auto('/path/file.json')"
      )

      expect(FormatDetector.buildReadQuery('/path/file.parquet', 'parquet')).toBe(
        "read_parquet('/path/file.parquet')"
      )
    })

    it('should escape single quotes in paths', () => {
      expect(FormatDetector.buildReadQuery("/path/file's.csv", 'csv')).toBe(
        "read_csv_auto('/path/file''s.csv')"
      )
    })
  })
})

describe('QueryPreprocessor', () => {
  describe('transform', () => {
    it('should transform MCP URIs to local paths', async () => {
      const resolver = vi.fn().mockResolvedValue('/tmp/cache/abc123.csv')

      const sql = "SELECT * FROM 'mcp://server/data.csv'"

      const result = await QueryPreprocessor.transform(sql, resolver)

      expect(resolver).toHaveBeenCalledWith('mcp://server/data.csv')
      expect(result.transformedQuery).toBe("SELECT * FROM read_csv_auto('/tmp/cache/abc123.csv')")
      expect(result.urisToResolve.length).toBe(0)
    })

    it('should handle multiple URIs', async () => {
      const resolver = vi
        .fn()
        .mockResolvedValueOnce('/tmp/cache/file1.csv')
        .mockResolvedValueOnce('/tmp/cache/file2.json')

      const sql = `
        SELECT * FROM 'mcp://server1/data.csv'
        JOIN 'mcp://server2/users.json' USING (id)
      `

      const result = await QueryPreprocessor.transform(sql, resolver)

      expect(resolver).toHaveBeenCalledTimes(2)
      expect(result.transformedQuery).toContain("read_csv_auto('/tmp/cache/file1.csv')")
      expect(result.transformedQuery).toContain("read_json_auto('/tmp/cache/file2.json')")
    })

    it('should track URIs that need resolution', async () => {
      const resolver = vi.fn().mockResolvedValue(null)

      const sql = "SELECT * FROM 'mcp://server/data.csv'"

      const result = await QueryPreprocessor.transform(sql, resolver)

      expect(result.urisToResolve).toContain('mcp://server/data.csv')
      expect(result.replacements[0].needsResolution).toBe(true)
    })
  })

  describe('validate', () => {
    it('should validate transformed queries', () => {
      expect(QueryPreprocessor.validate('SELECT * FROM table')).toBe(true)
      expect(QueryPreprocessor.validate('CREATE TABLE test AS SELECT 1')).toBe(true)
      expect(QueryPreprocessor.validate('INSERT INTO table VALUES (1)')).toBe(true)
    })

    it('should detect remaining MCP URIs', () => {
      expect(QueryPreprocessor.validate("SELECT * FROM 'mcp://server/data.csv'")).toBe(false)
    })

    it('should detect invalid SQL', () => {
      expect(QueryPreprocessor.validate('NOT A VALID QUERY')).toBe(false)
    })
  })
})

describe('CacheManager', () => {
  let cache: CacheManager

  beforeEach(async () => {
    cache = new CacheManager({
      cacheDir: '/tmp/test-cache-' + Date.now(),
      defaultTTL: 1000,
    })
    await cache.initialize()
  })

  afterEach(async () => {
    await cache.destroy()
  })

  describe('caching', () => {
    it('should cache and retrieve resources', async () => {
      const uri = 'mcp://server/data.csv'
      const data = Buffer.from('name,age\nJohn,30')

      const path = await cache.cacheResource(uri, data, 'csv')

      expect(path).toMatch(/\.csv$/)

      const cachedPath = await cache.getCachedPath(uri)
      expect(cachedPath).toBe(path)
    })

    it('should handle cache expiration', async () => {
      const uri = 'mcp://server/data.csv'
      const data = Buffer.from('test')

      // Cache with very short TTL
      await cache.cacheResource(uri, data, 'csv', 1)

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10))

      const cachedPath = await cache.getCachedPath(uri)
      expect(cachedPath).toBeNull()
    })

    it('should track cache statistics', async () => {
      const uri1 = 'mcp://server/data1.csv'
      const uri2 = 'mcp://server/data2.csv'

      await cache.cacheResource(uri1, Buffer.from('test1'), 'csv')
      await cache.cacheResource(uri2, Buffer.from('test2'), 'csv')

      const stats = cache.getStats()

      expect(stats.itemCount).toBe(2)
      expect(stats.totalSize).toBeGreaterThan(0)
    })
  })
})

describe('VirtualFilesystem', () => {
  let vfs: VirtualFilesystem
  let registry: ResourceRegistry
  let pool: MCPConnectionPool
  let mockClient: any

  beforeEach(async () => {
    registry = new ResourceRegistry()
    pool = new MCPConnectionPool()

    // Standard mock client for most tests
    mockClient = {
      readResource: vi.fn().mockResolvedValue({
        contents: [
          {
            text: 'name,age\nJohn,30',
            mimeType: 'text/csv',
          },
        ],
      }),
      listResources: vi.fn().mockResolvedValue({
        resources: [],
      }),
    }
    vi.spyOn(pool, 'getClient').mockResolvedValue(mockClient)

    vfs = new VirtualFilesystem(registry, pool, {
      cacheConfig: {
        cacheDir: '/tmp/test-vfs-' + Date.now(),
      },
      autoConnect: false,
      autoDiscovery: false,
    })

    await vfs.initialize()
  })

  afterEach(async () => {
    await vfs.destroy()
    vi.clearAllMocks()
  })

  describe('processQuery', () => {
    it('should process queries with MCP URIs', async () => {
      // Mock registry with a resource - URI should match exactly what comes after server/
      registry.register('test-server', [
        {
          uri: 'data.csv', // Without leading slash to match URI structure
          name: 'Test Data',
          mimeType: 'text/csv',
        },
      ])

      // Mock connection pool with MCP SDK format
      const mockClient = {
        readResource: vi.fn().mockResolvedValue({
          contents: [
            {
              text: 'name,age\nJohn,30',
              mimeType: 'text/csv',
            },
          ],
        }),
      }
      vi.spyOn(pool, 'getClient').mockResolvedValue(mockClient as any)

      const sql = "SELECT * FROM 'mcp://test-server/data.csv'"

      const processed = await vfs.processQuery(sql)

      expect(processed).toContain('read_csv_auto')
      expect(processed).not.toContain('mcp://')
    })
  })

  describe('resource resolution', () => {
    it('should resolve URIs to local paths', async () => {
      // Mock registry - URI without leading slash
      registry.register('test-server', [
        {
          uri: 'data.json',
          name: 'Test Data',
          mimeType: 'application/json',
        },
      ])

      // Mock client - MCP SDK expects readResource to return {contents: [{text: ...}]}
      const mockClient = {
        readResource: vi.fn().mockResolvedValue({
          contents: [
            {
              text: '{"key": "value"}',
              mimeType: 'application/json',
            },
          ],
        }),
      }
      vi.spyOn(pool, 'getClient').mockResolvedValue(mockClient as any)

      const resolution = await vfs.resolveURI('mcp://test-server/data.json')

      expect(resolution).not.toBeNull()
      expect(resolution?.localPath).toMatch(/\.json$/)
      expect(resolution?.format).toBe('json')
      expect(resolution?.cached).toBe(false)
    })

    it('should use cache for repeated requests', async () => {
      // Mock registry and client - URI without leading slash
      registry.register('test-server', [
        {
          uri: 'data.csv',
          name: 'Test Data',
          mimeType: 'text/csv',
        },
      ])

      const mockClient = {
        readResource: vi.fn().mockResolvedValue({
          contents: [
            {
              text: 'test,data',
              mimeType: 'text/csv',
            },
          ],
        }),
      }
      vi.spyOn(pool, 'getClient').mockResolvedValue(mockClient as any)

      // First resolution - should fetch
      const resolution1 = await vfs.resolveURI('mcp://test-server/data.csv')
      expect(resolution1?.cached).toBe(false)

      // Second resolution - should use cache
      const resolution2 = await vfs.resolveURI('mcp://test-server/data.csv')
      expect(resolution2?.cached).toBe(true)
      expect(resolution2?.localPath).toBe(resolution1?.localPath)

      // Client should only be called once
      expect(mockClient.readResource).toHaveBeenCalledTimes(1)
    })
  })

  describe('glob patterns', () => {
    it('should expand glob patterns in queries', async () => {
      registry.register('server1', [
        { uri: 'logs/2024-01.json', name: 'Jan Logs' },
        { uri: 'logs/2024-02.json', name: 'Feb Logs' },
        { uri: 'data/users.csv', name: 'Users' },
      ])

      const sql = "SELECT * FROM 'mcp://server1/logs/*.json'"
      const processed = await vfs.processQuery(sql)

      // Should create UNION with 2 JSON files (not CSV)
      expect(processed).toContain('UNION ALL')
      expect(processed).toContain('read_json_auto')
      // Should have exactly 2 read_json_auto calls
      const jsonMatches = processed.match(/read_json_auto/g)
      expect(jsonMatches).toHaveLength(2)
      // Should not include CSV file
      expect(processed).not.toContain('read_csv')
    })

    it('should handle server wildcards', async () => {
      registry.register('server1', [{ uri: 'data.json', name: 'Data1' }])
      registry.register('server2', [{ uri: 'data.json', name: 'Data2' }])

      const sql = "SELECT * FROM 'mcp://*/data.json'"
      const processed = await vfs.processQuery(sql)

      expect(processed).toContain('UNION')
    })
  })

  describe('error handling', () => {
    it('should handle missing resources', async () => {
      const result = await vfs.resolveURI('mcp://unknown/missing.json')
      expect(result).toBeNull()
    })

    it('should handle fetch errors gracefully', async () => {
      registry.register('error-server', [{ uri: 'data.json', name: 'Data' }])
      mockClient.readResource.mockRejectedValue(new Error('Network error'))

      const result = await vfs.resolveURI('mcp://error-server/data.json')
      expect(result).toBeNull()
    })

    it('should handle invalid content format', async () => {
      registry.register('bad-server', [{ uri: 'data.bin', name: 'Binary' }])
      mockClient.readResource.mockResolvedValue({
        contents: [{ blob: 'invalidbase64!' }],
      })

      await expect(vfs.resolveURI('mcp://bad-server/data.bin')).resolves.toBeNull()
    })
  })

  describe('batch operations', () => {
    it('should resolve multiple URIs efficiently', async () => {
      registry.register('batch-server', [
        { uri: 'file1.json', name: 'File1' },
        { uri: 'file2.json', name: 'File2' },
        { uri: 'file3.json', name: 'File3' },
      ])

      const uris = [
        'mcp://batch-server/file1.json',
        'mcp://batch-server/file2.json',
        'mcp://batch-server/file3.json',
      ]

      const results = await vfs.resolveMultiple(uris)
      expect(results).toHaveLength(3)
      expect(results.every((r) => r !== null)).toBe(true)
    })

    it('should handle partial failures in batch', async () => {
      registry.register('mixed-server', [
        { uri: 'good.json', name: 'Good' },
        { uri: 'bad.json', name: 'Bad' },
      ])

      mockClient.readResource.mockImplementation(({ uri }) => {
        if (uri === 'bad.json') {
          return Promise.reject(new Error('Failed'))
        }
        return Promise.resolve({
          contents: [{ text: '{}', mimeType: 'application/json' }],
        })
      })

      const results = await vfs.resolveMultiple([
        'mcp://mixed-server/good.json',
        'mcp://mixed-server/bad.json',
      ])

      expect(results[0]).not.toBeNull()
      expect(results[1]).toBeNull()
    })
  })

  describe('statistics and monitoring', () => {
    it('should track VFS statistics', async () => {
      registry.register('stats-server', [
        { uri: 'file1.csv', name: 'File1' },
        { uri: 'file2.csv', name: 'File2' },
      ])

      await vfs.resolveURI('mcp://stats-server/file1.csv')
      await vfs.resolveURI('mcp://stats-server/file2.csv')
      await vfs.resolveURI('mcp://stats-server/file1.csv') // cached

      const stats = vfs.getStats()
      expect(stats.totalResolutions).toBe(3)
      expect(stats.cacheHits).toBe(1)
      expect(stats.cacheMisses).toBe(2)
      expect(stats.cacheHitRate).toBeCloseTo(0.33, 2)
    })

    it('should track errors in statistics', async () => {
      mockClient.readResource.mockRejectedValue(new Error('Failed'))
      registry.register('error-server', [{ uri: 'fail.json', name: 'Fail' }])

      await vfs.resolveURI('mcp://error-server/fail.json')

      const stats = vfs.getStats()
      expect(stats.errors).toBe(1)
    })
  })

  describe('advanced query transformations', () => {
    it('should handle CTEs with MCP URIs', async () => {
      registry.register('cte-server', [{ uri: 'data.json', name: 'Data' }])

      const sql = `
        WITH remote_data AS (
          SELECT * FROM 'mcp://cte-server/data.json'
        )
        SELECT * FROM remote_data WHERE value > 10
      `

      const processed = await vfs.processQuery(sql)
      expect(processed).toContain('WITH remote_data AS')
      expect(processed).toContain('read_json_auto')
      expect(processed).not.toContain('mcp://')
    })

    it('should handle subqueries with MCP URIs', async () => {
      registry.register('sub-server', [
        { uri: 'users.json', name: 'Users' },
        { uri: 'orders.json', name: 'Orders' },
      ])

      const sql = `
        SELECT * FROM 'mcp://sub-server/orders.json'
        WHERE user_id IN (
          SELECT id FROM 'mcp://sub-server/users.json'
          WHERE active = true
        )
      `

      const processed = await vfs.processQuery(sql)
      expect(processed).toContain('read_json_auto')
      expect(processed.match(/read_json_auto/g)).toHaveLength(2)
    })

    it('should handle UNION queries with MCP URIs', async () => {
      registry.register('union-server', [
        { uri: 'data1.csv', name: 'Data1' },
        { uri: 'data2.csv', name: 'Data2' },
      ])

      const sql = `
        SELECT * FROM 'mcp://union-server/data1.csv'
        UNION ALL
        SELECT * FROM 'mcp://union-server/data2.csv'
      `

      const processed = await vfs.processQuery(sql)
      expect(processed).toContain('UNION ALL')
      expect(processed).toContain('read_csv_auto')
    })
  })

  describe('auto-discovery', () => {
    it('should auto-discover resources when enabled', async () => {
      const vfsWithDiscovery = new VirtualFilesystem(registry, pool, {
        autoDiscovery: true,
        discoveryInterval: 100,
      })

      mockClient.listResources.mockResolvedValue({
        resources: [
          { uri: 'auto1.json', name: 'Auto1' },
          { uri: 'auto2.json', name: 'Auto2' },
        ],
      })

      await vfsWithDiscovery.initialize()
      await new Promise((resolve) => setTimeout(resolve, 150))

      const stats = vfsWithDiscovery.getStats()
      expect(stats.discoveredResources).toBeGreaterThan(0)

      await vfsWithDiscovery.destroy()
    })
  })

  describe('format detection', () => {
    it('should auto-detect format from content when extension unknown', async () => {
      registry.register('format-server', [{ uri: 'data.unknown', name: 'Data' }])

      mockClient.readResource.mockResolvedValue({
        contents: [{ text: '{"key":"value"}', mimeType: 'application/octet-stream' }],
      })

      const result = await vfs.resolveURI('mcp://format-server/data.unknown')
      expect(result?.format).toBe('json')
    })

    it('should handle Excel files', async () => {
      registry.register('excel-server', [{ uri: 'data.xlsx', name: 'Excel' }])

      mockClient.readResource.mockResolvedValue({
        contents: [{ blob: Buffer.from('excel-data').toString('base64') }],
      })

      const result = await vfs.resolveURI('mcp://excel-server/data.xlsx')
      expect(result?.format).toBe('excel')
    })

    it('should handle Arrow files', async () => {
      registry.register('arrow-server', [{ uri: 'data.arrow', name: 'Arrow' }])

      mockClient.readResource.mockResolvedValue({
        contents: [{ blob: Buffer.from('ARROW1').toString('base64') }],
      })

      const result = await vfs.resolveURI('mcp://arrow-server/data.arrow')
      expect(result?.format).toBe('arrow')
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent resolutions efficiently', async () => {
      registry.register('concurrent-server', [
        { uri: 'file1.json', name: 'File1' },
        { uri: 'file2.json', name: 'File2' },
        { uri: 'file3.json', name: 'File3' },
      ])

      const promises = [
        vfs.resolveURI('mcp://concurrent-server/file1.json'),
        vfs.resolveURI('mcp://concurrent-server/file2.json'),
        vfs.resolveURI('mcp://concurrent-server/file3.json'),
      ]

      const results = await Promise.all(promises)
      expect(results.every((r) => r !== null)).toBe(true)
      expect(mockClient.readResource).toHaveBeenCalledTimes(3)
    })

    it('should deduplicate concurrent requests for same resource', async () => {
      registry.register('dedup-server', [{ uri: 'data.json', name: 'Data' }])

      // Launch multiple concurrent requests for same resource
      const promises = Array(5)
        .fill(null)
        .map(() => vfs.resolveURI('mcp://dedup-server/data.json'))

      const results = await Promise.all(promises)

      // All should get same result
      expect(results.every((r) => r?.localPath === results[0]?.localPath)).toBe(true)
      // But client should only be called once
      expect(mockClient.readResource).toHaveBeenCalledTimes(1)
    })
  })
})
