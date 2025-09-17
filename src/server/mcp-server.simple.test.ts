import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { DuckDBMCPServer } from './mcp-server.js'

// Mock the MCP SDK Server
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    error: jest.fn(),
  })),
}))

// Mock stdio transport
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({})),
}))

// Mock DuckDBService
jest.mock('../duckdb/service.js', () => ({
  DuckDBService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    executeQuery: jest.fn().mockResolvedValue([{ id: 1, name: 'test' }]),
    getSchema: jest
      .fn()
      .mockResolvedValue([{ table_schema: 'main', table_name: 'users', table_type: 'TABLE' }]),
    getTableColumns: jest.fn().mockResolvedValue([{ column_name: 'id', data_type: 'INTEGER' }]),
    getRowCount: jest.fn().mockResolvedValue(10),
    readCSV: jest.fn().mockResolvedValue([{ data: 'csv' }]),
    readParquet: jest.fn().mockResolvedValue([{ data: 'parquet' }]),
    close: jest.fn().mockResolvedValue(undefined),
    isReady: jest.fn().mockReturnValue(true),
  })),
}))

// Mock MCPClient
jest.mock('../client/MCPClient.js', () => ({
  MCPClient: jest.fn().mockImplementation(() => ({
    setDuckDBService: jest.fn(),
    attachServer: jest.fn().mockResolvedValue(undefined),
    detachServer: jest.fn().mockResolvedValue(undefined),
    listAttachedServers: jest.fn().mockReturnValue([]),
    listResources: jest.fn().mockResolvedValue([]),
    createVirtualTable: jest.fn().mockResolvedValue(undefined),
    refreshVirtualTable: jest.fn().mockResolvedValue(undefined),
    disconnectAll: jest.fn().mockResolvedValue(undefined),
  })),
}))

