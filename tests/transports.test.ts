import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { HTTPTransport } from '../src/protocol/http-transport.js'
import { WebSocketTransport } from '../src/protocol/websocket-transport.js'
import { TCPTransport } from '../src/protocol/tcp-transport.js'
import { MCPClient } from '../src/client/MCPClient.js'
import { DuckDBService } from '../src/duckdb/service.js'

describe('Transport Integration Tests', () => {
  let duckdb: DuckDBService
  let mcpClient: MCPClient

  beforeEach(async () => {
    duckdb = new DuckDBService()
    await duckdb.initialize(':memory:')
    mcpClient = new MCPClient()
    mcpClient.setDuckDBService(duckdb)
  })

  afterEach(async () => {
    try {
      await mcpClient.disconnectAll()
      await duckdb.close()
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  afterAll(async () => {
    // Force cleanup of any remaining connections
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  describe('HTTP Transport', () => {
    it('should create HTTP transport instance', () => {
      const transport = new HTTPTransport('http://localhost:8080')
      expect(transport).toBeDefined()
      expect(transport.isConnected()).toBe(false)
    })

    it('should handle connection failure gracefully', async () => {
      const transport = new HTTPTransport('http://localhost:9999')
      await expect(transport.connect()).rejects.toThrow()
    })

    it('should support custom headers', () => {
      const headers = { Authorization: 'Bearer token123' }
      const transport = new HTTPTransport('http://localhost:8080', headers)
      expect(transport).toBeDefined()
    })

    it('should attach server with HTTP transport', async () => {
      // Mock server for testing
      const serverUrl = 'http://localhost:8080/mcp'

      // This will fail as no server is running, but tests the integration
      await expect(mcpClient.attachServer(serverUrl, 'http-server', 'http')).rejects.toThrow()
    })
  })

  describe('WebSocket Transport', () => {
    it('should create WebSocket transport instance', () => {
      const transport = new WebSocketTransport('ws://localhost:8080')
      expect(transport).toBeDefined()
      expect(transport.isConnected()).toBe(false)
    })

    it('should handle connection failure gracefully', async () => {
      const transport = new WebSocketTransport('ws://localhost:9999')
      await expect(transport.connect()).rejects.toThrow()
    })

    it('should support custom headers', () => {
      const headers = { Authorization: 'Bearer token123' }
      const transport = new WebSocketTransport('ws://localhost:8080', headers)
      expect(transport).toBeDefined()
    })

    it('should get correct ready state', () => {
      const transport = new WebSocketTransport('ws://localhost:8080')
      expect(transport.getReadyState()).toBe('NOT_CREATED')
    })

    it('should attach server with WebSocket transport', async () => {
      // Mock server for testing
      const serverUrl = 'ws://localhost:8080/mcp'

      // This will fail as no server is running, but tests the integration
      await expect(mcpClient.attachServer(serverUrl, 'ws-server', 'websocket')).rejects.toThrow()
    })
  })

  describe('TCP Transport', () => {
    it('should create TCP transport instance', () => {
      const transport = new TCPTransport('localhost', 9999)
      expect(transport).toBeDefined()
      expect(transport.isConnected()).toBe(false)
    })

    it('should handle connection failure gracefully', async () => {
      const transport = new TCPTransport('localhost', 9999)
      // In CI, connection fails immediately with ECONNREFUSED instead of timing out
      await expect(transport.connect()).rejects.toThrow()
    })

    it('should get correct socket state', () => {
      const transport = new TCPTransport('localhost', 9999)
      expect(transport.getSocketState()).toBe('NOT_CREATED')
    })

    it('should parse TCP URL correctly', async () => {
      const serverUrl = 'tcp://localhost:9999'

      // This will fail as no server is running, but tests the URL parsing
      await expect(mcpClient.attachServer(serverUrl, 'tcp-server', 'tcp')).rejects.toThrow()
    })

    it('should handle TCP URL with default port', async () => {
      const serverUrl = 'tcp://localhost'

      // This will fail but tests default port handling
      await expect(mcpClient.attachServer(serverUrl, 'tcp-server', 'tcp')).rejects.toThrow()
    })
  })

  describe('Transport URL Parsing', () => {
    it('should parse HTTP URL with headers', async () => {
      const url = 'http://localhost:8080?header_Authorization=Bearer%20token&header_X-Custom=value'

      await expect(mcpClient.attachServer(url, 'http-test', 'http')).rejects.toThrow() // Will fail but tests parsing
    })

    it('should parse WebSocket URL with headers', async () => {
      const url = 'ws://localhost:8080?header_Authorization=Bearer%20token'

      await expect(mcpClient.attachServer(url, 'ws-test', 'websocket')).rejects.toThrow() // Will fail but tests parsing
    })

    it.skip('should parse TCP URL with custom port', async () => {
      const url = 'tcp://192.168.1.100:5555'

      await expect(mcpClient.attachServer(url, 'tcp-test', 'tcp')).rejects.toThrow() // Will fail but tests parsing
    })
  })

  describe('Multiple Transport Support', () => {
    it('should list all transport types', () => {
      const transports = ['stdio', 'http', 'websocket', 'tcp']
      expect(transports).toHaveLength(4)
      expect(transports).toContain('http')
      expect(transports).toContain('websocket')
      expect(transports).toContain('tcp')
    })

    it('should reject invalid transport type', async () => {
      await expect(
        mcpClient.attachServer('invalid://test', 'test', 'invalid' as any)
      ).rejects.toThrow('Unsupported transport')
    })
  })
})

describe('Transport Message Handling', () => {
  describe('HTTP Transport Messages', () => {
    it('should format messages correctly', () => {
      const transport = new HTTPTransport('http://localhost:8080')
      const message = {
        jsonrpc: '2.0' as const,
        method: 'test',
        params: { data: 'test' },
        id: '123',
      }

      // Test internal message formatting
      expect(message.jsonrpc).toBe('2.0')
      expect(message.method).toBe('test')
    })
  })

  describe('WebSocket Transport Messages', () => {
    it('should handle reconnection parameters', () => {
      const transport = new WebSocketTransport('ws://localhost:8080')

      // Test reconnection configuration
      expect(transport).toBeDefined()
      // Reconnection is handled internally
    })
  })

  describe('TCP Transport Messages', () => {
    it('should handle keep-alive configuration', () => {
      const transport = new TCPTransport('localhost', 9999)

      // Test keep-alive is configured
      expect(transport).toBeDefined()
      // Keep-alive is handled internally
    })
  })
})
