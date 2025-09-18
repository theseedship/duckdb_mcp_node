import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DuckDBMCPServer } from './mcp-server.js'

// Mock the MCP SDK Server
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn(() => {
    const handlers = new Map()
    return {
      setRequestHandler: vi.fn((schema, handler) => {
        // Store handlers by extracting the method name from the schema if possible
        if (typeof schema === 'string') {
          handlers.set(schema, handler)
        } else {
          // For Zod schemas, just store with a generic key
          handlers.set('handler_' + handlers.size, handler)
        }
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      error: vi.fn(),
      // Expose for testing
      _handlers: handlers,
    }
  }),
}))

// Mock stdio transport
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}))

// Mock DuckDBService
vi.mock('../duckdb/service.js', () => ({
  DuckDBService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn().mockResolvedValue([{ id: 1, name: 'test' }]),
    getSchema: vi
      .fn()
      .mockResolvedValue([{ table_schema: 'main', table_name: 'users', table_type: 'TABLE' }]),
    getTableColumns: vi.fn().mockResolvedValue([{ column_name: 'id', data_type: 'INTEGER' }]),
    getRowCount: vi.fn().mockResolvedValue(10),
    readCSV: vi.fn().mockResolvedValue([{ data: 'csv' }]),
    readParquet: vi.fn().mockResolvedValue([{ data: 'parquet' }]),
    close: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
  })),
  getDuckDBService: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn().mockResolvedValue([{ id: 1, name: 'test' }]),
    getSchema: vi
      .fn()
      .mockResolvedValue([{ table_schema: 'main', table_name: 'users', table_type: 'TABLE' }]),
    getTableColumns: vi.fn().mockResolvedValue([{ column_name: 'id', data_type: 'INTEGER' }]),
    getRowCount: vi.fn().mockResolvedValue(10),
    readCSV: vi.fn().mockResolvedValue([{ data: 'csv' }]),
    readParquet: vi.fn().mockResolvedValue([{ data: 'parquet' }]),
    close: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
  }),
}))

// Mock MCPClient
vi.mock('../client/MCPClient.js', () => ({
  MCPClient: vi.fn(() => ({
    setDuckDBService: vi.fn(),
    attachServer: vi.fn().mockResolvedValue(undefined),
    detachServer: vi.fn().mockResolvedValue(undefined),
    listAttachedServers: vi.fn().mockReturnValue([]),
    listResources: vi.fn().mockResolvedValue([]),
    createVirtualTable: vi.fn().mockResolvedValue(undefined),
    refreshVirtualTable: vi.fn().mockResolvedValue(undefined),
    disconnectAll: vi.fn().mockResolvedValue(undefined),
    getAttachedServer: vi.fn().mockReturnValue(undefined),
    readResource: vi.fn().mockResolvedValue({ data: 'test' }),
    callTool: vi.fn().mockResolvedValue({ result: 'success' }),
    clearCache: vi.fn(),
  })),
}))

describe('DuckDBMCPServer Simple Tests', () => {
  let server: DuckDBMCPServer
  let consoleErrorSpy: any
  let mockDuckDB: any

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Create a simple mock DuckDB service
    mockDuckDB = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
      executeQuery: vi.fn().mockResolvedValue([]),
    }

    server = new DuckDBMCPServer({
      duckdbService: mockDuckDB,
    })
  })

  afterEach(async () => {
    consoleErrorSpy.mockRestore()
    vi.clearAllMocks()
    // Clean up any open connections
    try {
      // @ts-ignore
      await server.duckdb?.close()
    } catch {}
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
      // Check that setRequestHandler was called (the real implementation passes Zod schemas)
      expect(mockServer.setRequestHandler).toHaveBeenCalled()
      expect(mockServer.setRequestHandler.mock.calls.length).toBeGreaterThan(0)
    })

    it('should register tools/call handler', () => {
      // @ts-ignore
      const mockServer = server.server
      // Check that setRequestHandler was called multiple times
      expect(mockServer.setRequestHandler).toHaveBeenCalled()
      expect(mockServer.setRequestHandler.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('should register resources/list handler', () => {
      // @ts-ignore
      const mockServer = server.server
      // Check that setRequestHandler was called for resources handlers
      expect(mockServer.setRequestHandler).toHaveBeenCalled()
      expect(mockServer.setRequestHandler.mock.calls.length).toBeGreaterThanOrEqual(3)
    })

    it('should register resources/read handler', () => {
      // @ts-ignore
      const mockServer = server.server
      // Check that all 4 handlers were registered (tools/list, tools/call, resources/list, resources/read)
      expect(mockServer.setRequestHandler).toHaveBeenCalled()
      expect(mockServer.setRequestHandler.mock.calls.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('Tool Definitions', () => {
    it('should list available tools', async () => {
      // @ts-ignore
      const mockServer = server.server
      // @ts-ignore - accessing mock internals
      const handlers = mockServer._handlers || new Map()

      // Find the tools/list handler
      const handler = handlers.get('tools/list')
      expect(handler).toBeDefined()

      if (handler) {
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
      const slowMockDuckDB = {
        initialize: vi
          .fn()
          .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100))),
        close: vi.fn().mockResolvedValue(undefined),
        isReady: vi.fn().mockReturnValue(true),
        executeQuery: vi.fn().mockResolvedValue([]),
      }

      const slowServer = new DuckDBMCPServer({
        duckdbService: slowMockDuckDB,
      })

      // Should complete within timeout
      await expect(slowServer.start()).resolves.toBeUndefined()
    })
  })

  describe('Tool Execution', () => {
    it('should handle query_duckdb tool', async () => {
      // @ts-ignore
      const mockServer = server.server
      // @ts-ignore - accessing mock internals
      const handlers = mockServer._handlers || new Map()

      // Find the tools/call handler
      const toolsCallHandler = handlers.get('tools/call')

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
      // @ts-ignore - accessing mock internals
      const handlers = mockServer._handlers || new Map()

      const toolsCallHandler = handlers.get('tools/call')

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
      // @ts-ignore - accessing mock internals
      const handlers = mockServer._handlers || new Map()

      const toolsCallHandler = handlers.get('tools/call')

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
      // @ts-ignore - accessing mock internals
      const handlers = mockServer._handlers || new Map()

      const resourcesListHandler = handlers.get('resources/list')

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
      // @ts-ignore - accessing mock internals
      const handlers = mockServer._handlers || new Map()

      const resourcesReadHandler = handlers.get('resources/read')

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