describe('DuckDBMCPServer Simple Tests', () => {
  let server: DuckDBMCPServer
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    server = new DuckDBMCPServer()
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('Server Creation', () => {
    it('should create server instance', () => {
      expect(server).toBeDefined()
    })

    it('should have internal server property', () => {
      // @ts-ignore
      expect(server.server).toBeDefined()
    })

    it('should have DuckDB service', () => {
      // @ts-ignore
      expect(server.duckdb).toBeDefined()
    })

    it('should have MCP client', () => {
      // @ts-ignore
      expect(server.mcpClient).toBeDefined()
    })

    it('should set DuckDB service on MCP client', () => {
      // @ts-ignore
      expect(server.mcpClient.setDuckDBService).toHaveBeenCalledWith(server.duckdb)
    })
  })

  describe('Handler Registration', () => {
    it('should register tools/list handler', () => {
      // @ts-ignore
      const mockServer = server.server
      const calls = mockServer.setRequestHandler.mock.calls

      const hasToolsList = calls.some(([method]: [string]) => method === 'tools/list')
      expect(hasToolsList).toBe(true)
    })

    it('should register tools/call handler', () => {
      // @ts-ignore
      const mockServer = server.server
      const calls = mockServer.setRequestHandler.mock.calls

      const hasToolsCall = calls.some(([method]: [string]) => method === 'tools/call')
      expect(hasToolsCall).toBe(true)
    })

    it('should register resources/list handler', () => {
      // @ts-ignore
      const mockServer = server.server
      const calls = mockServer.setRequestHandler.mock.calls

      const hasResourcesList = calls.some(([method]: [string]) => method === 'resources/list')
      expect(hasResourcesList).toBe(true)
    })

    it('should register resources/read handler', () => {
      // @ts-ignore
      const mockServer = server.server
      const calls = mockServer.setRequestHandler.mock.calls

      const hasResourcesRead = calls.some(([method]: [string]) => method === 'resources/read')
      expect(hasResourcesRead).toBe(true)
    })
  })

  describe('Tool Definitions', () => {
    it('should list available tools', async () => {
      // @ts-ignore
      const mockServer = server.server
      const calls = mockServer.setRequestHandler.mock.calls

      // Find the tools/list handler
      const toolsListCall = calls.find(([method]: [string]) => method === 'tools/list')
      expect(toolsListCall).toBeDefined()

      if (toolsListCall) {
        const handler = toolsListCall[1]
        const result = await handler()

        expect(result.tools).toBeDefined()
        expect(result.tools.length).toBeGreaterThan(0)

        // Check for some expected tools
        const toolNames = result.tools.map((t: any) => t.name)
        expect(toolNames).toContain('query_duckdb')
        expect(toolNames).toContain('list_tables')
        expect(toolNames).toContain('describe_table')
        expect(toolNames).toContain('attach_mcp')
        expect(toolNames).toContain('create_virtual_table')
      }
    })
  })

  describe('Server Lifecycle', () => {
    it('should start server', async () => {
      await server.start()

      // @ts-ignore
      expect(server.duckdb.initialize).toHaveBeenCalled()
      // @ts-ignore
      expect(server.server.connect).toHaveBeenCalled()
    })

    it('should handle initialization with timeout', async () => {
      // Create a new server with slow initialization
      const slowServer = new DuckDBMCPServer()

      // @ts-ignore
      slowServer.duckdb.initialize.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      )

      // Should complete within timeout
      await expect(slowServer.start()).resolves.toBeUndefined()
    })
  })

  describe('Tool Execution', () => {
    it('should handle query_duckdb tool', async () => {
      // @ts-ignore
      const mockServer = server.server
      const calls = mockServer.setRequestHandler.mock.calls

      // Find the tools/call handler
      const toolsCallHandler = calls.find(([method]: [string]) => method === 'tools/call')?.[1]

      if (toolsCallHandler) {
        const result = await toolsCallHandler({
          params: {
            name: 'query_duckdb',
            arguments: {
              sql: 'SELECT * FROM users',
              limit: 10,
            },
          },
        })

        expect(result).toBeDefined()
        expect(result.content).toBeDefined()
        expect(result.content[0].type).toBe('text')

        // @ts-ignore
        expect(server.duckdb.executeQuery).toHaveBeenCalled()
      }
    })

    it('should handle list_tables tool', async () => {
      // @ts-ignore
      const mockServer = server.server
      const calls = mockServer.setRequestHandler.mock.calls

      const toolsCallHandler = calls.find(([method]: [string]) => method === 'tools/call')?.[1]

      if (toolsCallHandler) {
        const result = await toolsCallHandler({
          params: {
            name: 'list_tables',
            arguments: {
              schema: 'main',
            },
          },
        })

        expect(result).toBeDefined()
        expect(result.content).toBeDefined()
        // @ts-ignore
        expect(server.duckdb.executeQuery).toHaveBeenCalled()
      }
    })

    it('should handle unknown tool gracefully', async () => {
      // @ts-ignore
      const mockServer = server.server
      const calls = mockServer.setRequestHandler.mock.calls

      const toolsCallHandler = calls.find(([method]: [string]) => method === 'tools/call')?.[1]

      if (toolsCallHandler) {
        const result = await toolsCallHandler({
          params: {
            name: 'unknown_tool',
            arguments: {},
          },
        })

        expect(result).toBeDefined()
        expect(result.content[0].text).toContain('Unknown tool')
      }
    })
  })

  describe('Resource Operations', () => {
    it('should list resources', async () => {
      // @ts-ignore
      const mockServer = server.server
      const calls = mockServer.setRequestHandler.mock.calls

      const resourcesListHandler = calls.find(
        ([method]: [string]) => method === 'resources/list'
      )?.[1]

      if (resourcesListHandler) {
        const result = await resourcesListHandler()

        expect(result).toBeDefined()
        expect(result.resources).toBeDefined()
        expect(Array.isArray(result.resources)).toBe(true)

        // @ts-ignore
        expect(server.duckdb.getSchema).toHaveBeenCalled()
      }
    })

    it('should read resource', async () => {
      // @ts-ignore
      const mockServer = server.server
      const calls = mockServer.setRequestHandler.mock.calls

      const resourcesReadHandler = calls.find(
        ([method]: [string]) => method === 'resources/read'
      )?.[1]

      if (resourcesReadHandler) {
        const result = await resourcesReadHandler({
          params: {
            uri: 'duckdb://table/users',
          },
        })

        expect(result).toBeDefined()
        expect(result.contents).toBeDefined()

        // @ts-ignore
        expect(server.duckdb.executeQuery).toHaveBeenCalled()
      }
    })
  })
})
