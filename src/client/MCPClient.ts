import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  ListResourcesResultSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { URL } from 'url'
import { DuckDBService } from '../duckdb/service.js'

/**
 * Configuration for MCP Client
 */
export interface MCPClientConfig {
  name?: string
  version?: string
  cacheEnabled?: boolean
  cacheTTL?: number // seconds
  maxRetries?: number
}

/**
 * Represents an attached MCP server
 */
export interface AttachedServer {
  alias: string
  url: string
  transport: 'stdio' | 'http' | 'websocket'
  client: Client
  resources?: z.infer<typeof ListResourcesResultSchema>['resources']
  tools?: z.infer<typeof ListToolsResultSchema>['tools']
  lastRefresh?: Date
}

/**
 * MCP Client for connecting to external MCP servers
 * and creating virtual tables in DuckDB
 */
export class MCPClient {
  private config: Required<MCPClientConfig>
  private attachedServers = new Map<string, AttachedServer>()
  private resourceCache = new Map<string, { data: any; timestamp: number }>()
  private duckdb: DuckDBService | null = null

  constructor(config: MCPClientConfig = {}) {
    this.config = {
      name: config.name || 'duckdb-mcp-client',
      version: config.version || '1.0.0',
      cacheEnabled: config.cacheEnabled ?? true,
      cacheTTL: config.cacheTTL ?? 300, // 5 minutes default
      maxRetries: config.maxRetries ?? 3,
    }
  }

  /**
   * Set DuckDB service for virtual table creation
   */
  setDuckDBService(duckdb: DuckDBService): void {
    this.duckdb = duckdb
  }

  /**
   * Attach an external MCP server
   */
  async attachServer(
    url: string,
    alias: string,
    transport: 'stdio' | 'http' | 'websocket' = 'stdio'
  ): Promise<void> {
    if (this.attachedServers.has(alias)) {
      throw new Error(`Server with alias '${alias}' is already attached`)
    }

    const client = new Client(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {},
      }
    )

