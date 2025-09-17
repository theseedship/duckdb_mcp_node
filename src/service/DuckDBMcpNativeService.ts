import { DuckDBMCPServer } from '../server/mcp-server.js'
import { MCPClient } from '../client/MCPClient.js'
import { ResourceMapper } from '../client/ResourceMapper.js'
import { getDuckDBService } from '../duckdb/service.js'
import type { ServerConfig, AttachOptions, ServiceStatus } from './types.js'

/**
 * Unified service for managing DuckDB MCP servers and clients
 * Provides high-level API for server management and resource attachment
 */
export class DuckDBMcpNativeService {
  private servers = new Map<string, DuckDBMCPServer>()
  private clients = new Map<string, MCPClient>()
  private mappers = new Map<string, ResourceMapper>()
  private resourceCache = new Map<string, { data: any; expires: number }>()

  constructor() {}

  /**
   * Start an MCP server with the given name and configuration
   */
  async startServer(name: string, config?: ServerConfig): Promise<void> {
    if (this.servers.has(name)) {
      throw new Error(`Server '${name}' already exists`)
    }

    const server = new DuckDBMCPServer()

    // Start server based on transport type
    if (config?.transport === 'http') {
      // HTTP transport not yet implemented
      throw new Error('HTTP transport not yet implemented')
    } else {
      // Default to stdio transport
      await server.start()
    }

    this.servers.set(name, server)
    console.error(`MCP server '${name}' started successfully`)
  }

  /**
   * Stop and remove an MCP server
   */
  async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server) {
      throw new Error(`Server '${name}' not found`)
    }

    // Server cleanup would go here if needed
    this.servers.delete(name)
    console.error(`MCP server '${name}' stopped`)
  }

  /**
   * Attach to an external MCP server and map its resources
   */
  async attachMCP(url: string, alias: string, options?: AttachOptions): Promise<any[]> {
    if (this.clients.has(alias)) {
      throw new Error(`Client '${alias}' already exists`)
    }

    // Create and connect client
    const client = new MCPClient()
    await client.attachServer(url, alias, 'stdio')

    // Create resource mapper - pass getDuckDBService instead
    const duckdb = await getDuckDBService()
    const mapper = new ResourceMapper(duckdb)

    // List available resources with caching
    const cacheKey = `mcp:resources:${url}`
    let resources: any[] = []

    if (!options?.skipCache) {
      const cached = this.resourceCache.get(cacheKey)
      if (cached && cached.expires > Date.now()) {
        resources = cached.data
        console.error(`Using cached resources for ${url}`)
      }
    }

    if (resources.length === 0) {
      resources = await client.listResources()

      // Cache resources for 5 minutes
      const cacheDuration = options?.cacheTTL || 300000 // 5 minutes default
      this.resourceCache.set(cacheKey, {
        data: resources,
        expires: Date.now() + cacheDuration,
      })
    }

    // Store client and mapper
    this.clients.set(alias, client)
    this.mappers.set(alias, mapper)

    console.error(`Attached to MCP server at ${url} as '${alias}'`)
    console.error(`Found ${resources.length} resources`)

    return resources
  }

  /**
   * Detach from an MCP server
   */
  async detachMCP(alias: string): Promise<void> {
    const client = this.clients.get(alias)
    if (!client) {
      throw new Error(`Client '${alias}' not found`)
    }

    await client.detachServer(alias)
    this.clients.delete(alias)
    this.mappers.delete(alias)

    console.error(`Detached from MCP server '${alias}'`)
  }

  /**
   * Create a virtual table from an MCP resource
   */
  async createVirtualTable(alias: string, resourceUri: string, tableName?: string): Promise<void> {
    const client = this.clients.get(alias)
    const mapper = this.mappers.get(alias)

    if (!client || !mapper) {
      throw new Error(`Client '${alias}' not found`)
    }

    // Use the mapper to create a virtual table
    const resource = await client.readResource(resourceUri, alias)
    const finalTableName = tableName || resourceUri.split('/').pop() || 'resource_table'
    const table = await mapper.mapResource(resourceUri, finalTableName, resource, undefined, alias)
    console.error(`Created virtual table: ${table.tableName}`)
  }

  /**
   * Call a tool on a connected MCP server
   */
  async callTool(alias: string, toolName: string, args: any): Promise<any> {
    const client = this.clients.get(alias)
    if (!client) {
      throw new Error(`Client '${alias}' not found`)
    }

    return await client.callTool(alias, toolName, args)
  }

  /**
   * Get the status of all servers and clients
   */
  getStatus(): ServiceStatus {
    const servers = Array.from(this.servers.keys()).map((name) => ({
      name,
      type: 'server' as const,
      status: 'running' as const,
    }))

    const clients = Array.from(this.clients.keys()).map((alias) => ({
      name: alias,
      type: 'client' as const,
      status: 'connected' as const,
    }))

    return {
      servers,
      clients,
      resourceCacheSize: this.resourceCache.size,
    }
  }

  /**
   * Clear the resource cache
   */
  clearCache(): void {
    this.resourceCache.clear()
    console.error('Resource cache cleared')
  }

  /**
   * Get a list of active server names
   */
  getServerNames(): string[] {
    return Array.from(this.servers.keys())
  }

  /**
   * Get a list of active client aliases
   */
  getClientAliases(): string[] {
    return Array.from(this.clients.keys())
  }

  /**
   * Get resources for a specific client
   */
  async getClientResources(alias: string): Promise<any[]> {
    const client = this.clients.get(alias)
    if (!client) {
      throw new Error(`Client '${alias}' not found`)
    }

    return await client.listResources()
  }

  /**
   * Get tools for a specific client
   */
  async getClientTools(alias: string): Promise<any[]> {
    const client = this.clients.get(alias)
    if (!client) {
      throw new Error(`Client '${alias}' not found`)
    }

    // MCPClient doesn't have listTools yet, return empty array for now
    // TODO: Implement listTools in MCPClient
    return []
  }
}

// Singleton instance
let serviceInstance: DuckDBMcpNativeService | null = null

/**
 * Get or create the singleton service instance
 */
export function getDuckDBMcpNativeService(): DuckDBMcpNativeService {
  if (!serviceInstance) {
    serviceInstance = new DuckDBMcpNativeService()
  }
  return serviceInstance
}

/**
 * Create a new service instance (non-singleton)
 */
export function createDuckDBMcpNativeService(): DuckDBMcpNativeService {
  return new DuckDBMcpNativeService()
}
