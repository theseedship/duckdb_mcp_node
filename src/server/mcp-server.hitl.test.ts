import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DuckDBMCPServer } from './mcp-server.js'

// Shared mock state (vi.hoisted for ESM compat)
const mockState = vi.hoisted(() => ({
  connectCalled: false,
  transportSet: false,
  elicitInputResult: null as any,
  clientCapabilities: null as any,
}))

// Mock the MCP SDK Server
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class MockServer {
    _handlers = new Map()
    _transport: any = undefined

    get transport() {
      return mockState.transportSet ? { close: vi.fn() } : undefined
    }

    setRequestHandler = vi.fn((schema: any, handler: any) => {
      if (typeof schema === 'string') {
        this._handlers.set(schema, handler)
      } else {
        this._handlers.set('handler_' + this._handlers.size, handler)
      }
    })

    connect = vi.fn().mockImplementation(async () => {
      mockState.connectCalled = true
      mockState.transportSet = true
    })

    close = vi.fn().mockResolvedValue(undefined)
    error = vi.fn()

    getClientCapabilities = vi.fn(() => mockState.clientCapabilities)

    elicitInput = vi.fn(async () => {
      if (mockState.elicitInputResult instanceof Error) {
        throw mockState.elicitInputResult
      }
      return mockState.elicitInputResult
    })

    constructor(..._args: any[]) {}
  },
}))

// Mock stdio transport
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}))

// Mock DuckDBService
vi.mock('../duckdb/service.js', () => ({
  DuckDBService: class {
    initialize = vi.fn().mockResolvedValue(undefined)
    executeQuery = vi.fn().mockResolvedValue([])
    executeQueryWithVFS = vi.fn().mockResolvedValue([])
    getSchema = vi
      .fn()
      .mockResolvedValue([{ table_schema: 'main', table_name: 'test', table_type: 'TABLE' }])
    getTableColumns = vi.fn().mockResolvedValue([{ column_name: 'id', data_type: 'INTEGER' }])
    getRowCount = vi.fn().mockResolvedValue(10)
    readCSV = vi.fn().mockResolvedValue([])
    readParquet = vi.fn().mockResolvedValue([])
    close = vi.fn().mockResolvedValue(undefined)
    isReady = vi.fn().mockReturnValue(true)
  },
  getDuckDBService: vi.fn(),
}))

// Mock MCPClient
vi.mock('../client/MCPClient.js', () => ({
  MCPClient: class {
    setDuckDBService = vi.fn()
    attachServer = vi.fn().mockResolvedValue(undefined)
    detachServer = vi.fn().mockResolvedValue(undefined)
    listAttachedServers = vi.fn().mockReturnValue([])
    listResources = vi.fn().mockResolvedValue([])
    createVirtualTable = vi.fn().mockResolvedValue(undefined)
    refreshVirtualTable = vi.fn().mockResolvedValue(undefined)
    disconnectAll = vi.fn().mockResolvedValue(undefined)
    getAttachedServer = vi.fn().mockReturnValue(undefined)
    readResource = vi.fn().mockResolvedValue({ data: 'test' })
    callTool = vi.fn().mockResolvedValue({ result: 'success' })
    clearCache = vi.fn()
  },
}))