    try {
      let clientTransport: any

      switch (transport) {
        case 'stdio': {
          // Parse stdio URL format: stdio://command?args=arg1,arg2 or stdio:///path/to/command?args=arg1,arg2
          const urlParts = new URL(url)

          // If hostname exists (e.g., stdio://python), use it
          // If hostname is empty (e.g., stdio:///usr/bin/python), use pathname
          let command: string
          if (urlParts.hostname) {
            command = urlParts.hostname
          } else {
            // Remove the leading slash for absolute paths
            command = urlParts.pathname.startsWith('/')
              ? urlParts.pathname
              : urlParts.pathname.slice(1)
          }

          const args = urlParts.searchParams.get('args')?.split(',') || []

          clientTransport = new StdioClientTransport({
            command,
            args,
            env: process.env as Record<string, string>,
          })
          break
        }

        case 'http':
          // TODO: Implement HTTP transport
          throw new Error('HTTP transport not yet implemented')

        case 'websocket':
          // TODO: Implement WebSocket transport
          throw new Error('WebSocket transport not yet implemented')

        default:
          throw new Error(`Unsupported transport: ${transport}`)
      }

      await client.connect(clientTransport)

      // Get server capabilities
      const [resources, tools] = await Promise.all([
        client.listResources().catch(() => ({ resources: [] })),
        client.listTools().catch(() => ({ tools: [] })),
      ])

      this.attachedServers.set(alias, {
        alias,
        url,
        transport,
        client,
        resources: resources.resources,
        tools: tools.tools,
        lastRefresh: new Date(),
      })

      console.info(
        `✅ Attached MCP server '${alias}' with ${resources.resources.length} resources and ${tools.tools.length} tools`
      )
    } catch (error) {
      await client.close().catch(() => {})
      throw new Error(`Failed to attach server '${alias}': ${error}`)
    }
  }

  /**
   * Detach a server
   */
  async detachServer(alias: string): Promise<void> {
    const server = this.attachedServers.get(alias)
    if (!server) {
      throw new Error(`No server attached with alias '${alias}'`)
    }

    await server.client.close()
    this.attachedServers.delete(alias)

    // Clear cache for this server's resources
    for (const [key] of this.resourceCache) {
      if (key.startsWith(`${alias}:`)) {
        this.resourceCache.delete(key)
      }
    }

    console.info(`✅ Detached MCP server '${alias}'`)
  }

  /**
   * List all attached servers
   */
  listAttachedServers(): AttachedServer[] {
    return Array.from(this.attachedServers.values())
  }

  /**
   * Get a specific attached server
   */
  getAttachedServer(alias: string): AttachedServer | undefined {
    return this.attachedServers.get(alias)
  }

  /**
   * List resources from a specific server or all servers
   */
  async listResources(serverAlias?: string): Promise<any[]> {
    const servers = serverAlias
      ? [this.attachedServers.get(serverAlias)].filter(Boolean)
      : Array.from(this.attachedServers.values())

    if (servers.length === 0) {
      throw new Error(serverAlias ? `Server '${serverAlias}' not found` : 'No servers attached')
    }

    const allResources: any[] = []

    for (const server of servers) {
      if (!server) continue
      try {
        const result = await server.client.listResources()
        const resourcesWithServer = result.resources.map((resource) => ({
          ...resource,
          serverAlias: server.alias,
          fullUri: `mcp://${server.alias}/${resource.uri}`,
        }))
        allResources.push(...resourcesWithServer)
      } catch (error) {
        console.error(`Failed to list resources from '${server.alias}':`, error)
      }
    }

    return allResources
  }

  /**
   * Read a resource from a server
   */
  async readResource(uri: string, serverAlias?: string, useCache = true): Promise<any> {
    // Parse URI format: mcp://server/resource or just resource
    let targetServer: AttachedServer | undefined
    let resourceUri: string

    if (uri.startsWith('mcp://')) {
      const match = uri.match(/^mcp:\/\/([^/]+)\/(.+)$/)
      if (!match) {
        throw new Error(`Invalid MCP URI format: ${uri}`)
      }
      const [, alias, path] = match
      targetServer = this.attachedServers.get(alias)
      resourceUri = path
    } else {
      if (!serverAlias) {
        throw new Error('Server alias required for relative URI')
      }
      targetServer = this.attachedServers.get(serverAlias)
      resourceUri = uri
    }

    if (!targetServer) {
      throw new Error(`Server not found for URI: ${uri}`)
    }

    // Check cache
    const cacheKey = `${targetServer.alias}:${resourceUri}`
    if (useCache && this.config.cacheEnabled) {
      const cached = this.resourceCache.get(cacheKey)
      if (cached) {
        const age = (Date.now() - cached.timestamp) / 1000
        if (age < this.config.cacheTTL) {
          console.info(`📦 Using cached resource: ${cacheKey}`)
          return cached.data
        }
      }
    }

    // Read from server
    try {
      const result = await targetServer.client.readResource({ uri: resourceUri })
      const content = result.contents[0]

      let data: any = null

      if (content?.text && typeof content.text === 'string') {
        // Check MIME type or try to detect content type
        const mimeType = content.mimeType || ''

        if (mimeType.includes('json') || mimeType === '') {
          // Try to parse as JSON, fallback to raw text
          try {
            data = JSON.parse(content.text)
          } catch {
            // If it's not JSON, return as raw text (CSV, TSV, etc.)
            data = content.text
          }
        } else if (mimeType.includes('csv') || mimeType.includes('text')) {
          // Return raw text for CSV, text files
          data = content.text
        } else {
          // For other types, return raw text
          data = content.text
        }
      }

      // Update cache
      if (this.config.cacheEnabled) {
        this.resourceCache.set(cacheKey, {
          data,
          timestamp: Date.now(),
        })
      }

      return data
    } catch (error) {
      throw new Error(`Failed to read resource '${uri}': ${error}`)
    }
  }

  /**
   * Create a virtual table in DuckDB from an MCP resource
   */
  async createVirtualTable(
    tableName: string,
    resourceUri: string,
    serverAlias?: string
  ): Promise<void> {
    if (!this.duckdb) {
      throw new Error('DuckDB service not set. Call setDuckDBService() first')
    }

    // Read resource data
    const data = await this.readResource(resourceUri, serverAlias)

    if (!data || !Array.isArray(data)) {
      throw new Error(`Resource '${resourceUri}' does not contain valid table data`)
    }

    if (data.length === 0) {
      throw new Error(`Resource '${resourceUri}' contains no data`)
    }

    // Create table from JSON data
    await this.duckdb.createTableFromJSON(tableName, data)

    console.info(
      `✅ Created virtual table '${tableName}' from resource '${resourceUri}' with ${data.length} rows`
    )
  }

  /**
   * Refresh a virtual table by re-reading the resource
   */
  async refreshVirtualTable(
    tableName: string,
    resourceUri: string,
    serverAlias?: string
  ): Promise<void> {
    // Invalidate cache
    const cacheKey = serverAlias ? `${serverAlias}:${resourceUri}` : resourceUri
    this.resourceCache.delete(cacheKey)

    // Recreate table
    await this.createVirtualTable(tableName, resourceUri, serverAlias)

    console.info(`🔄 Refreshed virtual table '${tableName}'`)
  }

  /**
   * Execute a tool on an attached server
   */
  async callTool(serverAlias: string, toolName: string, args: any): Promise<any> {
    const server = this.attachedServers.get(serverAlias)
    if (!server) {
      throw new Error(`Server '${serverAlias}' not found`)
    }

    try {
      const result = await server.client.callTool({
        name: toolName,
        arguments: args,
      })
      return result
    } catch (error) {
      throw new Error(`Failed to call tool '${toolName}' on server '${serverAlias}': ${error}`)
    }
  }

  /**
   * Clear resource cache
   */
  clearCache(serverAlias?: string): void {
    if (serverAlias) {
      // Clear cache for specific server
      for (const [key] of this.resourceCache) {
        if (key.startsWith(`${serverAlias}:`)) {
          this.resourceCache.delete(key)
        }
      }
    } else {
      // Clear all cache
      this.resourceCache.clear()
    }

    console.info(
      `🧹 Cleared cache ${serverAlias ? `for server '${serverAlias}'` : 'for all servers'}`
    )
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll(): Promise<void> {
    const aliases = Array.from(this.attachedServers.keys())

    for (const alias of aliases) {
      await this.detachServer(alias)
    }

    this.resourceCache.clear()
  }
}
