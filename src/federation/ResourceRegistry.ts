import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import { logger } from '../utils/logger.js'

/**
 * Represents a federated resource with server information
 */
export interface FederatedResource extends Resource {
  serverAlias: string
  fullUri: string
  lastSeen?: Date
  cached?: boolean
}

/**
 * Registry for managing federated MCP resources across multiple servers
 * Provides namespacing, caching, and resource resolution
 */
export class ResourceRegistry {
  private resources = new Map<string, FederatedResource>()
  private serverResources = new Map<string, Set<string>>()
  private uriToResourceMap = new Map<string, string>()

  constructor() {}

  /**
   * Register resources from a server
   * @param serverAlias The alias of the server
   * @param resources The resources to register
   */
  register(serverAlias: string, resources: Resource[]): void {
    // Clear existing resources for this server
    this.clearServer(serverAlias)

    // Initialize server resource set
    const serverSet = new Set<string>()
    this.serverResources.set(serverAlias, serverSet)

    // Register each resource
    for (const resource of resources) {
      const federatedResource: FederatedResource = {
        ...resource,
        serverAlias,
        fullUri: `mcp://${serverAlias}/${resource.uri}`,
        lastSeen: new Date(),
        cached: false,
      }

      const key = this.getResourceKey(serverAlias, resource.uri)
      this.resources.set(key, federatedResource)
      serverSet.add(key)

      // Map URIs for quick lookup
      this.uriToResourceMap.set(federatedResource.fullUri, key)
      this.uriToResourceMap.set(`${serverAlias}:${resource.uri}`, key)
    }

    logger.info(`📦 Registered ${resources.length} resources from server '${serverAlias}'`)
  }

  /**
   * Resolve a resource URI to server and resource information
   * @param uri The URI to resolve (can be full mcp:// or relative)
   * @returns The server alias and resource, or null if not found
   */
  resolve(uri: string): { server: string; resource: FederatedResource } | null {
    // Try direct lookup first
    const key = this.uriToResourceMap.get(uri)
    if (key) {
      const resource = this.resources.get(key)
      if (resource) {
        return { server: resource.serverAlias, resource }
      }
    }

    // Try parsing MCP URI
    if (uri.startsWith('mcp://')) {
      const match = uri.match(/^mcp:\/\/([^/]+)\/(.+)$/)
      if (match) {
        const [, serverAlias, resourceUri] = match
        const resourceKey = this.getResourceKey(serverAlias, resourceUri)
        const resource = this.resources.get(resourceKey)
        if (resource) {
          return { server: serverAlias, resource }
        }
      }
    }

    // Try finding by partial match (server:resource format)
    for (const resource of this.resources.values()) {
      if (uri === resource.uri || uri === `${resource.serverAlias}:${resource.uri}`) {
        return { server: resource.serverAlias, resource }
      }
    }

    return null
  }

  /**
   * Get all resources from a specific server
   * @param serverAlias The server alias
   * @returns Array of federated resources
   */
  getServerResources(serverAlias: string): FederatedResource[] {
    const serverSet = this.serverResources.get(serverAlias)
    if (!serverSet) return []

    return Array.from(serverSet)
      .map((key) => this.resources.get(key))
      .filter((r): r is FederatedResource => r !== undefined)
  }

  /**
   * Get all resources across all servers
   * @returns Array of all federated resources
   */
  getAllResources(): FederatedResource[] {
    return Array.from(this.resources.values())
  }

  /**
   * Search for resources by name or URI pattern
   * @param pattern The search pattern (supports * wildcard)
   * @returns Matching resources
   */
  search(pattern: string): FederatedResource[] {
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i')

    return Array.from(this.resources.values()).filter(
      (resource) =>
        regex.test(resource.name) || regex.test(resource.uri) || regex.test(resource.fullUri)
    )
  }

  /**
   * Mark a resource as cached
   * @param uri The resource URI
   */
  markCached(uri: string): void {
    const resolved = this.resolve(uri)
    if (resolved) {
      resolved.resource.cached = true
    }
  }

  /**
   * Check if a resource is cached
   * @param uri The resource URI
   * @returns True if cached
   */
  isCached(uri: string): boolean {
    const resolved = this.resolve(uri)
    return resolved?.resource.cached ?? false
  }

  /**
   * Clear resources for a specific server
   * @param serverAlias The server alias
   */
  clearServer(serverAlias: string): void {
    const serverSet = this.serverResources.get(serverAlias)
    if (serverSet) {
      for (const key of serverSet) {
        const resource = this.resources.get(key)
        if (resource) {
          // Remove from URI mappings
          this.uriToResourceMap.delete(resource.fullUri)
          this.uriToResourceMap.delete(`${serverAlias}:${resource.uri}`)
        }
        this.resources.delete(key)
      }
      this.serverResources.delete(serverAlias)
    }
  }

  /**
   * Clear all resources
   */
  clearAll(): void {
    this.resources.clear()
    this.serverResources.clear()
    this.uriToResourceMap.clear()
  }

  /**
   * Get statistics about the registry
   */
  getStats(): {
    totalResources: number
    totalServers: number
    cachedResources: number
    serverStats: Record<string, number>
  } {
    const cachedResources = Array.from(this.resources.values()).filter((r) => r.cached).length

    const serverStats: Record<string, number> = {}
    for (const [server, resources] of this.serverResources) {
      serverStats[server] = resources.size
    }

    return {
      totalResources: this.resources.size,
      totalServers: this.serverResources.size,
      cachedResources,
      serverStats,
    }
  }

  /**
   * Generate a unique key for a resource
   */
  private getResourceKey(serverAlias: string, uri: string): string {
    return `${serverAlias}::${uri}`
  }

  /**
   * Export registry data for persistence
   */
  export(): {
    resources: Array<[string, FederatedResource]>
    serverResources: Array<[string, string[]]>
  } {
    return {
      resources: Array.from(this.resources.entries()),
      serverResources: Array.from(this.serverResources.entries()).map(([server, set]) => [
        server,
        Array.from(set),
      ]),
    }
  }

  /**
   * Import registry data from persistence
   */
  import(data: {
    resources: Array<[string, FederatedResource]>
    serverResources: Array<[string, string[]]>
  }): void {
    this.clearAll()

    // Restore resources
    for (const [key, resource] of data.resources) {
      this.resources.set(key, resource)
      this.uriToResourceMap.set(resource.fullUri, key)
      this.uriToResourceMap.set(`${resource.serverAlias}:${resource.uri}`, key)
    }

    // Restore server mappings
    for (const [server, keys] of data.serverResources) {
      this.serverResources.set(server, new Set(keys))
    }
  }
}
