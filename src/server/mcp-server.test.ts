import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DuckDBMCPServer } from './mcp-server.js'
import type { DuckDBService } from '../duckdb/service.js'
import type { MCPClient } from '../client/MCPClient.js'

// Use vi.hoisted for mocks that need to be available before imports
const { mockHandlers } = vi.hoisted(() => {
  const handlers = new Map()
  return { mockHandlers: handlers }
})

// Mock the MCP SDK Server
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn(() => ({
    setRequestHandler: vi.fn((schema, handler) => {
      // Map schema objects to handler keys based on their structure
      let key = 'unknown'

      // Check schema object or name to determine handler type
      if (schema?.parse?.name?.includes('ListTools') || schema === 'tools/list') {
        key = 'tools/list'
      } else if (schema?.parse?.name?.includes('CallTool') || schema === 'tools/call') {
        key = 'tools/call'
      } else if (schema?.parse?.name?.includes('ListResources') || schema === 'resources/list') {
        key = 'resources/list'
      } else if (schema?.parse?.name?.includes('ReadResource') || schema === 'resources/read') {
        key = 'resources/read'
      }

      mockHandlers.set(key, handler)
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    error: vi.fn(),
    // Expose handlers for testing
    _handlers: mockHandlers,
  })),
}))

// Mock stdio transport
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}))

// Mock DuckDBService
vi.mock('../duckdb/service.js', () => ({
  DuckDBService: vi.fn(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn().mockResolvedValue([
      { id: 1, name: 'test1' },
      { id: 2, name: 'test2' },
    ]),
    executeScalar: vi.fn().mockResolvedValue({ count: 10 }),
    getSchema: vi.fn().mockResolvedValue([
      { table_schema: 'main', table_name: 'users', table_type: 'TABLE' },
      { table_schema: 'main', table_name: 'products', table_type: 'TABLE' },
    ]),
    getTableColumns: vi.fn().mockResolvedValue([
      { column_name: 'id', data_type: 'INTEGER', is_nullable: 'NO' },
      { column_name: 'name', data_type: 'VARCHAR', is_nullable: 'YES' },
    ]),
    createTableFromJSON: vi.fn().mockResolvedValue(undefined),
    readParquet: vi.fn().mockResolvedValue([{ data: 'parquet' }]),
    readCSV: vi.fn().mockResolvedValue([{ data: 'csv' }]),
    readJSON: vi.fn().mockResolvedValue([{ data: 'json' }]),
    exportToFile: vi.fn().mockResolvedValue(undefined),
    tableExists: vi.fn().mockResolvedValue(true),
    getRowCount: vi.fn().mockResolvedValue(100),
    close: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
  })),
  getDuckDBService: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn().mockResolvedValue([
      { id: 1, name: 'test1' },
      { id: 2, name: 'test2' },
    ]),
    executeScalar: vi.fn().mockResolvedValue({ count: 10 }),
    getSchema: vi.fn().mockResolvedValue([
      { table_schema: 'main', table_name: 'users', table_type: 'TABLE' },
      { table_schema: 'main', table_name: 'products', table_type: 'TABLE' },
    ]),
    getTableColumns: vi.fn().mockResolvedValue([
      { column_name: 'id', data_type: 'INTEGER', is_nullable: 'NO' },
      { column_name: 'name', data_type: 'VARCHAR', is_nullable: 'YES' },
    ]),
    createTableFromJSON: vi.fn().mockResolvedValue(undefined),
    readParquet: vi.fn().mockResolvedValue([{ data: 'parquet' }]),
    readCSV: vi.fn().mockResolvedValue([{ data: 'csv' }]),
    readJSON: vi.fn().mockResolvedValue([{ data: 'json' }]),
    exportToFile: vi.fn().mockResolvedValue(undefined),
    tableExists: vi.fn().mockResolvedValue(true),
    getRowCount: vi.fn().mockResolvedValue(100),
    close: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
  }),
}))