describe('S3: MCP SDK 1.26.0 Alignment + HITL', () => {
  let server: DuckDBMCPServer
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Reset shared mock state
    mockState.connectCalled = false
    mockState.transportSet = false
    mockState.elicitInputResult = null
    mockState.clientCapabilities = null

    server = new DuckDBMCPServer({
      duckdbService: {
        initialize: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        isReady: vi.fn().mockReturnValue(true),
        executeQuery: vi.fn().mockResolvedValue([]),
        executeQueryWithVFS: vi.fn().mockResolvedValue([]),
      } as any,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
  })

  // ── connect() guard ──────────────────────────────────────

  describe('connect() guard (SDK 1.26.0)', () => {
    it('should call connect() on first start', async () => {
      await server.start()
      expect(mockState.connectCalled).toBe(true)
    })

    it('should skip connect() if transport already set', async () => {
      // Simulate transport already connected
      mockState.transportSet = true
      await server.start()
      // connect() should NOT have been called
      expect(mockState.connectCalled).toBe(false)
    })

    it('should not create transport in embedded mode', async () => {
      const embeddedServer = new DuckDBMCPServer({
        embeddedMode: true,
        duckdbService: {
          initialize: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          isReady: vi.fn().mockReturnValue(true),
          executeQuery: vi.fn().mockResolvedValue([]),
        } as any,
      })
      await embeddedServer.start()
      expect(mockState.connectCalled).toBe(false)
    })
  })

  // ── classifyDestructiveQuery() ───────────────────────────

  describe('classifyDestructiveQuery()', () => {
    const classify = (sql: string): string | null => {
      // @ts-ignore — accessing private method for testing
      return server.classifyDestructiveQuery(sql)
    }

    it('should detect DROP TABLE', () => {
      expect(classify('DROP TABLE users')).toBe('DROP TABLE')
    })

    it('should detect TRUNCATE', () => {
      expect(classify('TRUNCATE TABLE users')).toBe('TRUNCATE')
    })

    it('should detect DELETE FROM', () => {
      expect(classify('DELETE FROM users WHERE id = 1')).toBe('DELETE')
    })

    it('should detect INSERT INTO', () => {
      expect(classify('INSERT INTO users VALUES (1, "test")')).toBe('INSERT')
    })

    it('should detect UPDATE SET', () => {
      expect(classify('UPDATE users SET name = "test" WHERE id = 1')).toBe('UPDATE')
    })

    it('should detect ALTER TABLE', () => {
      expect(classify('ALTER TABLE users ADD COLUMN email TEXT')).toBe('ALTER TABLE')
    })

    it('should detect GRANT', () => {
      expect(classify('GRANT SELECT ON users TO public')).toBe('GRANT')
    })

    it('should detect REVOKE', () => {
      expect(classify('REVOKE SELECT ON users FROM public')).toBe('REVOKE')
    })

    it('should return null for SELECT', () => {
      expect(classify('SELECT * FROM users')).toBeNull()
    })

    it('should return null for CREATE TABLE', () => {
      expect(classify('CREATE TABLE test (id INT)')).toBeNull()
    })

    it('should return null for COPY TO', () => {
      expect(classify("COPY users TO '/tmp/users.csv'")).toBeNull()
    })

    it('should be case-insensitive', () => {
      expect(classify('drop table USERS')).toBe('DROP TABLE')
      expect(classify('Delete From users')).toBe('DELETE')
    })
  })

  // ── requestDestructiveQueryConfirmation() ────────────────

  describe('HITL elicitation', () => {
    const requestConfirmation = async (sql: string, operationType: string): Promise<boolean> => {
      // @ts-ignore — accessing private method for testing
      return server.requestDestructiveQueryConfirmation(sql, operationType)
    }

    it('should return true when client accepts confirmation', async () => {
      mockState.clientCapabilities = { elicitation: { form: {} } }
      mockState.elicitInputResult = { action: 'accept', content: { confirm: true } }

      const result = await requestConfirmation('DROP TABLE users', 'DROP TABLE')
      expect(result).toBe(true)
    })

    it('should return false when client declines confirmation', async () => {
      mockState.clientCapabilities = { elicitation: { form: {} } }
      mockState.elicitInputResult = { action: 'decline', content: null }

      const result = await requestConfirmation('DROP TABLE users', 'DROP TABLE')
      expect(result).toBe(false)
    })

    it('should return false when client cancels', async () => {
      mockState.clientCapabilities = { elicitation: { form: {} } }
      mockState.elicitInputResult = { action: 'cancel', content: null }

      const result = await requestConfirmation('DROP TABLE users', 'DROP TABLE')
      expect(result).toBe(false)
    })

    it('should return false when client accepts but confirm is false', async () => {
      mockState.clientCapabilities = { elicitation: { form: {} } }
      mockState.elicitInputResult = { action: 'accept', content: { confirm: false } }

      const result = await requestConfirmation('DROP TABLE users', 'DROP TABLE')
      expect(result).toBe(false)
    })

    it('should return false when client has no elicitation capability', async () => {
      mockState.clientCapabilities = {}

      const result = await requestConfirmation('DROP TABLE users', 'DROP TABLE')
      expect(result).toBe(false)

      // elicitInput should NOT have been called
      // @ts-ignore
      expect(server.server.elicitInput).not.toHaveBeenCalled()
    })

    it('should return false when client capabilities are undefined', async () => {
      mockState.clientCapabilities = undefined

      const result = await requestConfirmation('DROP TABLE users', 'DROP TABLE')
      expect(result).toBe(false)
    })

    it('should return false when elicitInput throws', async () => {
      mockState.clientCapabilities = { elicitation: { form: {} } }
      mockState.elicitInputResult = new Error('Connection lost')

      const result = await requestConfirmation('DROP TABLE users', 'DROP TABLE')
      expect(result).toBe(false)
    })

    it('should truncate long SQL in preview', async () => {
      mockState.clientCapabilities = { elicitation: { form: {} } }
      mockState.elicitInputResult = { action: 'accept', content: { confirm: true } }

      const longSql = 'DROP TABLE ' + 'x'.repeat(300)
      await requestConfirmation(longSql, 'DROP TABLE')

      // @ts-ignore
      const call = server.server.elicitInput.mock.calls[0]
      const description = call[0].requestedSchema.properties.confirm.description
      expect(description.length).toBeLessThanOrEqual(204) // 200 + '...'
      expect(description.endsWith('...')).toBe(true)
    })
  })

  // ── Integration: security flow ───────────────────────────

  describe('Security flow integration', () => {
    it('should block destructive SQL in production when not confirmed', async () => {
      process.env.MCP_SECURITY_MODE = 'production'
      mockState.clientCapabilities = { elicitation: { form: {} } }
      mockState.elicitInputResult = { action: 'decline', content: null }

      // Get the CallToolRequestSchema handler
      // @ts-ignore
      const mockServer = server.server
      // @ts-ignore
      const handlers = Array.from(mockServer._handlers.entries())
      // The CallToolRequestSchema handler is the second one registered (index 1)
      const callToolHandler = handlers[1]?.[1]

      if (callToolHandler) {
        const result = await callToolHandler({
          params: {
            name: 'query_duckdb',
            arguments: { sql: 'DROP TABLE users' },
          },
        })

        // Should return error content (wrapped by the try/catch in the handler)
        expect(result.content[0].text).toContain('Destructive operation')
        expect(result.content[0].text).toContain('DROP TABLE')
      }
    })

    it('should allow destructive SQL in production when confirmed', async () => {
      process.env.MCP_SECURITY_MODE = 'production'
      mockState.clientCapabilities = { elicitation: { form: {} } }
      mockState.elicitInputResult = { action: 'accept', content: { confirm: true } }

      // @ts-ignore
      const handlers = Array.from(server.server._handlers.entries())
      const callToolHandler = handlers[1]?.[1]

      if (callToolHandler) {
        const result = await callToolHandler({
          params: {
            name: 'query_duckdb',
            arguments: { sql: 'DROP TABLE users' },
          },
        })

        // Should succeed (mock DuckDB returns [])
        expect(result.content[0].text).not.toContain('blocked')
      }
    })

    it('should not trigger elicitation in development mode', async () => {
      process.env.MCP_SECURITY_MODE = 'development'
      mockState.clientCapabilities = { elicitation: { form: {} } }

      // @ts-ignore
      const handlers = Array.from(server.server._handlers.entries())
      const callToolHandler = handlers[1]?.[1]

      if (callToolHandler) {
        await callToolHandler({
          params: {
            name: 'query_duckdb',
            arguments: { sql: 'DROP TABLE users' },
          },
        })

        // elicitInput should NOT have been called
        // @ts-ignore
        expect(server.server.elicitInput).not.toHaveBeenCalled()
      }
    })

    it('should allow safe queries in production without elicitation', async () => {
      process.env.MCP_SECURITY_MODE = 'production'

      // @ts-ignore
      const handlers = Array.from(server.server._handlers.entries())
      const callToolHandler = handlers[1]?.[1]

      if (callToolHandler) {
        const result = await callToolHandler({
          params: {
            name: 'query_duckdb',
            arguments: { sql: 'SELECT * FROM users' },
          },
        })

        // Should succeed without elicitation
        // @ts-ignore
        expect(server.server.elicitInput).not.toHaveBeenCalled()
        expect(result.content[0].text).not.toContain('blocked')
      }
    })

    it('should enforce query size limit in production', async () => {
      process.env.MCP_SECURITY_MODE = 'production'
      process.env.MCP_MAX_QUERY_SIZE = '100'

      // @ts-ignore
      const handlers = Array.from(server.server._handlers.entries())
      const callToolHandler = handlers[1]?.[1]

      if (callToolHandler) {
        const result = await callToolHandler({
          params: {
            name: 'query_duckdb',
            arguments: { sql: 'SELECT ' + 'x'.repeat(200) },
          },
        })

        expect(result.content[0].text).toContain('exceeds maximum size')
      }
    })
  })
})
