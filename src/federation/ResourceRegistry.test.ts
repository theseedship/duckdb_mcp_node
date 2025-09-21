import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ResourceRegistry, FederatedResource } from './ResourceRegistry'
import type { Resource } from '@modelcontextprotocol/sdk/types.js'

// Mock the logger
vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('ResourceRegistry', () => {
  let registry: ResourceRegistry

  beforeEach(() => {
    vi.clearAllMocks()
    registry = new ResourceRegistry()
  })

  describe('register', () => {
    it('should register resources from a server', () => {
      const resources: Resource[] = [
        { uri: 'data.json', name: 'Data File' },
        { uri: 'config.yaml', name: 'Configuration' },
      ]

      registry.register('github', resources)

      const serverResources = registry.getServerResources('github')
      expect(serverResources).toHaveLength(2)
    })

    it('should create federated resources with metadata', () => {
      const resources: Resource[] = [{ uri: 'users.csv', name: 'User Data' }]

      registry.register('analytics', resources)

      const serverResources = registry.getServerResources('analytics')
      expect(serverResources[0]).toMatchObject({
        uri: 'users.csv',
        name: 'User Data',
        serverAlias: 'analytics',
        fullUri: 'mcp://analytics/users.csv',
        cached: false,
      })
      expect(serverResources[0].lastSeen).toBeInstanceOf(Date)
    })

    it('should clear existing resources when re-registering', () => {
      const resources1: Resource[] = [{ uri: 'old.json', name: 'Old Data' }]
      const resources2: Resource[] = [{ uri: 'new.json', name: 'New Data' }]

      registry.register('server1', resources1)
      expect(registry.getServerResources('server1')).toHaveLength(1)

      registry.register('server1', resources2)
      const serverResources = registry.getServerResources('server1')
      expect(serverResources).toHaveLength(1)
      expect(serverResources[0].uri).toBe('new.json')
    })

    it('should handle empty resource list', () => {
      registry.register('empty-server', [])
      expect(registry.getServerResources('empty-server')).toHaveLength(0)
    })

    it('should register resources from multiple servers', () => {
      const githubResources: Resource[] = [{ uri: 'issues.json', name: 'Issues' }]
      const databaseResources: Resource[] = [{ uri: 'users.parquet', name: 'Users' }]

      registry.register('github', githubResources)
      registry.register('database', databaseResources)

      expect(registry.getServerResources('github')).toHaveLength(1)
      expect(registry.getServerResources('database')).toHaveLength(1)
      expect(registry.getAllResources()).toHaveLength(2)
    })

    it('should create URI mappings for quick lookup', () => {
      const resources: Resource[] = [{ uri: 'data/file.csv', name: 'CSV File' }]

      registry.register('storage', resources)

      // Should be resolvable by full URI
      const resolved1 = registry.resolve('mcp://storage/data/file.csv')
      expect(resolved1).not.toBeNull()
      expect(resolved1?.resource.uri).toBe('data/file.csv')

      // Should be resolvable by server:uri format
      const resolved2 = registry.resolve('storage:data/file.csv')
      expect(resolved2).not.toBeNull()
      expect(resolved2?.resource.uri).toBe('data/file.csv')
    })
  })

  describe('resolve', () => {
    beforeEach(() => {
      const resources: Resource[] = [
        { uri: 'users.json', name: 'Users' },
        { uri: 'products.csv', name: 'Products' },
      ]
      registry.register('api', resources)
    })

    it('should resolve full MCP URI', () => {
      const result = registry.resolve('mcp://api/users.json')
      expect(result).not.toBeNull()
      expect(result?.server).toBe('api')
      expect(result?.resource.uri).toBe('users.json')
    })

    it('should resolve server:resource format', () => {
      const result = registry.resolve('api:products.csv')
      expect(result).not.toBeNull()
      expect(result?.server).toBe('api')
      expect(result?.resource.uri).toBe('products.csv')
    })

    it('should return null for non-existent resource', () => {
      const result = registry.resolve('mcp://api/nonexistent.txt')
      expect(result).toBeNull()
    })

    it('should return null for non-existent server', () => {
      const result = registry.resolve('mcp://unknown/file.json')
      expect(result).toBeNull()
    })

    it('should handle glob patterns', () => {
      const resources: Resource[] = [
        { uri: 'logs/2024-01-01.log', name: 'Log 1' },
        { uri: 'logs/2024-01-02.log', name: 'Log 2' },
        { uri: 'data/users.json', name: 'Users' },
      ]
      registry.register('storage', resources)

      // Resolve glob pattern
      const matches = registry.resolveGlob('mcp://storage/logs/*.log')
      expect(matches).toHaveLength(2)
      expect(matches[0].resource.uri).toContain('.log')
      expect(matches[1].resource.uri).toContain('.log')
    })

    it('should resolve server wildcard patterns', () => {
      const resources1: Resource[] = [{ uri: 'data.json', name: 'Data 1' }]
      const resources2: Resource[] = [{ uri: 'data.json', name: 'Data 2' }]

      registry.register('server1', resources1)
      registry.register('server2', resources2)

      const matches = registry.resolveGlob('mcp://*/data.json')
      expect(matches).toHaveLength(2)
      expect(matches.map((m) => m.server).sort()).toEqual(['server1', 'server2'])
    })

    it('should handle nested paths', () => {
      const resources: Resource[] = [{ uri: 'path/to/deep/file.txt', name: 'Deep File' }]
      registry.register('nested', resources)

      const result = registry.resolve('mcp://nested/path/to/deep/file.txt')
      expect(result).not.toBeNull()
      expect(result?.resource.uri).toBe('path/to/deep/file.txt')
    })

    it('should handle special characters in URIs', () => {
      const resources: Resource[] = [
        { uri: 'file-with-dashes.json', name: 'Dashed' },
        { uri: 'file_with_underscores.csv', name: 'Underscored' },
      ]
      registry.register('special', resources)

      expect(registry.resolve('mcp://special/file-with-dashes.json')).not.toBeNull()
      expect(registry.resolve('mcp://special/file_with_underscores.csv')).not.toBeNull()
    })

    it('should mark resources as cached when resolved', () => {
      const result = registry.resolve('mcp://api/users.json')
      expect(result?.resource.cached).toBe(false)

      // Mark as cached
      if (result) {
        result.resource.cached = true
      }

      const result2 = registry.resolve('mcp://api/users.json')
      expect(result2?.resource.cached).toBe(true)
    })
  })

  describe('getServerResources', () => {
    it('should return all resources for a server', () => {
      const resources: Resource[] = [
        { uri: 'file1.txt', name: 'File 1' },
        { uri: 'file2.txt', name: 'File 2' },
        { uri: 'file3.txt', name: 'File 3' },
      ]

      registry.register('myserver', resources)

      const serverResources = registry.getServerResources('myserver')
      expect(serverResources).toHaveLength(3)
      expect(serverResources.every((r) => r.serverAlias === 'myserver')).toBe(true)
    })

    it('should return empty array for non-existent server', () => {
      const serverResources = registry.getServerResources('nonexistent')
      expect(serverResources).toEqual([])
    })
  })

  describe('getAllResources', () => {
    it('should return resources from all servers', () => {
      registry.register('server1', [{ uri: 'file1.txt', name: 'File 1' }])
      registry.register('server2', [{ uri: 'file2.txt', name: 'File 2' }])
      registry.register('server3', [{ uri: 'file3.txt', name: 'File 3' }])

      const allResources = registry.getAllResources()
      expect(allResources).toHaveLength(3)

      const servers = new Set(allResources.map((r) => r.serverAlias))
      expect(servers.size).toBe(3)
    })

    it('should return empty array when no resources registered', () => {
      const allResources = registry.getAllResources()
      expect(allResources).toEqual([])
    })
  })

  describe('clearServer', () => {
    it('should remove all resources for a server', () => {
      registry.register('server1', [{ uri: 'file1.txt', name: 'File 1' }])
      registry.register('server2', [{ uri: 'file2.txt', name: 'File 2' }])

      expect(registry.getAllResources()).toHaveLength(2)

      registry.clearServer('server1')

      const remaining = registry.getAllResources()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].serverAlias).toBe('server2')
    })

    it('should handle clearing non-existent server', () => {
      expect(() => registry.clearServer('nonexistent')).not.toThrow()
    })
  })

  describe('clearAll', () => {
    it('should remove all resources from all servers', () => {
      registry.register('server1', [{ uri: 'file1.txt', name: 'File 1' }])
      registry.register('server2', [{ uri: 'file2.txt', name: 'File 2' }])
      registry.register('server3', [{ uri: 'file3.txt', name: 'File 3' }])

      expect(registry.getAllResources()).toHaveLength(3)

      registry.clearAll()

      expect(registry.getAllResources()).toHaveLength(0)
      expect(registry.getServerResources('server1')).toHaveLength(0)
      expect(registry.getServerResources('server2')).toHaveLength(0)
      expect(registry.getServerResources('server3')).toHaveLength(0)
    })
  })

  describe('getStats', () => {
    it('should return registry statistics', () => {
      registry.register('server1', [
        { uri: 'file1.txt', name: 'File 1' },
        { uri: 'file2.txt', name: 'File 2' },
      ])
      registry.register('server2', [{ uri: 'file3.txt', name: 'File 3' }])

      const stats = registry.getStats()

      expect(stats.totalResources).toBe(3)
      expect(stats.totalServers).toBe(2)
      expect(stats.serverStats).toHaveLength(2)
      expect(stats.serverStats.find((s) => s.alias === 'server1')?.resourceCount).toBe(2)
      expect(stats.serverStats.find((s) => s.alias === 'server2')?.resourceCount).toBe(1)
    })

    it('should track cached resources', () => {
      registry.register('server1', [{ uri: 'file.txt', name: 'File' }])

      const result = registry.resolve('mcp://server1/file.txt')
      if (result) {
        result.resource.cached = true
      }

      const stats = registry.getStats()
      expect(stats.cachedResources).toBe(1)
    })

    it('should return empty stats when no resources', () => {
      const stats = registry.getStats()

      expect(stats.totalResources).toBe(0)
      expect(stats.totalServers).toBe(0)
      expect(stats.cachedResources).toBe(0)
      expect(stats.serverStats).toHaveLength(0)
    })
  })

  describe('namespace collision handling', () => {
    it('should handle same URI on different servers', () => {
      registry.register('server1', [{ uri: 'data.json', name: 'Data 1' }])
      registry.register('server2', [{ uri: 'data.json', name: 'Data 2' }])

      const result1 = registry.resolve('mcp://server1/data.json')
      const result2 = registry.resolve('mcp://server2/data.json')

      expect(result1?.resource.name).toBe('Data 1')
      expect(result2?.resource.name).toBe('Data 2')
    })

    it('should maintain separate namespaces per server', () => {
      const resources: Resource[] = [{ uri: 'common/file.txt', name: 'Common File' }]

      registry.register('namespace1', resources)
      registry.register('namespace2', resources)

      const all = registry.getAllResources()
      expect(all).toHaveLength(2)
      expect(all[0].fullUri).not.toBe(all[1].fullUri)
    })
  })

  describe('performance', () => {
    it('should handle large number of resources efficiently', () => {
      const resources: Resource[] = []
      for (let i = 0; i < 1000; i++) {
        resources.push({ uri: `file${i}.txt`, name: `File ${i}` })
      }

      const start = performance.now()
      registry.register('bigserver', resources)
      const registerTime = performance.now() - start

      expect(registerTime).toBeLessThan(100) // Should register 1000 resources in < 100ms
      expect(registry.getServerResources('bigserver')).toHaveLength(1000)

      const resolveStart = performance.now()
      registry.resolve('mcp://bigserver/file500.txt')
      const resolveTime = performance.now() - resolveStart

      expect(resolveTime).toBeLessThan(10) // Should resolve in < 10ms
    })
  })

  describe('resource freshness', () => {
    it('should track lastSeen timestamp', async () => {
      const resources: Resource[] = [{ uri: 'data.json', name: 'Data' }]

      registry.register('server', resources)
      const result1 = registry.resolve('mcp://server/data.json')
      const firstSeen = result1?.resource.lastSeen

      // Wait a bit and re-register
      await new Promise((resolve) => setTimeout(resolve, 10))

      registry.register('server', resources)
      const result2 = registry.resolve('mcp://server/data.json')
      const secondSeen = result2?.resource.lastSeen

      expect(secondSeen).not.toEqual(firstSeen)
      expect(secondSeen!.getTime()).toBeGreaterThan(firstSeen!.getTime())
    })
  })
})