// Mock MCPClient
vi.mock('../client/MCPClient.js', () => ({
  MCPClient: vi.fn(() => ({
    attachServer: vi.fn().mockResolvedValue(undefined),
    detachServer: vi.fn().mockResolvedValue(undefined),
    listAttachedServers: vi.fn().mockReturnValue([
      {
        alias: 'test-server',
        url: 'stdio://test',
        transport: 'stdio',
        client: {},
        resources: [],
        tools: [],
        lastRefresh: new Date(),
      },
    ]),
    listResources: vi.fn().mockResolvedValue([{ uri: 'test://resource1', name: 'Resource 1' }]),
    readResource: vi.fn().mockResolvedValue({ data: 'test' }),
    createVirtualTable: vi.fn().mockResolvedValue(undefined),
    refreshVirtualTable: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockResolvedValue({ result: 'success' }),
    clearCache: vi.fn(),
    disconnectAll: vi.fn().mockResolvedValue(undefined),
    getAttachedServer: vi.fn().mockReturnValue(undefined),
    setDuckDBService: vi.fn(),
  })),
}))

// Mock DuckDB service
const createMockDuckDBService = () =>
  ({
    initialize: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn().mockResolvedValue([
      { id: 1, name: 'test1' },
      { id: 2, name: 'test2' },
    ]),
    executeScalar: vi.fn().mockResolvedValue({ count: 10 }),
    getSchema: vi.fn().mockResolvedValue([
      { table_schema: 'main', table_name: 'users', table_type: 'TABLE' },
      { table_schema: 'main', table_name: 'products', table_type: 'TABLE' },
    ]),
    getTableColumns: vi.fn().mockResolvedValue([
      { column_name: 'id', data_type: 'INTEGER', is_nullable: 'NO' },
      { column_name: 'name', data_type: 'VARCHAR', is_nullable: 'YES' },
    ]),
    createTableFromJSON: vi.fn().mockResolvedValue(undefined),
    readParquet: vi.fn().mockResolvedValue([{ data: 'parquet' }]),
    readCSV: vi.fn().mockResolvedValue([{ data: 'csv' }]),
    readJSON: vi.fn().mockResolvedValue([{ data: 'json' }]),
    exportToFile: vi.fn().mockResolvedValue(undefined),
    tableExists: vi.fn().mockResolvedValue(true),
    getRowCount: vi.fn().mockResolvedValue(100),
    close: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
  }) as any

// Mock MCPClient
const createMockMCPClient = () =>
  ({
    attachServer: vi.fn().mockResolvedValue(undefined),
    detachServer: vi.fn().mockResolvedValue(undefined),
    listAttachedServers: vi.fn().mockReturnValue([
      {
        alias: 'test-server',
        url: 'stdio://test',
        transport: 'stdio',
        client: {},
        resources: [],
        tools: [],
        lastRefresh: new Date(),
      },
    ]),
    listResources: vi.fn().mockResolvedValue([{ uri: 'test://resource1', name: 'Resource 1' }]),
    readResource: vi.fn().mockResolvedValue({ data: 'test' }),
    createVirtualTable: vi.fn().mockResolvedValue(undefined),
    refreshVirtualTable: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockResolvedValue({ result: 'success' }),
    clearCache: vi.fn(),
    disconnectAll: vi.fn().mockResolvedValue(undefined),
    getAttachedServer: vi.fn().mockReturnValue(undefined),
    setDuckDBService: vi.fn(),
  }) as any

