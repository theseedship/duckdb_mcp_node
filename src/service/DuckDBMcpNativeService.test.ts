import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { DuckDBMcpNativeService, createDuckDBMcpNativeService } from './DuckDBMcpNativeService.js'

// Mock the dependencies
jest.mock('../client/MCPClient.js', () => ({
  MCPClient: jest.fn(),
}))
jest.mock('../server/mcp-server.js', () => ({
  DuckDBMCPServer: jest.fn(),
}))
jest.mock('../client/ResourceMapper.js', () => ({
  ResourceMapper: jest.fn(),
}))
jest.mock('../duckdb/service.js', () => ({
  DuckDBService: jest.fn(),
  getDuckDBService: jest.fn().mockResolvedValue({
    initialize: jest.fn(),
    executeQuery: jest.fn(),
  }),
}))

// Import after mocking
import { MCPClient } from '../client/MCPClient.js'
import { DuckDBMCPServer } from '../server/mcp-server.js'

const MockedMCPClient = MCPClient as jest.Mock
const MockedDuckDBMCPServer = DuckDBMCPServer as jest.Mock

describe('DuckDBMcpNativeService', () => {
  let service: DuckDBMcpNativeService

  beforeEach(() => {
    service = createDuckDBMcpNativeService()
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Server Management', () => {
    it('should start a server with default stdio transport', async () => {
      const mockStart = jest.fn()
      MockedDuckDBMCPServer.mockImplementation(() => ({
        start: mockStart,
      }))

      await service.startServer('test-server')

      expect(mockStart).toHaveBeenCalledTimes(1)
      expect(service.getServerNames()).toContain('test-server')
    })

    it('should throw error when starting server with existing name', async () => {
      const mockStart = jest.fn()
      MockedDuckDBMCPServer.mockImplementation(() => ({
        start: mockStart,
      }))

      await service.startServer('test-server')

      await expect(service.startServer('test-server')).rejects.toThrow(
        "Server 'test-server' already exists"
      )
    })

    it('should stop and remove a server', async () => {
      const mockStart = jest.fn()
      MockedDuckDBMCPServer.mockImplementation(() => ({
        start: mockStart,
      }))

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
      const mockAttachServer = jest.fn()
      const mockListResources = jest.fn<() => Promise<any[]>>().mockResolvedValue([
        { uri: 'resource1', name: 'Resource 1' },
        { uri: 'resource2', name: 'Resource 2' },
      ])

      MockedMCPClient.mockImplementation(() => ({
        attachServer: mockAttachServer,
        listResources: mockListResources,
        detachServer: jest.fn(),
        readResource: jest.fn(),
        callTool: jest.fn(),
        disconnectAll: jest.fn(),
      }))

      const resources = await service.attachMCP('stdio://test', 'test-alias')

      expect(mockAttachServer).toHaveBeenCalledWith('stdio://test', 'test-alias', 'stdio')
      expect(resources).toHaveLength(2)
      expect(service.getClientAliases()).toContain('test-alias')
    })

    it('should cache resources when attaching', async () => {
      const mockAttachServer = jest.fn()
      const mockListResources = jest
        .fn<() => Promise<any[]>>()
        .mockResolvedValue([{ uri: 'resource1', name: 'Resource 1' }])

      MockedMCPClient.mockImplementation(() => ({
        attachServer: mockAttachServer,
        listResources: mockListResources,
        detachServer: jest.fn(),
        readResource: jest.fn(),
        callTool: jest.fn(),
        disconnectAll: jest.fn(),
      }))

      // First attachment - should call listResources
      await service.attachMCP('stdio://test', 'alias1')
      expect(mockListResources).toHaveBeenCalledTimes(1)

      // Detach first client
      await service.detachMCP('alias1')

      // Second attachment to same URL - should use cache
      await service.attachMCP('stdio://test', 'alias2')
      expect(mockListResources).toHaveBeenCalledTimes(1) // Still only 1 call
    })

    it('should skip cache when requested', async () => {
      const mockAttachServer = jest.fn()
      const mockListResources = jest.fn<() => Promise<any[]>>().mockResolvedValue([])

      MockedMCPClient.mockImplementation(() => ({
        attachServer: mockAttachServer,
        listResources: mockListResources,
        detachServer: jest.fn(),
        readResource: jest.fn(),
        callTool: jest.fn(),
        disconnectAll: jest.fn(),
      }))

      await service.attachMCP('stdio://test', 'alias1')
      expect(mockListResources).toHaveBeenCalledTimes(1)

      await service.detachMCP('alias1')

      // Attach again with skipCache
      await service.attachMCP('stdio://test', 'alias2', { skipCache: true })
      expect(mockListResources).toHaveBeenCalledTimes(2)
    })

    it('should detach from an MCP server', async () => {
      const mockAttachServer = jest.fn()
      const mockDetachServer = jest.fn()
      const mockListResources = jest.fn<() => Promise<any[]>>().mockResolvedValue([])

      MockedMCPClient.mockImplementation(() => ({
        attachServer: mockAttachServer,
        detachServer: mockDetachServer,
        listResources: mockListResources,
        readResource: jest.fn(),
        callTool: jest.fn(),
        disconnectAll: jest.fn(),
      }))

      await service.attachMCP('stdio://test', 'test-alias')
      await service.detachMCP('test-alias')

      expect(mockDetachServer).toHaveBeenCalledTimes(1)
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
      const mockAttachServer = jest.fn()
      const mockListResources = jest.fn<() => Promise<any[]>>().mockResolvedValue([])
      const mockCallTool = jest.fn<() => Promise<any>>().mockResolvedValue({ result: 'success' })

      MockedMCPClient.mockImplementation(() => ({
        attachServer: mockAttachServer,
        listResources: mockListResources,
        callTool: mockCallTool,
        detachServer: jest.fn(),
        readResource: jest.fn(),
        disconnectAll: jest.fn(),
      }))

      await service.attachMCP('stdio://test', 'test-alias')
      const result = await service.callTool('test-alias', 'test-tool', { arg: 'value' })

      expect(mockCallTool).toHaveBeenCalledWith('test-alias', 'test-tool', { arg: 'value' })
      expect(result).toEqual({ result: 'success' })
    })

    it('should throw error when calling tool on non-existent client', async () => {
      await expect(service.callTool('non-existent', 'tool', {})).rejects.toThrow(
        "Client 'non-existent' not found"
      )
    })
  })

  describe('Status and Management', () => {
    it('should return service status', async () => {
      const mockStart = jest.fn()
      const mockAttachServer = jest.fn()
      const mockListResources = jest.fn<() => Promise<any[]>>().mockResolvedValue([])

      MockedDuckDBMCPServer.mockImplementation(() => ({
        start: mockStart,
      }))
      MockedMCPClient.mockImplementation(() => ({
        attachServer: mockAttachServer,
        listResources: mockListResources,
        detachServer: jest.fn(),
        readResource: jest.fn(),
        callTool: jest.fn(),
        disconnectAll: jest.fn(),
      }))

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
      const mockAttachServer = jest.fn()
      const mockListResources = jest
        .fn<() => Promise<any[]>>()
        .mockResolvedValueOnce([{ uri: 'initial' }])
        .mockResolvedValueOnce([{ uri: 'updated' }])

      MockedMCPClient.mockImplementation(() => ({
        attachServer: mockAttachServer,
        listResources: mockListResources,
        detachServer: jest.fn(),
        readResource: jest.fn(),
        callTool: jest.fn(),
        disconnectAll: jest.fn(),
      }))

      await service.attachMCP('stdio://test', 'test-alias')
      const resources = await service.getClientResources('test-alias')

      expect(resources).toEqual([{ uri: 'updated' }])
      expect(mockListResources).toHaveBeenCalledTimes(2)
    })

    it('should get client tools', async () => {
      const mockAttachServer = jest.fn()
      const mockListResources = jest.fn<() => Promise<any[]>>().mockResolvedValue([])
      const mockListTools = jest
        .fn<() => Promise<any[]>>()
        .mockResolvedValue([{ name: 'tool1' }, { name: 'tool2' }])

      MockedMCPClient.mockImplementation(() => ({
        attachServer: mockAttachServer,
        listResources: mockListResources,
        listTools: mockListTools,
        detachServer: jest.fn(),
        readResource: jest.fn(),
        callTool: jest.fn(),
        disconnectAll: jest.fn(),
      }))

      await service.attachMCP('stdio://test', 'test-alias')
      const tools = await service.getClientTools('test-alias')

      // MCPClient doesn't have listTools yet, so we expect empty array
      expect(tools).toEqual([])
      // mockListTools won't be called since we return empty array in service
      expect(mockListTools).toHaveBeenCalledTimes(0)
    })
  })
})
