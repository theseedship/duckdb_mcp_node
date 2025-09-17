import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { MCPClient } from './MCPClient.js'
import type { DuckDBService } from '../duckdb/service.js'

// Mock the MCP SDK client
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    listResources: jest.fn().mockResolvedValue({
      resources: [
        {
          uri: 'test://resource1',
          name: 'Resource 1',
          mimeType: 'application/json',
        },
        {
          uri: 'test://resource2',
          name: 'Resource 2',
          mimeType: 'text/csv',
        },
      ],
    }),
    listTools: jest.fn().mockResolvedValue({
      tools: [
        { name: 'tool1', description: 'Test tool 1' },
        { name: 'tool2', description: 'Test tool 2' },
      ],
    }),
    readResource: jest.fn().mockResolvedValue({
      contents: [
        {
          text: JSON.stringify([{ id: 1, name: 'test' }]),
          mimeType: 'application/json',
        },
      ],
    }),
    callTool: jest.fn().mockResolvedValue({
      result: 'tool executed',
    }),
  })),
}))

// Mock stdio transport
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({})),
}))

// Mock fs for file operations
jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}))

describe('MCPClient', () => {
  let client: MCPClient
  let mockDuckDB: jest.Mocked<DuckDBService>

  beforeEach(() => {
    // Create mock DuckDB service
    mockDuckDB = {
      createTableFromJSON: jest.fn().mockResolvedValue(undefined),
      executeQuery: jest.fn().mockResolvedValue([]),
      readCSV: jest.fn().mockResolvedValue([]),
      readParquet: jest.fn().mockResolvedValue([]),
    } as any

    client = new MCPClient({
      name: 'test-client',
      version: '1.0.0',
      cacheEnabled: true,
      cacheTTL: 300,
    })

    client.setDuckDBService(mockDuckDB)
  })

  afterEach(async () => {
    await client.disconnectAll().catch(() => {})
  })

  describe('Configuration', () => {
    it('should initialize with default config', () => {
      const defaultClient = new MCPClient()
      // @ts-ignore - accessing private property
      expect(defaultClient.config.name).toBe('duckdb-mcp-client')
      // @ts-ignore
      expect(defaultClient.config.cacheEnabled).toBe(true)
      // @ts-ignore
      expect(defaultClient.config.cacheTTL).toBe(300)
    })

    it('should accept custom config', () => {
      // @ts-ignore - accessing private property
      expect(client.config.name).toBe('test-client')
      // @ts-ignore
      expect(client.config.version).toBe('1.0.0')
    })
  })

  describe('Server Management', () => {
    it('should attach a stdio server', async () => {
      await client.attachServer('stdio://test-command', 'test-alias', 'stdio')

      const servers = client.listAttachedServers()
      expect(servers).toHaveLength(1)
      expect(servers[0].alias).toBe('test-alias')
      expect(servers[0].transport).toBe('stdio')
    })

    it('should prevent duplicate aliases', async () => {
      await client.attachServer('stdio://test', 'alias1', 'stdio')

      await expect(client.attachServer('stdio://other', 'alias1', 'stdio')).rejects.toThrow(
        "Server with alias 'alias1' is already attached"
      )
    })

    it('should parse stdio URLs correctly', async () => {
      // Test different stdio URL formats
      await client.attachServer('stdio://python?args=-m,server', 'py', 'stdio')
      await client.attachServer('stdio:///usr/bin/node?args=server.js', 'node', 'stdio')

      const servers = client.listAttachedServers()
      expect(servers).toHaveLength(2)
    })

    it('should detach a server', async () => {
      await client.attachServer('stdio://test', 'test-alias', 'stdio')
      await client.detachServer('test-alias')

      const servers = client.listAttachedServers()
      expect(servers).toHaveLength(0)
    })

    it('should throw when detaching non-existent server', async () => {
      await expect(client.detachServer('non-existent')).rejects.toThrow(
        "No server attached with alias 'non-existent'"
      )
    })

    it('should get attached server by alias', async () => {
      await client.attachServer('stdio://test', 'test-alias', 'stdio')

      const server = client.getAttachedServer('test-alias')
      expect(server).toBeDefined()
      expect(server?.alias).toBe('test-alias')
    })

    it('should return undefined for non-existent server', () => {
      const server = client.getAttachedServer('non-existent')
      expect(server).toBeUndefined()
    })
  })

  describe('Resource Operations', () => {
    beforeEach(async () => {
      await client.attachServer('stdio://test', 'test-alias', 'stdio')
    })

    it('should list resources from a server', async () => {
      const resources = await client.listResources('test-alias')

      expect(resources).toHaveLength(2)
      expect(resources[0].serverAlias).toBe('test-alias')
      expect(resources[0].fullUri).toBe('mcp://test-alias/test://resource1')
    })

    it('should list resources from all servers', async () => {
      await client.attachServer('stdio://test2', 'alias2', 'stdio')

      const resources = await client.listResources()

      expect(resources).toHaveLength(4) // 2 resources from each server
    })

    it('should read a resource with mcp:// URI', async () => {
      const data = await client.readResource('mcp://test-alias/test://resource1')

      expect(data).toEqual([{ id: 1, name: 'test' }])
    })

    it('should read a resource with relative URI', async () => {
      const data = await client.readResource('test://resource1', 'test-alias')

      expect(data).toEqual([{ id: 1, name: 'test' }])
    })

    it('should cache resources', async () => {
      // First read - will call the server
      const data1 = await client.readResource('test://resource1', 'test-alias')

      // Second read - should use cache
      const data2 = await client.readResource('test://resource1', 'test-alias')

      expect(data1).toEqual(data2)
    })

    it('should skip cache when requested', async () => {
      await client.readResource('test://resource1', 'test-alias', true)
      const data = await client.readResource('test://resource1', 'test-alias', false)

      expect(data).toEqual([{ id: 1, name: 'test' }])
    })

    it('should throw for invalid MCP URI format', async () => {
      await expect(client.readResource('mcp://invalid-format')).rejects.toThrow(
        'Invalid MCP URI format'
      )
    })

    it('should throw when server not found for resource', async () => {
      await expect(client.readResource('test://resource', 'non-existent')).rejects.toThrow(
        'Server not found for URI'
      )
    })
  })

  describe('Virtual Tables', () => {
    beforeEach(async () => {
      await client.attachServer('stdio://test', 'test-alias', 'stdio')
    })

    it('should create virtual table from JSON resource', async () => {
      await client.createVirtualTable('test_table', 'test://resource1', 'test-alias')

      expect(mockDuckDB.createTableFromJSON).toHaveBeenCalledWith('test_table', [
        { id: 1, name: 'test' },
      ])
    })

    it('should handle CSV data', async () => {
      // Mock CSV response
      const csvClient = new MCPClient()
      csvClient.setDuckDBService(mockDuckDB)

      // Mock readResource to return CSV string
      jest.spyOn(csvClient, 'readResource').mockResolvedValue('id,name\n1,test')

      await csvClient.attachServer('stdio://csv', 'csv-alias', 'stdio')
      await csvClient.createVirtualTable('csv_table', 'csv://data', 'csv-alias')

      // Should call executeQuery with CREATE TABLE from CSV
      expect(mockDuckDB.executeQuery).toHaveBeenCalled()
    })

    it('should throw when DuckDB service not set', async () => {
      const noDuckDBClient = new MCPClient()
      await noDuckDBClient.attachServer('stdio://test', 'test', 'stdio')

      await expect(noDuckDBClient.createVirtualTable('table', 'resource', 'test')).rejects.toThrow(
        'DuckDB service not set'
      )
    })

    it('should throw for empty resource data', async () => {
      jest.spyOn(client, 'readResource').mockResolvedValue([])

      await expect(
        client.createVirtualTable('empty_table', 'empty://resource', 'test-alias')
      ).rejects.toThrow('contains no data')
    })

    it('should refresh virtual table', async () => {
      await client.createVirtualTable('test_table', 'test://resource1', 'test-alias')

      // Clear cache and refresh
      await client.refreshVirtualTable('test_table', 'test://resource1', 'test-alias')

      // Should have called createTableFromJSON again
      expect(mockDuckDB.createTableFromJSON).toHaveBeenCalledTimes(2)
    })
  })

  describe('Tool Operations', () => {
    beforeEach(async () => {
      await client.attachServer('stdio://test', 'test-alias', 'stdio')
    })

    it('should call a tool on server', async () => {
      const result = await client.callTool('test-alias', 'tool1', { arg: 'value' })

      expect(result).toEqual({ result: 'tool executed' })
    })

    it('should throw when calling tool on non-existent server', async () => {
      await expect(client.callTool('non-existent', 'tool', {})).rejects.toThrow(
        "Server 'non-existent' not found"
      )
    })
  })

  describe('Cache Management', () => {
    beforeEach(async () => {
      await client.attachServer('stdio://test', 'test-alias', 'stdio')
    })

    it('should clear cache for specific server', async () => {
      // Read resource to populate cache
      await client.readResource('test://resource1', 'test-alias')

      // Clear cache for this server
      client.clearCache('test-alias')

      // @ts-ignore - accessing private property
      expect(client.resourceCache.size).toBe(0)
    })

    it('should clear all cache', async () => {
      // Read resources to populate cache
      await client.readResource('test://resource1', 'test-alias')
      await client.attachServer('stdio://test2', 'alias2', 'stdio')
      await client.readResource('test://resource2', 'alias2')

      // Clear all cache
      client.clearCache()

      // @ts-ignore
      expect(client.resourceCache.size).toBe(0)
    })
  })

  describe('Disconnection', () => {
    it('should disconnect all servers', async () => {
      await client.attachServer('stdio://test1', 'alias1', 'stdio')
      await client.attachServer('stdio://test2', 'alias2', 'stdio')

      await client.disconnectAll()

      expect(client.listAttachedServers()).toHaveLength(0)
    })
  })

  describe('Error Handling', () => {
    it('should throw for HTTP transport not implemented', async () => {
      await expect(
        client.attachServer('http://localhost:8080', 'http-alias', 'http')
      ).rejects.toThrow('HTTP transport not yet implemented')
    })

    it('should throw for WebSocket transport not implemented', async () => {
      await expect(
        client.attachServer('ws://localhost:8080', 'ws-alias', 'websocket')
      ).rejects.toThrow('WebSocket transport not yet implemented')
    })

    it('should throw for unsupported transport', async () => {
      await expect(
        client.attachServer('unknown://test', 'alias', 'unknown' as any)
      ).rejects.toThrow('Unsupported transport')
    })
  })
})
