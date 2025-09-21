/**
 * Cache Manager for Virtual Filesystem
 * Manages local caching of MCP resources for efficient access
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { createHash } from 'crypto'
import { logger } from '../utils/logger.js'
import { getMetricsCollector } from '../monitoring/MetricsCollector.js'

/**
 * Cached resource metadata
 */
export interface CachedResource {
  uri: string
  localPath: string
  format: 'csv' | 'json' | 'parquet' | 'arrow' | 'excel' | 'unknown'
  size: number
  cachedAt: Date
  expiresAt: Date
  hits: number
  metadata?: Record<string, any>
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  cacheDir?: string
  defaultTTL?: number // milliseconds
  maxSize?: number // bytes
  maxItems?: number
  cleanupInterval?: number // milliseconds
}

/**
 * Manages local caching of MCP resources
 */
export class CacheManager {
  private cache = new Map<string, CachedResource>()
  private cacheDir: string
  private config: Required<CacheConfig>
  private currentSize = 0
  private cleanupTimer?: ReturnType<typeof setInterval>

  constructor(config: CacheConfig = {}) {
    this.config = {
      cacheDir: config.cacheDir || path.join(os.tmpdir(), 'duckdb-mcp-cache'),
      defaultTTL: config.defaultTTL || 300000, // 5 minutes
      maxSize: config.maxSize || 1073741824, // 1GB
      maxItems: config.maxItems || 1000,
      cleanupInterval: config.cleanupInterval || 60000, // 1 minute
    }

    this.cacheDir = this.config.cacheDir
  }

  /**
   * Initialize the cache manager
   */
  async initialize(): Promise<void> {
    // Create cache directory if it doesn't exist
    await fs.mkdir(this.cacheDir, { recursive: true })

    // Load existing cache metadata if available
    await this.loadCacheMetadata()

    // Start periodic cleanup
    this.startCleanupTimer()

    // logger.debug(`Cache initialized at ${this.cacheDir}`) // Disabled to avoid STDIO interference
  }

  /**
   * Get cached resource path if available
   * @param uri The MCP URI
   * @returns Local file path if cached and valid, null otherwise
   */
  async getCachedPath(uri: string): Promise<string | null> {
    const cached = this.cache.get(uri)

    if (!cached) {
      // Record cache miss
      const metricsCollector = getMetricsCollector()
      metricsCollector.recordCacheAccess(false, this.cache.size)
      return null
    }

    // Check if expired
    if (new Date() > cached.expiresAt) {
      await this.evictResource(uri)
      // Record cache miss (expired)
      const metricsCollector = getMetricsCollector()
      metricsCollector.recordCacheAccess(false, this.cache.size)
      return null
    }

    // Check if file still exists
    try {
      await fs.access(cached.localPath)
    } catch {
      // File doesn't exist, remove from cache
      this.cache.delete(uri)
      // Record cache miss (file not found)
      const metricsCollector = getMetricsCollector()
      metricsCollector.recordCacheAccess(false, this.cache.size)
      return null
    }

    // Update hit count
    cached.hits++

    // Record cache hit
    const metricsCollector = getMetricsCollector()
    metricsCollector.recordCacheAccess(true, this.cache.size)

    logger.debug(`📋 Cache hit for ${uri} (${cached.hits} hits)`)
    return cached.localPath
  }

