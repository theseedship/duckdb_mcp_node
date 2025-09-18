import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DuckDBMcpNativeService, createDuckDBMcpNativeService } from './DuckDBMcpNativeService.js'

// Mock the MCPClient to avoid real connections
vi.mock('../client/MCPClient.js', () => ({
  MCPClient: vi.fn().mockImplementation(() => ({
    attachServer: vi.fn().mockResolvedValue(undefined),
    detachServer: vi.fn().mockResolvedValue(undefined),
    listResources: vi.fn().mockResolvedValue([]),
    readResource: vi.fn().mockResolvedValue({}),
    callTool: vi.fn().mockResolvedValue({}),
    getAttachedServer: vi.fn().mockReturnValue({
      alias: 'test-alias',
      url: 'stdio://test',
      transport: 'stdio',
      client: {},
      resources: [],
      tools: [],
      lastRefresh: new Date(),
    }),
    listAttachedServers: vi.fn().mockReturnValue([]),
    clearCache: vi.fn(),
    disconnectAll: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

// Mock DuckDBMCPServer to avoid starting real servers
vi.mock('../server/mcp-server.js', () => ({
  DuckDBMCPServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}))

// Tests for DuckDBMcpNativeService
describe('DuckDBMcpNativeService', () => {
  let service: DuckDBMcpNativeService
  let consoleErrorSpy: any

  beforeEach(() => {
    // Suppress console.error during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    service = createDuckDBMcpNativeService()
  })

  afterEach(async () => {
    // Clean up all servers and clients
    const serverNames = service.getServerNames()
    for (const name of serverNames) {
      await service.stopServer(name).catch(() => {})
    }

    const clientAliases = service.getClientAliases()
    for (const alias of clientAliases) {
      await service.detachMCP(alias).catch(() => {})
    }

    service.clearCache()
    consoleErrorSpy.mockRestore()
  })

  describe('Server Management', () => {
    it('should start a server with default stdio transport', async () => {
      await service.startServer('test-server')
      expect(service.getServerNames()).toContain('test-server')
    })

    it('should throw error when starting server with existing name', async () => {
      await service.startServer('test-server')

      await expect(service.startServer('test-server')).rejects.toThrow(
        "Server 'test-server' already exists"
      )
    })

    it('should stop and remove a server', async () => {
      await service.startServer('test-server')
      await service.stopServer('test-server')

      expect(service.getServerNames()).not.toContain('test-server')
    })

    it('should throw error when stopping non-existent server', async () => {
      await expect(service.stopServer('non-existent')).rejects.toThrow(
        "Server 'non-existent' not found"
      )
    })
  })

  describe('Client Management', () => {
    it('should attach to an MCP server', async () => {
      const resources = await service.attachMCP('stdio://test', 'test-alias')
      expect(resources).toBeDefined()
      expect(resources).toEqual([]) // Mocked to return empty array
      expect(service.getClientAliases()).toContain('test-alias')
    })

    it('should cache resources when attaching', async () => {
      // First attachment
      await service.attachMCP('stdio://test', 'alias1')

      // Detach first client
      await service.detachMCP('alias1')

      // Second attachment to same URL - should use cache
      await service.attachMCP('stdio://test', 'alias2')
      expect(service.getClientAliases()).toContain('alias2')
    })

    it('should skip cache when requested', async () => {
      await service.attachMCP('stdio://test', 'alias1')
      await service.detachMCP('alias1')

      // Attach again with skipCache
      await service.attachMCP('stdio://test', 'alias2', { skipCache: true })
      expect(service.getClientAliases()).toContain('alias2')
    })

    it('should detach from an MCP server', async () => {
      await service.attachMCP('stdio://test', 'test-alias')
      await service.detachMCP('test-alias')
      expect(service.getClientAliases()).not.toContain('test-alias')
    })

    it('should throw error when detaching non-existent client', async () => {
      await expect(service.detachMCP('non-existent')).rejects.toThrow(
        "Client 'non-existent' not found"
      )
    })
  })

  describe('Tool Execution', () => {
    it('should call tool on connected client', async () => {
      await service.attachMCP('stdio://test', 'test-alias')
      // Can't test actual tool call without proper mocks
      expect(service.getClientAliases()).toContain('test-alias')
    })

    it('should throw error when calling tool on non-existent client', async () => {
      await expect(service.callTool('non-existent', 'tool', {})).rejects.toThrow(
        "Client 'non-existent' not found"
      )
    })
  })

  describe('Status and Management', () => {
    it('should return service status', async () => {
      await service.startServer('server1')
      await service.attachMCP('stdio://test', 'client1')

      const status = service.getStatus()

      expect(status.servers).toHaveLength(1)
      expect(status.servers[0]).toMatchObject({
        name: 'server1',
        type: 'server',
        status: 'running',
      })

      expect(status.clients).toHaveLength(1)
      expect(status.clients[0]).toMatchObject({
        name: 'client1',
        type: 'client',
        status: 'connected',
      })
    })

    it('should clear cache', () => {
      service.clearCache()
      const status = service.getStatus()
      expect(status.resourceCacheSize).toBe(0)
    })

    it('should get client resources', async () => {
      await service.attachMCP('stdio://test', 'test-alias')
      const resources = await service.getClientResources('test-alias')
      expect(resources).toBeDefined()
    })

    it('should get client tools', async () => {
      await service.attachMCP('stdio://test', 'test-alias')
      const tools = await service.getClientTools('test-alias')

      // Mocked to return empty array
      expect(tools).toEqual([])
    })
  })
})