describe('DuckDBMCPServer', () => {
  let server: DuckDBMCPServer
  let mockDuckDB: any
  let mockMCPClient: any
  let consoleErrorSpy: any
  // Use the same mockHandlers from vi.hoisted
  const handlers = mockHandlers

  beforeEach(() => {
    // Clear the handlers before each test
    mockHandlers.clear()

    // Suppress console.error during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Create mocks
    mockDuckDB = createMockDuckDBService()
    mockMCPClient = createMockMCPClient()

    // Create server with mocked dependencies passed via config
    server = new DuckDBMCPServer({
      duckdbService: mockDuckDB as any,
    })

    // Replace mcpClient with mock (still needs to be done after constructor)
    // @ts-ignore
    server.mcpClient = mockMCPClient
  })

  afterEach(async () => {
    // Cleanup
    consoleErrorSpy.mockRestore()
    vi.clearAllMocks()
    // Close DuckDB connection if it exists
    try {
      await mockDuckDB.close()
    } catch {}
  })

  describe('Initialization', () => {
    it('should create server instance', () => {
      expect(server).toBeDefined()
      // @ts-ignore
      expect(server.server).toBeDefined()
    })

    it('should initialize DuckDB service', async () => {
      await server.start()

      // DuckDB should be initialized
      expect(mockDuckDB.initialize).toHaveBeenCalled()
    })

    it('should set up MCP client with DuckDB service', () => {
      // @ts-ignore
      expect(server.mcpClient).toBeDefined()
      expect(mockMCPClient.setDuckDBService).toHaveBeenCalledWith(mockDuckDB)
    })
  })

  describe('Tool Handlers', () => {
    beforeEach(async () => {
      await server.start()
      // Handlers are set up in constructor, no need to call setupRequestHandlers
    })

    describe('query_duckdb', () => {
      it('should execute SQL query', async () => {
        const handler = handlers.get('tools/call')
        const result = await handler?.({
          params: {
            name: 'query_duckdb',
            arguments: {
              sql: 'SELECT * FROM users',
              limit: 10,
            },
          },
        })

        expect(mockDuckDB.executeQuery).toHaveBeenCalled()
        expect(result?.content[0]?.text).toContain('test1')
      })

      it('should apply default limit', async () => {
        const handler = handlers.get('tools/call')
        await handler?.({
          params: {
            name: 'query_duckdb',
            arguments: {
              sql: 'SELECT * FROM users',
            },
          },
        })

        const callArg = mockDuckDB.executeQuery.mock.calls[0][0]
        expect(callArg).toContain('LIMIT')
      })
    })

    describe('list_tables', () => {
      it('should list tables from schema', async () => {
        const handler = handlers.get('tools/call')
        const result = await handler?.({
          params: {
            name: 'list_tables',
            arguments: {
              schema: 'main',
            },
          },
        })

        expect(mockDuckDB.executeQuery).toHaveBeenCalled()
        expect(result?.content[0]?.text).toBeDefined()
      })
    })

    describe('describe_table', () => {
      it('should describe table structure', async () => {
        const handler = handlers.get('tools/call')
        const result = await handler?.({
          params: {
            name: 'describe_table',
            arguments: {
              table_name: 'users',
              schema: 'main',
            },
          },
        })

        expect(mockDuckDB.getTableColumns).toHaveBeenCalledWith('users', 'main')
        expect(mockDuckDB.getRowCount).toHaveBeenCalledWith('users', 'main')
        expect(result?.content[0]?.text).toContain('id')
        expect(result?.content[0]?.text).toContain('100')
      })
    })

    describe('load_csv', () => {
      it('should load CSV file', async () => {
        const handler = handlers.get('tools/call')
        const result = await handler?.({
          params: {
            name: 'load_csv',
            arguments: {
              path: '/path/to/file.csv',
              limit: 100,
            },
          },
        })

        expect(mockDuckDB.readCSV).toHaveBeenCalledWith('/path/to/file.csv', 100)
        expect(result?.content[0]?.text).toContain('csv')
      })
    })

    describe('load_parquet', () => {
      it('should load Parquet file', async () => {
        const handler = handlers.get('tools/call')
        const result = await handler?.({
          params: {
            name: 'load_parquet',
            arguments: {
              path: '/path/to/file.parquet',
              limit: 50,
            },
          },
        })

        expect(mockDuckDB.readParquet).toHaveBeenCalledWith('/path/to/file.parquet', 50)
        expect(result?.content[0]?.text).toContain('parquet')
      })
    })

    describe('attach_mcp', () => {
      it('should attach MCP server', async () => {
        const handler = handlers.get('tools/call')
        const result = await handler?.({
          params: {
            name: 'attach_mcp',
            arguments: {
              url: 'stdio://test-server',
              alias: 'test',
              transport: 'stdio',
            },
          },
        })

        expect(mockMCPClient.attachServer).toHaveBeenCalledWith(
          'stdio://test-server',
          'test',
          'stdio'
        )
        expect(result?.content[0]?.text).toContain('success')
      })
    })

    describe('detach_mcp', () => {
      it('should detach MCP server', async () => {
        const handler = handlers.get('tools/call')
        const result = await handler?.({
          params: {
            name: 'detach_mcp',
            arguments: {
              alias: 'test',
            },
          },
        })

        expect(mockMCPClient.detachServer).toHaveBeenCalledWith('test')
        expect(result?.content[0]?.text).toContain('success')
      })
    })

    describe('list_attached_servers', () => {
      it('should list attached servers', async () => {
        const handler = handlers.get('tools/call')
        const result = await handler?.({
          params: {
            name: 'list_attached_servers',
            arguments: {},
          },
        })

        expect(mockMCPClient.listAttachedServers).toHaveBeenCalled()
        expect(result?.content[0]?.text).toContain('test-server')
      })
    })

    describe('list_mcp_resources', () => {
      it('should list MCP resources', async () => {
        const handler = handlers.get('tools/call')
        const result = await handler?.({
          params: {
            name: 'list_mcp_resources',
            arguments: {
              server_alias: 'test',
            },
          },
        })

        expect(mockMCPClient.listResources).toHaveBeenCalledWith('test')
        expect(result?.content[0]?.text).toContain('Resource 1')
      })
    })

    describe('create_virtual_table', () => {
      it('should create virtual table', async () => {
        const handler = handlers.get('tools/call')
        const result = await handler?.({
          params: {
            name: 'create_virtual_table',
            arguments: {
              table_name: 'virtual_test',
              resource_uri: 'test://resource',
              server_alias: 'test',
            },
          },
        })

        expect(mockMCPClient.createVirtualTable).toHaveBeenCalledWith(
          'virtual_test',
          'test://resource',
          'test'
        )
        expect(result?.content[0]?.text).toContain('success')
      })
    })

    describe('query_hybrid', () => {
      it('should execute hybrid query', async () => {
        const handler = handlers.get('tools/call')
        const result = await handler?.({
          params: {
            name: 'query_hybrid',
            arguments: {
              sql: 'SELECT * FROM virtual_table JOIN local_table',
              limit: 50,
            },
          },
        })

        expect(mockDuckDB.executeQuery).toHaveBeenCalled()
        expect(result?.content[0]?.text).toBeDefined()
      })
    })
  })

  describe('Resource Handlers', () => {
    beforeEach(async () => {
      await server.start()
      // Handlers are set up in constructor, no need to call setupRequestHandlers
    })

    it('should list resources', async () => {
      const handler = handlers.get('resources/list')
      const result = await handler?.({})

      expect(mockDuckDB.getSchema).toHaveBeenCalled()
      expect(result?.resources).toHaveLength(2)
      expect(result?.resources[0].uri).toContain('duckdb://table/')
    })

    it('should read resource', async () => {
      const handler = handlers.get('resources/read')
      const result = await handler?.({
        params: {
          uri: 'duckdb://table/users',
        },
      })

      expect(mockDuckDB.executeQuery).toHaveBeenCalled()
      expect(result?.contents).toBeDefined()
    })
  })

  describe('Error Handling', () => {
    beforeEach(async () => {
      await server.start()
      // Handlers are set up in constructor, no need to call setupRequestHandlers
    })

    it('should handle unknown tool gracefully', async () => {
      const handler = handlers.get('tools/call')
      const result = await handler?.({
        params: {
          name: 'unknown_tool',
          arguments: {},
        },
      })

      expect(result?.content[0]?.text).toContain('Unknown tool')
    })

    it('should handle query errors', async () => {
      mockDuckDB.executeQuery.mockRejectedValue(new Error('SQL error'))

      const handler = handlers.get('tools/call')
      const result = await handler?.({
        params: {
          name: 'query_duckdb',
          arguments: {
            sql: 'INVALID SQL',
          },
        },
      })

      expect(result?.content[0]?.text).toContain('Error')
    })

    it('should handle resource read errors', async () => {
      mockDuckDB.executeQuery.mockRejectedValue(new Error('Table not found'))

      const handler = handlers.get('resources/read')
      const result = await handler?.({
        params: {
          uri: 'duckdb://table/non_existent',
        },
      })

      expect(result?.contents[0]?.text).toContain('Error')
    })
  })

  describe('Lifecycle', () => {
    it('should start server', async () => {
      await server.start()

      expect(mockDuckDB.initialize).toHaveBeenCalled()
      // @ts-ignore
      expect(server.server.connect).toHaveBeenCalled()
    })

    it('should handle initialization timeout', async () => {
      mockDuckDB.initialize.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 6000))
      )

      await expect(server.start()).rejects.toThrow('timeout')
    }, 10000) // Increase timeout for this test
  })
})
