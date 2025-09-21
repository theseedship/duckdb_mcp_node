/**
 * Virtual Filesystem for MCP Resources
 * Main orchestrator for handling mcp:// URIs in SQL queries
 */

import { MCPConnectionPool } from '../federation/ConnectionPool.js'
import { ResourceRegistry } from '../federation/ResourceRegistry.js'
import { URIParser, ParsedURI } from './URIParser.js'
import { CacheManager } from './CacheManager.js'
import { FormatDetector, DataFormat } from './FormatDetector.js'
import { QueryPreprocessor } from './QueryPreprocessor.js'
import { logger } from '../utils/logger.js'

/**
 * Configuration for Virtual Filesystem
 */
export interface VirtualFilesystemConfig {
  cacheConfig?: {
    cacheDir?: string
    defaultTTL?: number
    maxSize?: number
    maxItems?: number
  }
  connectionPoolConfig?: {
    maxConnections?: number
    connectionTTL?: number
    idleTimeout?: number
  }
  autoConnect?: boolean
  autoDiscovery?: boolean
}

/**
 * Resource resolution result
 */
export interface ResourceResolution {
  uri: string
  localPath: string
  format: DataFormat
  cached: boolean
  server?: string
}

/**
 * Virtual Filesystem for transparent MCP resource access
 */
export class VirtualFilesystem {
  private cache: CacheManager
  private connectionPool: MCPConnectionPool
  private resourceRegistry: ResourceRegistry
  private connectedServers = new Set<string>()
  private config: VirtualFilesystemConfig

  constructor(
    resourceRegistry: ResourceRegistry,
    connectionPool?: MCPConnectionPool,
    config: VirtualFilesystemConfig = {}
  ) {
    this.resourceRegistry = resourceRegistry
    this.connectionPool = connectionPool || new MCPConnectionPool()
    this.cache = new CacheManager(config.cacheConfig)
    this.config = config
  }

  /**
   * Initialize the virtual filesystem
   */
  async initialize(): Promise<void> {
    await this.cache.initialize()

    if (this.config.autoDiscovery) {
      await this.discoverServers()
    }

    // logger.debug('Virtual Filesystem initialized') // Disabled to avoid STDIO interference
  }

  /**
   * Process a SQL query with mcp:// URIs
   * @param sql The original SQL query
   * @returns Transformed query with local paths
   */
  async processQuery(sql: string): Promise<string> {
    // Transform the query
    const result = await QueryPreprocessor.transform(sql, async (uri) => {
      const resolution = await this.resolveURI(uri)
      // If this is an mcp:// URI and we couldn't resolve it, throw an error
      if (!resolution && uri.startsWith('mcp://')) {
        throw new Error(`Resource not found: ${uri}`)
      }
      return resolution?.localPath || null
    })

    // Resolve any URIs that need resolution
    for (const uri of result.urisToResolve) {
      const resolution = await this.resolveURI(uri)
      // If this is an mcp:// URI and we couldn't resolve it, throw an error
      if (!resolution && uri.startsWith('mcp://')) {
        throw new Error(`Resource not found: ${uri}`)
      }
    }

    // Apply all replacements
    if (result.replacements.length > 0) {
      // Re-transform with all URIs now resolved
      const finalResult = await QueryPreprocessor.transform(result.originalQuery, async (uri) => {
        const resolution = await this.resolveURI(uri)
        // If this is an mcp:// URI and we couldn't resolve it, throw an error
        if (!resolution && uri.startsWith('mcp://')) {
          throw new Error(`Resource not found: ${uri}`)
        }
        return resolution?.localPath || null
      })

      return finalResult.transformedQuery
    }

    return result.transformedQuery
  }