  /**
   * Cache a resource
   * @param uri The MCP URI
   * @param data The resource data
   * @param format The data format
   * @param ttl Optional TTL in milliseconds
   * @returns Local file path where cached
   */
  async cacheResource(
    uri: string,
    data: Buffer | string | any[],
    format: CachedResource['format'],
    ttl?: number
  ): Promise<string> {
    // Generate cache filename
    const hash = createHash('sha256').update(uri).digest('hex')
    const extension = this.getExtensionForFormat(format)
    const filename = `${hash}.${extension}`
    const localPath = path.join(this.cacheDir, filename)

    // Convert data to Buffer if needed
    let buffer: Buffer
    if (Buffer.isBuffer(data)) {
      buffer = data
    } else if (typeof data === 'string') {
      buffer = Buffer.from(data)
    } else if (Array.isArray(data)) {
      buffer = Buffer.from(JSON.stringify(data))
    } else if (typeof data === 'object') {
      buffer = Buffer.from(JSON.stringify(data))
    } else {
      throw new Error(`Unsupported data type for caching: ${typeof data}`)
    }

    // Check if we need to evict items for space
    const size = buffer.length
    await this.ensureSpace(size)

    // Write to disk
    await fs.writeFile(localPath, buffer)

    // Create cache entry
    const cachedResource: CachedResource = {
      uri,
      localPath,
      format,
      size,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + (ttl || this.config.defaultTTL)),
      hits: 0,
    }

    // Update cache
    this.cache.set(uri, cachedResource)
    this.currentSize += size

    logger.info(`💾 Cached ${uri} → ${localPath} (${this.formatSize(size)})`)

    // Save metadata
    await this.saveCacheMetadata()

