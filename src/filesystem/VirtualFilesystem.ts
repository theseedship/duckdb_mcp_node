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
  connectionPatterns?: string[]
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
/**
 * Statistics for Virtual Filesystem
 */
export interface VFSStats {
  totalResolutions: number
  cacheHits: number
  cacheMisses: number
  cacheHitRate: number
  errors: number
  discoveredResources?: number
}

export class VirtualFilesystem {
  private cache: CacheManager
  private connectionPool: MCPConnectionPool
  private resourceRegistry: ResourceRegistry
  private connectedServers = new Set<string>()
  private config: VirtualFilesystemConfig

  // Request deduplication: track pending resolution promises
  private pendingResolutions = new Map<string, Promise<ResourceResolution | null>>()

  // Statistics tracking
  private stats = {
    totalResolutions: 0,
    cacheHits: 0,
    cacheMisses: 0,
    errors: 0,
    discoveredResources: 0,
  }

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
    // First, expand glob patterns to UNION queries
    const uris = URIParser.extractFromSQL(sql)
    let processedQuery = sql

    for (const uri of uris) {
      const parsed = URIParser.parse(uri)

      if (parsed.isGlob) {
        // Expand glob to matching URIs
        const availableResources = this.resourceRegistry
          .getAllResources()
          .map((r) => ({ server: r.serverAlias, path: r.uri }))
        const matchingURIs = URIParser.expandGlob(uri, availableResources)

        if (matchingURIs.length === 0) {
          throw new Error(`No resources match glob pattern: ${uri}`)
        }

        // Resolve all matching URIs to local paths
        const resolvedPaths = await Promise.all(
          matchingURIs.map(async (matchedUri) => {
            const resolution = await this.resolveURI(matchedUri)
            return resolution?.localPath
          })
        )

        // Filter out null results
        const validPaths = resolvedPaths.filter((path): path is string => path !== null)

        if (validPaths.length === 0) {
          throw new Error(`Could not resolve any resources matching: ${uri}`)
        }

        // Build read queries for each file
        const readQueries = validPaths.map((path) => {
          const format = FormatDetector.fromExtension(path)
          return FormatDetector.buildReadQuery(path, format)
        })

        // Create UNION query if multiple files, otherwise use single query
        const replacement =
          readQueries.length === 1 ? readQueries[0] : `(${readQueries.join(' UNION ALL ')})`

        // Replace the glob URI with the expanded query
        // Use the replaceURI method from QueryPreprocessor
        processedQuery = processedQuery.replace(
          new RegExp(`['"\`]${uri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'g'),
          replacement
        )
      }
    }

    // Then transform non-glob URIs
    const result = await QueryPreprocessor.transform(processedQuery, async (uri) => {
      const resolution = await this.resolveURI(uri)
      // If this is an mcp:// URI and we couldn't resolve it, throw an error
      if (!resolution && uri.startsWith('mcp://')) {
        throw new Error(`Resource not found: ${uri}`)
      }
      return resolution?.localPath || null
    })

    return result.transformedQuery
  }

  /**
   * Resolve an MCP URI to a local path
   * @param uri The MCP URI to resolve
   * @returns Resolution result with local path
   */
  async resolveURI(uri: string): Promise<ResourceResolution | null> {
    // Check if there's already a pending resolution for this URI (deduplication)
    const pending = this.pendingResolutions.get(uri)
    if (pending) {
      return pending
    }

    // Create the resolution promise
    const resolutionPromise = this.doResolveURI(uri)

    // Store it in pending resolutions
    this.pendingResolutions.set(uri, resolutionPromise)

    // Clean up when done (success or failure)
    resolutionPromise.finally(() => {
      this.pendingResolutions.delete(uri)
    })

    return resolutionPromise
  }

  private async doResolveURI(uri: string): Promise<ResourceResolution | null> {
    this.stats.totalResolutions++

    try {
      const parsed = URIParser.parse(uri)

      // Check cache first
      const cachedPath = await this.cache.getCachedPath(uri)
      if (cachedPath) {
        this.stats.cacheHits++
        return {
          uri,
          localPath: cachedPath,
          format: parsed.format || 'unknown',
          cached: true,
          server: parsed.server,
        }
      }

      this.stats.cacheMisses++

      // Auto-connect to server if needed
      if (this.config.autoConnect && !this.connectedServers.has(parsed.server)) {
        await this.connectToServer(parsed.server)
      }

      // Fetch the resource
      const resource = await this.fetchResource(parsed)
      if (!resource) {
        logger.warn(`Failed to fetch resource: ${uri}`)
        this.stats.errors++
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
      this.stats.errors++
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

      // Handle MCP SDK response format
      if (resourceData && typeof resourceData === 'object' && 'contents' in resourceData) {
        const contents = resourceData.contents as any[]
        if (contents && contents.length > 0) {
          const content = contents[0]
          if (content.text !== undefined) {
            return content.text
          } else if (content.blob !== undefined) {
            // Base64 encoded binary data
            try {
              // Validate base64 format
              if (typeof content.blob !== 'string') {
                logger.warn('Blob content is not a string')
                return null
              }
              // Basic base64 validation: only valid base64 characters
              if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content.blob)) {
                logger.warn('Invalid base64 format')
                return null
              }
              const buffer = Buffer.from(content.blob, 'base64')
              // Additional validation: check if buffer is reasonable size
              if (buffer.length === 0 && content.blob.length > 0) {
                logger.warn('Base64 decoded to empty buffer')
                return null
              }
              return buffer
            } catch {
              logger.warn('Failed to decode base64 content')
              return null
            }
          }
        }
      }

      // Fallback for other formats
      if (typeof resourceData === 'string') {
        return resourceData
      } else if (Buffer.isBuffer(resourceData)) {
        return resourceData
      } else if (Array.isArray(resourceData)) {
        return JSON.stringify(resourceData)
      } else if (resourceData && typeof resourceData === 'object') {
        // Handle other response formats
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
   * Get connection patterns from configuration or environment
   */
  private getConnectionPatterns(serverName: string): string[] {
    // Use configured patterns if available
    if (this.config.connectionPatterns && this.config.connectionPatterns.length > 0) {
      return this.config.connectionPatterns.map((pattern) =>
        pattern.replace('{serverName}', serverName)
      )
    }

    // Use patterns from environment variables if available
    if (process.env.MCP_CONNECTION_PATTERNS) {
      const patterns = process.env.MCP_CONNECTION_PATTERNS.split(',').map((p) => p.trim())
      return patterns.map((pattern) => pattern.replace('{serverName}', serverName))
    }

    // Default patterns (only stdio for security)
    return [
      `stdio://${serverName}`,
      // Only add network patterns if explicitly enabled
      ...(process.env.MCP_ALLOW_NETWORK === 'true'
        ? [
            `ws://${process.env.MCP_WS_HOST || 'localhost'}:${process.env.MCP_WS_PORT || '3001'}/${serverName}`,
            `http://${process.env.MCP_HTTP_HOST || 'localhost'}:${process.env.MCP_HTTP_PORT || '3000'}/${serverName}`,
          ]
        : []),
    ]
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

      // Get connection patterns from configuration
      const connectionPatterns = this.getConnectionPatterns(serverName)

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

        // Count discovered resources
        const resources = this.resourceRegistry.getAllResources()
        this.stats.discoveredResources = resources.length
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
   * Resolve multiple URIs efficiently
   * @param uris Array of MCP URIs to resolve
   * @returns Array of resolution results (null for failures)
   */
  async resolveMultiple(uris: string[]): Promise<Array<ResourceResolution | null>> {
    // Resolve all URIs in parallel
    const resolutions = await Promise.all(uris.map((uri) => this.resolveURI(uri).catch(() => null)))
    return resolutions
  }

  /**
   * Get VFS statistics
   * @returns Statistics object
   */
  getStats(): VFSStats {
    const { totalResolutions, cacheHits, cacheMisses, errors, discoveredResources } = this.stats
    const cacheHitRate = totalResolutions > 0 ? cacheHits / (cacheHits + cacheMisses) : 0

    return {
      totalResolutions,
      cacheHits,
      cacheMisses,
      cacheHitRate,
      errors,
      discoveredResources: discoveredResources > 0 ? discoveredResources : undefined,
    }
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