  /**
   * Resolve an MCP URI to a local path
   * @param uri The MCP URI to resolve
   * @returns Resolution result with local path
   */
  async resolveURI(uri: string): Promise<ResourceResolution | null> {
    try {
      const parsed = URIParser.parse(uri)

      // Check cache first
      const cachedPath = await this.cache.getCachedPath(uri)
      if (cachedPath) {
        return {
          uri,
          localPath: cachedPath,
          format: parsed.format || 'unknown',
          cached: true,
          server: parsed.server,
        }
      }

      // Auto-connect to server if needed
      if (this.config.autoConnect && !this.connectedServers.has(parsed.server)) {
        await this.connectToServer(parsed.server)
      }

      // Fetch the resource
      const resource = await this.fetchResource(parsed)
      if (!resource) {
        logger.warn(`Failed to fetch resource: ${uri}`)
        return null
      }

      // Detect format
      const format = this.detectFormat(parsed, resource)

      // Cache the resource - only cache known formats
      const cacheFormat = format === 'text' || format === 'binary' ? 'unknown' : format
      const localPath = await this.cache.cacheResource(uri, resource, cacheFormat)

      return {
        uri,
        localPath,
        format,
        cached: false,
        server: parsed.server,
      }
    } catch (error) {
      logger.debug(`Failed to resolve URI ${uri}:`, error)
      return null
    }
  }

  /**
   * Fetch a resource from an MCP server
   * @param parsed The parsed URI
   * @returns Resource data
   */
  private async fetchResource(parsed: ParsedURI): Promise<Buffer | string | any[] | null> {
    // Check if resource is registered
    const registered = this.resourceRegistry.resolve(
      URIParser.build({
        server: parsed.server,
        path: parsed.path,
      })
    )

    if (!registered) {
      logger.warn(`Resource not found in registry: ${parsed.server}${parsed.path}`)
      return null
    }

    try {
      // Get client for server
      const client = await this.connectionPool.getClient(`mcp://${parsed.server}`, 'auto')

      // Read the resource - pass as object with uri property
      const resourceData = await client.readResource({ uri: registered.resource.uri })

      // Convert to appropriate format
      if (typeof resourceData === 'string') {
        return resourceData
      } else if (Buffer.isBuffer(resourceData)) {
        return resourceData
      } else if (Array.isArray(resourceData)) {
        return JSON.stringify(resourceData)
      } else if (resourceData && typeof resourceData === 'object') {
        // Handle different response formats
        if ('content' in resourceData && typeof resourceData.content === 'string') {
          return resourceData.content as string
        } else if ('data' in resourceData) {
          const data = resourceData.data
          if (typeof data === 'string' || Buffer.isBuffer(data) || Array.isArray(data)) {
            return data
          }
          return JSON.stringify(data)
        } else {
          return JSON.stringify(resourceData)
        }
      }

      return null
    } catch (error) {
      logger.debug(`Failed to fetch resource from ${parsed.server}:`, error)
      return null
    }
  }

  /**
   * Detect format from parsed URI and content
   */
  private detectFormat(parsed: ParsedURI, content: Buffer | string | any[]): DataFormat {
    // Try from extension first
    if (parsed.format && parsed.format !== 'unknown') {
      return parsed.format
    }

    // Try from content
    const buffer = Buffer.isBuffer(content)
      ? content
      : typeof content === 'string'
        ? Buffer.from(content)
        : Buffer.from(JSON.stringify(content))

    const detected = FormatDetector.detect({
      filename: parsed.filename,
      content: buffer.slice(0, 1000), // Only check first 1KB
    })

    return detected.format
  }

  /**
   * Connect to an MCP server
   * @param serverName The server name
   */
  async connectToServer(serverName: string): Promise<void> {
    if (this.connectedServers.has(serverName)) {
      return
    }

    try {
      // logger.info(`🔗 Connecting to MCP server: ${serverName}`) // Disabled to avoid STDIO interference

      // Try common connection patterns
      const connectionPatterns = [
        `stdio://${serverName}`,
        `http://localhost:3000/${serverName}`,
        `ws://localhost:3001/${serverName}`,
        `tcp://localhost:9999`,
      ]

      let connected = false
      for (const pattern of connectionPatterns) {
        try {
          const client = await this.connectionPool.getClient(pattern, 'auto')

          // List and register resources
          const resources = await client.listResources()
          this.resourceRegistry.register(serverName, resources.resources || [])

          this.connectedServers.add(serverName)
          connected = true
          // logger.info(`✅ Connected to ${serverName} via ${pattern}`) // Disabled to avoid STDIO interference
          break
        } catch {
          // Try next pattern
          continue
        }
      }

      if (!connected) {
        throw new Error(`Failed to connect to server: ${serverName}`)
      }
    } catch (error) {
      logger.debug(`Failed to connect to server ${serverName}:`, error)
      throw error
    }
  }