    return localPath
  }

  /**
   * Cache a file that's already on disk
   * @param uri The MCP URI
   * @param filePath Path to existing file
   * @param format The data format
   * @param ttl Optional TTL in milliseconds
   * @returns Local cache path
   */
  async cacheFile(
    uri: string,
    filePath: string,
    format: CachedResource['format'],
    ttl?: number
  ): Promise<string> {
    // Get file stats
    const stats = await fs.stat(filePath)
    const size = stats.size

    // Check space
    await this.ensureSpace(size)

    // Generate cache filename
    const hash = createHash('sha256').update(uri).digest('hex')
    const extension = this.getExtensionForFormat(format)
    const filename = `${hash}.${extension}`
    const localPath = path.join(this.cacheDir, filename)

    // Copy file to cache
    await fs.copyFile(filePath, localPath)

    // Create cache entry
    const cachedResource: CachedResource = {
      uri,
      localPath,
      format,
      size,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + (ttl || this.config.defaultTTL)),
      hits: 0,
    }

    // Update cache
    this.cache.set(uri, cachedResource)
    this.currentSize += size

    logger.info(`💾 Cached file ${uri} → ${localPath} (${this.formatSize(size)})`)

    // Save metadata
    await this.saveCacheMetadata()

    return localPath
  }

  /**
   * Evict a resource from cache
   */
  async evictResource(uri: string): Promise<void> {
    const cached = this.cache.get(uri)
    if (!cached) return

    try {
      await fs.unlink(cached.localPath)
    } catch {
      // File might already be deleted
    }

    this.currentSize -= cached.size
    this.cache.delete(uri)

    logger.debug(`🗑️ Evicted ${uri} from cache`)
  }

  /**
   * Clear all cached resources
   */
  async clearCache(): Promise<void> {
    // Delete all cached files
    for (const [, cached] of this.cache) {
      try {
        await fs.unlink(cached.localPath)
      } catch {
        // Ignore errors
      }
    }

    // Clear memory
    this.cache.clear()
    this.currentSize = 0

    logger.info('🧹 Cache cleared')

    // Save empty metadata
    await this.saveCacheMetadata()
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    itemCount: number
    totalSize: number
    maxSize: number
    hitRate: number
    oldestItem?: Date
    newestItem?: Date
  } {
    let totalHits = 0
    let totalRequests = 0
    let oldest: Date | undefined
    let newest: Date | undefined

    for (const cached of this.cache.values()) {
      totalHits += cached.hits
      totalRequests += cached.hits + 1

      if (!oldest || cached.cachedAt < oldest) {
        oldest = cached.cachedAt
      }
      if (!newest || cached.cachedAt > newest) {
        newest = cached.cachedAt
      }
    }

    return {
      itemCount: this.cache.size,
      totalSize: this.currentSize,
      maxSize: this.config.maxSize,
      hitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
      oldestItem: oldest,
      newestItem: newest,
    }
  }

  /**
   * Ensure there's enough space for new item
   */
  private async ensureSpace(requiredSize: number): Promise<void> {
    // Check item count limit
    if (this.cache.size >= this.config.maxItems) {
      await this.evictLRU()
    }

    // Check size limit
    while (this.currentSize + requiredSize > this.config.maxSize && this.cache.size > 0) {
      await this.evictLRU()
    }
  }

  /**
   * Evict least recently used item
   */
  private async evictLRU(): Promise<void> {
    let lruUri: string | null = null
    let lruHits = Infinity

    // Find item with least hits
    for (const [uri, cached] of this.cache) {
      if (cached.hits < lruHits) {
        lruHits = cached.hits
        lruUri = uri
      }
    }

    if (lruUri) {
      await this.evictResource(lruUri)
    }
  }

  /**
   * Clean up expired items
   */
  private async cleanup(): Promise<void> {
    const now = new Date()
    const toEvict: string[] = []

    for (const [uri, cached] of this.cache) {
      if (now > cached.expiresAt) {
        toEvict.push(uri)
      }
    }

    for (const uri of toEvict) {
      await this.evictResource(uri)
    }

    if (toEvict.length > 0) {
      logger.debug(`🧹 Cleaned up ${toEvict.length} expired cache items`)
    }
  }

  /**
   * Start periodic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((error) => logger.error('Cache cleanup error:', error))
    }, this.config.cleanupInterval)
  }

  /**
   * Save cache metadata to disk
   */
  private async saveCacheMetadata(): Promise<void> {
    const metadataPath = path.join(this.cacheDir, '.cache-metadata.json')

    const metadata = {
      version: 1,
      items: Array.from(this.cache.entries()).map(([uri, cached]) => ({
        uri,
        localPath: cached.localPath,
        format: cached.format,
        size: cached.size,
        cachedAt: cached.cachedAt.toISOString(),
        expiresAt: cached.expiresAt.toISOString(),
        hits: cached.hits,
        metadata: cached.metadata,
      })),
    }

    try {
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2))
    } catch (error) {
      logger.warn('Failed to save cache metadata:', error)
    }
  }

  /**
   * Load cache metadata from disk
   */
  private async loadCacheMetadata(): Promise<void> {
    const metadataPath = path.join(this.cacheDir, '.cache-metadata.json')

    try {
      const content = await fs.readFile(metadataPath, 'utf-8')
      const metadata = JSON.parse(content)

      if (metadata.version !== 1) {
        logger.warn('Unsupported cache metadata version, skipping')
        return
      }

      for (const item of metadata.items) {
        // Check if file still exists
        try {
          await fs.access(item.localPath)
        } catch {
          continue
        }

        const cached: CachedResource = {
          uri: item.uri,
          localPath: item.localPath,
          format: item.format,
          size: item.size,
          cachedAt: new Date(item.cachedAt),
          expiresAt: new Date(item.expiresAt),
          hits: item.hits,
          metadata: item.metadata,
        }

        this.cache.set(item.uri, cached)
        this.currentSize += item.size
      }

      logger.info(`📋 Loaded ${this.cache.size} cached items`)
    } catch {
      // No metadata file or invalid, start fresh
    }
  }

  /**
   * Get file extension for format
   */
  private getExtensionForFormat(format: CachedResource['format']): string {
    switch (format) {
      case 'csv':
        return 'csv'
      case 'json':
        return 'json'
      case 'parquet':
        return 'parquet'
      case 'arrow':
        return 'arrow'
      case 'excel':
        return 'xlsx'
      default:
        return 'data'
    }
  }

  /**
   * Format size for display
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB`
    return `${(bytes / 1073741824).toFixed(2)}GB`
  }

  /**
   * Destroy the cache manager
   */
  async destroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }

    await this.saveCacheMetadata()
    // logger.debug('Cache manager destroyed') // Disabled to avoid STDIO interference
  }
}
