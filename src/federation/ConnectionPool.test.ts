import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MCPConnectionPool, PooledConnection, ConnectionPoolConfig } from './ConnectionPool'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

// Mock the logger
vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock the Client
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    request: vi.fn(),
    notification: vi.fn(),
  })),
}))

// Mock transports
vi.mock('../protocol/index.js', () => ({
  HTTPTransport: vi.fn(),
  WebSocketTransport: vi.fn(),
  TCPTransport: vi.fn(),
}))

vi.mock('../protocol/sdk-transport-adapter.js', () => ({
  SDKTransportAdapter: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

describe('MCPConnectionPool', () => {
  let pool: MCPConnectionPool

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(async () => {
    if (pool) {
      await pool.close()
    }
    vi.useRealTimers()
  })

  describe('Connection Pooling & Reuse', () => {
    it('should create new connection on first request', async () => {
      pool = new MCPConnectionPool()

      const client = await pool.getClient('stdio://test-server')

      expect(client).toBeDefined()
      const stats = pool.getStats()
      expect(stats.totalConnections).toBe(1)
      expect(stats.activeConnections).toBe(1)
    })

    it('should reuse existing connection for same URL', async () => {
      pool = new MCPConnectionPool()

      const client1 = await pool.getClient('ws://localhost:8080')
      const client2 = await pool.getClient('ws://localhost:8080')

      expect(client1).toBe(client2)
      const stats = pool.getStats()
      expect(stats.totalConnections).toBe(1)
    })

    it('should create separate connections for different URLs', async () => {
      pool = new MCPConnectionPool()

      const client1 = await pool.getClient('ws://server1:8080')
      const client2 = await pool.getClient('ws://server2:8080')

      expect(client1).not.toBe(client2)
      const stats = pool.getStats()
      expect(stats.totalConnections).toBe(2)
    })

    it('should respect max connections limit', async () => {
      pool = new MCPConnectionPool({ maxConnections: 2 })

      await pool.getClient('ws://server1:8080')
      await pool.getClient('ws://server2:8080')

      // Third connection should evict least recently used
      await pool.getClient('ws://server3:8080')

      const stats = pool.getStats()
      expect(stats.totalConnections).toBe(2)
    })

    it('should update use count on reuse', async () => {
      pool = new MCPConnectionPool()

      await pool.getClient('ws://localhost:8080')
      await pool.getClient('ws://localhost:8080')
      await pool.getClient('ws://localhost:8080')

      const stats = pool.getStats()
      expect(stats.connectionsByUseCount[0]).toMatchObject({
        url: 'ws://localhost:8080',
        useCount: 3,
      })
    })

    it('should handle concurrent connection requests', async () => {
      pool = new MCPConnectionPool()

      const promises = [
        pool.getClient('ws://localhost:8080'),
        pool.getClient('ws://localhost:8080'),
        pool.getClient('ws://localhost:8080'),
      ]

      const clients = await Promise.all(promises)

      // All should get the same client
      expect(clients[0]).toBe(clients[1])
      expect(clients[1]).toBe(clients[2])

      const stats = pool.getStats()
      expect(stats.totalConnections).toBe(1)
    })
  })

  describe('Transport Auto-Negotiation', () => {
    it('should auto-negotiate transport when set to auto', async () => {
      pool = new MCPConnectionPool()

      const client = await pool.getClient('ws://localhost:8080', 'auto')

      expect(client).toBeDefined()
    })

    it('should use specific transport when specified', async () => {
      pool = new MCPConnectionPool()

      const client = await pool.getClient('localhost:8080', 'tcp')

      expect(client).toBeDefined()
      const stats = pool.getStats()
      expect(stats.connectionsByTransport['tcp']).toBe(1)
    })

    it('should handle stdio transport', async () => {
      pool = new MCPConnectionPool()

      const client = await pool.getClient('stdio://test-process')

      expect(client).toBeDefined()
      const stats = pool.getStats()
      expect(stats.connectionsByTransport['stdio']).toBe(1)
    })

    it('should handle websocket transport', async () => {
      pool = new MCPConnectionPool()

      const client = await pool.getClient('ws://localhost:8080', 'websocket')

      expect(client).toBeDefined()
      const stats = pool.getStats()
      expect(stats.connectionsByTransport['websocket']).toBe(1)
    })

    it('should handle http transport', async () => {
      pool = new MCPConnectionPool()

      const client = await pool.getClient('http://localhost:3000', 'http')

      expect(client).toBeDefined()
      const stats = pool.getStats()
      expect(stats.connectionsByTransport['http']).toBe(1)
    })

    it('should handle tcp transport', async () => {
      pool = new MCPConnectionPool()

      const client = await pool.getClient('tcp://localhost:9999', 'tcp')

      expect(client).toBeDefined()
      const stats = pool.getStats()
      expect(stats.connectionsByTransport['tcp']).toBe(1)
    })

    it('should fallback transports on failure', async () => {
      // Mock first transport to fail
      const createConnectionSpy = vi.spyOn(MCPConnectionPool.prototype as any, 'createConnection')
      createConnectionSpy
        .mockRejectedValueOnce(new Error('Transport failed'))
        .mockResolvedValueOnce({
          url: 'test://server',
          transport: 'websocket',
          client: new Client({ name: 'test' }),
          connectedAt: new Date(),
          lastUsed: new Date(),
          useCount: 1,
          healthy: true,
        })

      pool = new MCPConnectionPool({ retryAttempts: 2 })

      const client = await pool.getClient('test://server', 'auto')

      expect(client).toBeDefined()
      expect(createConnectionSpy).toHaveBeenCalledTimes(2)

      createConnectionSpy.mockRestore()
    })
  })

  describe('Connection TTL & Cleanup', () => {
    it('should cleanup expired connections', async () => {
      pool = new MCPConnectionPool({
        connectionTTL: 1000, // 1 second
        healthCheckInterval: 500,
      })

      await pool.getClient('ws://localhost:8080')

      expect(pool.getStats().totalConnections).toBe(1)

      // Fast-forward time past TTL
      vi.advanceTimersByTime(1500)

      // Allow cleanup to run
      await vi.runAllTimersAsync()

      expect(pool.getStats().totalConnections).toBe(0)
    })

    it('should cleanup idle connections', async () => {
      pool = new MCPConnectionPool({
        idleTimeout: 1000, // 1 second
        healthCheckInterval: 500,
      })

      await pool.getClient('ws://localhost:8080')

      expect(pool.getStats().totalConnections).toBe(1)

      // Fast-forward time past idle timeout
      vi.advanceTimersByTime(1500)

      // Allow cleanup to run
      await vi.runAllTimersAsync()

      expect(pool.getStats().totalConnections).toBe(0)
    })

    it('should not cleanup recently used connections', async () => {
      pool = new MCPConnectionPool({
        idleTimeout: 1000,
        healthCheckInterval: 500,
      })

      await pool.getClient('ws://localhost:8080')

      // Use connection before idle timeout
      vi.advanceTimersByTime(500)
      await pool.getClient('ws://localhost:8080')

      // Advance more time
      vi.advanceTimersByTime(600)

      // Connection should still be active
      expect(pool.getStats().totalConnections).toBe(1)
    })

    it('should evict LRU connection when at max capacity', async () => {
      pool = new MCPConnectionPool({
        maxConnections: 2,
      })

      await pool.getClient('ws://server1:8080') // Oldest
      await pool.getClient('ws://server2:8080')

      // Use server1 to make it more recently used
      await pool.getClient('ws://server1:8080')

      // This should evict server2 (least recently used)
      await pool.getClient('ws://server3:8080')

      const stats = pool.getStats()
      expect(stats.totalConnections).toBe(2)

      // Check that server2 was evicted
      const connections = stats.connectionsByUseCount
      const urls = connections.map((c) => c.url)
      expect(urls).toContain('ws://server1:8080')
      expect(urls).toContain('ws://server3:8080')
      expect(urls).not.toContain('ws://server2:8080')
    })
  })

  describe('Health Checks & Reconnection', () => {
    it('should perform periodic health checks', async () => {
      const healthCheckSpy = vi.fn().mockResolvedValue(true)

      pool = new MCPConnectionPool({
        healthCheckInterval: 100,
      })

      // Mock the health check method
      ;(pool as any).checkConnectionHealth = healthCheckSpy

      await pool.getClient('ws://localhost:8080')

      // Fast-forward to trigger health checks
      vi.advanceTimersByTime(300)
      await vi.runAllTimersAsync()

      expect(healthCheckSpy).toHaveBeenCalled()
    })

    it('should mark unhealthy connections', async () => {
      pool = new MCPConnectionPool()

      const client = await pool.getClient('ws://localhost:8080')

      // Mock the client to be unhealthy
      const connection = (pool as any).connections.get('ws://localhost:8080:auto')
      if (connection) {
        connection.healthy = false
      }

      // Getting the client again should create a new connection
      const client2 = await pool.getClient('ws://localhost:8080')

      expect(client2).not.toBe(client)
    })

    it('should reconnect failed connections', async () => {
      pool = new MCPConnectionPool({
        retryAttempts: 3,
        retryDelay: 100,
      })

      // Mock connection to fail then succeed
      let attempts = 0
      const createConnectionSpy = vi.spyOn(MCPConnectionPool.prototype as any, 'createConnection')
      createConnectionSpy.mockImplementation(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Connection failed')
        }
        return {
          url: 'ws://localhost:8080',
          transport: 'websocket',
          client: new Client({ name: 'test' }),
          connectedAt: new Date(),
          lastUsed: new Date(),
          useCount: 1,
          healthy: true,
        }
      })

      const client = await pool.getClient('ws://localhost:8080')

      expect(client).toBeDefined()
      expect(attempts).toBe(3)

      createConnectionSpy.mockRestore()
    })

    it('should give up after max retry attempts', async () => {
      pool = new MCPConnectionPool({
        retryAttempts: 2,
        retryDelay: 10,
      })

      const createConnectionSpy = vi.spyOn(MCPConnectionPool.prototype as any, 'createConnection')
      createConnectionSpy.mockRejectedValue(new Error('Connection failed'))

      await expect(pool.getClient('ws://localhost:8080')).rejects.toThrow()

      createConnectionSpy.mockRestore()
    })
  })

  describe('Statistics & Monitoring', () => {
    it('should provide connection statistics', async () => {
      pool = new MCPConnectionPool()

      await pool.getClient('ws://server1:8080')
      await pool.getClient('ws://server2:8080')
      await pool.getClient('tcp://server3:9999', 'tcp')

      const stats = pool.getStats()

      expect(stats.totalConnections).toBe(3)
      expect(stats.activeConnections).toBe(3)
      expect(stats.idleConnections).toBe(0)
      expect(stats.connectionsByTransport['websocket']).toBe(2)
      expect(stats.connectionsByTransport['tcp']).toBe(1)
    })

    it('should track connection age', async () => {
      pool = new MCPConnectionPool()

      await pool.getClient('ws://localhost:8080')

      // Wait a bit
      vi.advanceTimersByTime(5000)

      const stats = pool.getStats()
      const connection = stats.connectionsByUseCount[0]

      expect(connection.ageMs).toBeGreaterThanOrEqual(5000)
    })

    it('should track connection health status', async () => {
      pool = new MCPConnectionPool()

      await pool.getClient('ws://server1:8080')
      await pool.getClient('ws://server2:8080')

      // Mark one as unhealthy
      const connection = (pool as any).connections.get('ws://server1:8080:auto')
      if (connection) {
        connection.healthy = false
      }

      const stats = pool.getStats()

      expect(stats.healthyConnections).toBe(1)
      expect(stats.unhealthyConnections).toBe(1)
    })
  })

  describe('Cleanup & Resource Management', () => {
    it('should close all connections on pool close', async () => {
      pool = new MCPConnectionPool()

      const client1 = await pool.getClient('ws://server1:8080')
      const client2 = await pool.getClient('ws://server2:8080')

      const closeSpy1 = vi.spyOn(client1, 'close')
      const closeSpy2 = vi.spyOn(client2, 'close')

      await pool.close()

      expect(closeSpy1).toHaveBeenCalled()
      expect(closeSpy2).toHaveBeenCalled()
      expect(pool.getStats().totalConnections).toBe(0)
    })

    it('should stop maintenance tasks on close', async () => {
      pool = new MCPConnectionPool({
        healthCheckInterval: 100,
      })

      await pool.getClient('ws://localhost:8080')

      // Close the pool
      await pool.close()

      // Advance timers - no health checks should occur
      const healthCheckSpy = vi.fn()
      ;(pool as any).checkConnectionHealth = healthCheckSpy

      vi.advanceTimersByTime(500)

      expect(healthCheckSpy).not.toHaveBeenCalled()
    })

    it('should handle errors during cleanup gracefully', async () => {
      pool = new MCPConnectionPool()

      const client = await pool.getClient('ws://localhost:8080')

      // Mock close to throw error
      vi.spyOn(client, 'close').mockRejectedValue(new Error('Close failed'))

      // Should not throw
      await expect(pool.close()).resolves.not.toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should handle malformed URLs', async () => {
      pool = new MCPConnectionPool()

      await expect(pool.getClient('not-a-url')).rejects.toThrow()
    })

    it('should handle empty URL', async () => {
      pool = new MCPConnectionPool()

      await expect(pool.getClient('')).rejects.toThrow()
    })

    it('should handle connection key collisions', async () => {
      pool = new MCPConnectionPool()

      // These should create different connections despite similar URLs
      await pool.getClient('ws://localhost:8080', 'websocket')
      await pool.getClient('ws://localhost:8080', 'auto')

      const stats = pool.getStats()
      expect(stats.totalConnections).toBe(2)
    })

    it('should handle rapid connection cycling', async () => {
      pool = new MCPConnectionPool({
        maxConnections: 2,
      })

      // Rapidly create connections to different servers
      for (let i = 0; i < 10; i++) {
        await pool.getClient(`ws://server${i}:8080`)
      }

      const stats = pool.getStats()
      expect(stats.totalConnections).toBe(2)
    })
  })
})
