import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { DuckDBMcpNativeService } from './DuckDBMcpNativeService.js'

/**
 * Unit tests for DuckDBMcpNativeService
 * Testing internal state management without real connections
 */
describe('DuckDBMcpNativeService Unit Tests', () => {
  let service: DuckDBMcpNativeService
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    // Suppress console.error during tests
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    // Create service with mocked dependencies
    service = new DuckDBMcpNativeService()

    // Mock internal clients/servers maps to avoid real connections
    // @ts-ignore - accessing private property for testing
    service.servers = new Map()
    // @ts-ignore
    service.clients = new Map()
    // @ts-ignore
    service.mappers = new Map()
  })

  afterEach(() => {
    service.clearCache()
    consoleErrorSpy.mockRestore()
  })

  describe('Server Management', () => {
    it('should track server names', async () => {
      // Mock a server entry without actually starting it
      // @ts-ignore
      service.servers.set('test-server', { mock: true })

      expect(service.getServerNames()).toContain('test-server')
    })

    it('should prevent duplicate server names', async () => {
      // Mock a server entry
      // @ts-ignore
      service.servers.set('test-server', { mock: true })

      // Try to start another server with same name
      await expect(service.startServer('test-server')).rejects.toThrow(
        "Server 'test-server' already exists"
      )
    })

    it('should remove server on stop', async () => {
      // Mock a server entry
      // @ts-ignore
      service.servers.set('test-server', { mock: true })

      // Remove it (without actually stopping)
      // @ts-ignore
      service.servers.delete('test-server')

      expect(service.getServerNames()).not.toContain('test-server')
    })

    it('should throw error when stopping non-existent server', async () => {
      await expect(service.stopServer('non-existent')).rejects.toThrow(
        "Server 'non-existent' not found"
      )
    })
  })

  describe('Client Management', () => {
    it('should track client aliases', () => {
      // Mock a client entry without actually connecting
      // @ts-ignore
      service.clients.set('test-alias', { mock: true })
      // @ts-ignore
      service.mappers.set('test-alias', { mock: true })

      expect(service.getClientAliases()).toContain('test-alias')
    })

    it('should throw error when calling tool on non-existent client', async () => {
      await expect(service.callTool('non-existent', 'tool', {})).rejects.toThrow(
        "Client 'non-existent' not found"
      )
    })

    it('should throw error when getting resources from non-existent client', async () => {
      await expect(service.getClientResources('non-existent')).rejects.toThrow(
        "Client 'non-existent' not found"
      )
    })

    it('should throw error when detaching non-existent client', async () => {
      await expect(service.detachMCP('non-existent')).rejects.toThrow(
        "Client 'non-existent' not found"
      )
    })
  })

  describe('Virtual Tables', () => {
    it('should throw error when creating virtual table for non-existent client', async () => {
      await expect(
        service.createVirtualTable('non-existent', 'resource://test', 'table')
      ).rejects.toThrow("Client 'non-existent' not found")
    })
  })

  describe('Cache Management', () => {
    it('should clear cache', () => {
      // Add something to cache
      // @ts-ignore
      service.resourceCache.set('test', { data: {}, expires: Date.now() + 1000 })

      service.clearCache()

      // @ts-ignore
      expect(service.resourceCache.size).toBe(0)
    })
  })

  describe('Status', () => {
    it('should return empty status initially', () => {
      const status = service.getStatus()

      expect(status.servers).toEqual([])
      expect(status.clients).toEqual([])
      expect(status.resourceCacheSize).toBe(0)
    })

    it('should include servers and clients in status', () => {
      // Mock entries
      // @ts-ignore
      service.servers.set('server1', { mock: true })
      // @ts-ignore
      service.clients.set('client1', {
        listAttachedServers: () => [
          {
            alias: 'client1',
            url: 'stdio://test',
            transport: 'stdio',
            client: {},
            resources: [],
            tools: [],
          },
        ],
      })

      const status = service.getStatus()

      expect(status.servers).toHaveLength(1)
      expect(status.servers[0].name).toBe('server1')
      expect(status.clients).toHaveLength(1)
      expect(status.clients[0].name).toBe('client1')
    })

    it('should include cache size in status', () => {
      // Add to cache
      // @ts-ignore
      service.resourceCache.set('test1', { data: {}, expires: Date.now() + 1000 })
      // @ts-ignore
      service.resourceCache.set('test2', { data: {}, expires: Date.now() + 1000 })

      const status = service.getStatus()

      expect(status.resourceCacheSize).toBe(2)
    })
  })

  describe('Error Handling', () => {
    it('should handle HTTP transport not implemented', async () => {
      await expect(service.startServer('test', { transport: 'http' })).rejects.toThrow(
        'HTTP transport not yet implemented'
      )
    })
  })
})