  /**
   * Discover available MCP servers
   */
  async discoverServers(): Promise<string[]> {
    const discovered: string[] = []

    // Try to discover servers from environment variables
    const envServers = Object.keys(process.env)
      .filter((key) => key.startsWith('MCP_SERVER_'))
      .map((key) => process.env[key])
      .filter((value): value is string => value !== undefined)

    for (const server of envServers) {
      try {
        await this.connectToServer(server)
        discovered.push(server)
      } catch {
        // Skip failed connections
      }
    }

    // logger.info(`🔍 Discovered ${discovered.length} MCP server(s)`) // Disabled to avoid STDIO interference
    return discovered
  }

  /**
   * List all available resources
   * @returns Array of available resource URIs
   */
  listAvailableResources(): string[] {
    const resources = this.resourceRegistry.getAllResources()
    return resources.map((r) => r.fullUri)
  }

  /**
   * Search for resources matching a pattern
   * @param pattern The search pattern (supports wildcards)
   * @returns Matching resource URIs
   */
  searchResources(pattern: string): string[] {
    const resources = this.resourceRegistry.search(pattern)
    return resources.map((r) => r.fullUri)
  }

  /**
   * Expand glob patterns to matching resources
   * @param globPattern The glob pattern with wildcards
   * @returns Array of matching URIs
   */
  expandGlob(globPattern: string): string[] {
    const resources = this.resourceRegistry.getAllResources()
    const availableResources = resources.map((r) => ({
      server: r.serverAlias,
      path: r.uri,
    }))

    return URIParser.expandGlob(globPattern, availableResources)
  }

  /**
   * Pre-cache a resource
   * @param uri The MCP URI to pre-cache
   * @returns True if cached successfully
   */
  async precacheResource(uri: string): Promise<boolean> {
    try {
      const resolution = await this.resolveURI(uri)
      return resolution !== null
    } catch {
      return false
    }
  }

  /**
   * Clear the cache
   */
  async clearCache(): Promise<void> {
    await this.cache.clearCache()
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats()
  }

  /**
   * Get connection pool statistics
   */
  getConnectionStats() {
    return this.connectionPool.getStats()
  }

  /**
   * Check if a URI is valid and available
   * @param uri The MCP URI to check
   * @returns True if valid and available
   */
  isAvailable(uri: string): boolean {
    try {
      const parsed = URIParser.parse(uri)
      const resolved = this.resourceRegistry.resolve(
        URIParser.build({
          server: parsed.server,
          path: parsed.path,
        })
      )
      return resolved !== null
    } catch {
      return false
    }
  }

  /**
   * Create a view with auto-refresh for real-time resources
   * @param viewName The view name
   * @param uri The MCP URI
   * @param refreshInterval Refresh interval in milliseconds
   */
  async createLiveView(
    viewName: string,
    uri: string,
    _refreshInterval: number = 60000
  ): Promise<void> {
    // This would integrate with DuckDB to create a view
    // that automatically refreshes from the MCP resource
    // logger.info(`📊 Creating live view '${viewName}' for ${uri} (refresh: ${refreshInterval}ms)`) // Disabled to avoid STDIO interference
    // Implementation would involve:
    // 1. Creating a DuckDB view
    // 2. Setting up a timer to refresh the cache
    // 3. Updating the view when cache updates
  }

  /**
   * Destroy the virtual filesystem
   */
  async destroy(): Promise<void> {
    await this.cache.destroy()
    await this.connectionPool.close()
    // logger.debug('Virtual Filesystem destroyed') // Disabled to avoid STDIO interference
  }
}
