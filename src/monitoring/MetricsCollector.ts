/**
 * Simple file-based metrics collector for DuckDB MCP
 *
 * Collects performance metrics and writes them to rotating JSON log files
 * without external dependencies like Prometheus or Grafana.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { logger } from '../utils/logger.js'

/**
 * Performance metrics as defined in the roadmap
 */
export interface PerformanceMetrics {
  queryTime: number // < 100ms for simple queries
  memoryUsage: number // < 4GB
  connectionPoolHitRate: number // > 80%
  cacheHitRate: number // > 60% for mcp://
  spaceIsolation: boolean // 100% (hidden feature)
}

/**
 * Query metric entry
 */
export interface QueryMetric {
  timestamp: string
  sql: string
  executionTimeMs: number
  rowCount: number
  isSimple: boolean // true if < 100ms
  spaceId?: string
}

/**
 * Memory metric entry
 */
export interface MemoryMetric {
  timestamp: string
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  totalMB: number
}

/**
 * Connection pool metric
 */
export interface ConnectionMetric {
  timestamp: string
  totalConnections: number
  activeConnections: number
  hitCount: number
  missCount: number
  hitRate: number
}

/**
 * Cache metric
 */
export interface CacheMetric {
  timestamp: string
  totalRequests: number
  hits: number
  misses: number
  hitRate: number
  entriesCount: number
}

/**
 * Metrics collector configuration
 */
interface MetricsConfig {
  logsDir: string
  rotationInterval: number // milliseconds
  flushInterval: number // how often to write to disk
  maxFileSize: number // max size before rotation
  retentionDays: number // how long to keep old files
}

export class MetricsCollector {
  private config: MetricsConfig
  private queryBuffer: QueryMetric[] = []
  private memoryBuffer: MemoryMetric[] = []
  private connectionBuffer: ConnectionMetric[] = []
  private cacheBuffer: CacheMetric[] = []

  private flushTimer?: ReturnType<typeof setInterval>
  private memoryTimer?: ReturnType<typeof setInterval>

  // Tracking for rate calculations
  private queryCount = 0
  private cacheHits = 0
  private cacheMisses = 0
  private connectionHits = 0
  private connectionMisses = 0

  constructor(config?: Partial<MetricsConfig>) {
    this.config = {
      logsDir: path.join(process.cwd(), 'logs', 'metrics'),
      rotationInterval: 24 * 60 * 60 * 1000, // 24 hours
      flushInterval: 30 * 1000, // 30 seconds
      maxFileSize: 10 * 1024 * 1024, // 10MB
      retentionDays: 7,
      ...config,
    }
  }

  /**
   * Start collecting metrics
   */
  async start(): Promise<void> {
    // Ensure logs directory exists
    await this.ensureLogDir()

    // Start periodic flush
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => logger.error('Failed to flush metrics:', err))
    }, this.config.flushInterval)

    // Start memory monitoring
    this.memoryTimer = setInterval(() => {
      this.collectMemoryMetrics()
    }, 10000) // Every 10 seconds

    // Clean old logs on startup
    await this.cleanOldLogs()

    logger.info('📊 Metrics collection started')
  }

  /**
   * Stop collecting metrics
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
    }
    if (this.memoryTimer) {
      clearInterval(this.memoryTimer)
    }

    // Final flush
    await this.flush()

    logger.info('📊 Metrics collection stopped')
  }

  /**
   * Record a query execution
   */
  recordQuery(sql: string, executionTimeMs: number, rowCount: number, spaceId?: string): void {
    this.queryCount++

    const metric: QueryMetric = {
      timestamp: new Date().toISOString(),
      sql: sql.substring(0, 200), // Truncate long queries
      executionTimeMs,
      rowCount,
      isSimple: executionTimeMs < 100,
      spaceId,
    }

    this.queryBuffer.push(metric)

    // Log slow queries immediately
    if (executionTimeMs > 1000) {
      logger.warn(`⚠️ Slow query (${executionTimeMs}ms): ${sql.substring(0, 100)}...`)
    }
  }

  /**
   * Record connection pool access
   */
  recordConnectionPoolAccess(
    hit: boolean,
    stats: {
      totalConnections: number
      activeConnections: number
    }
  ): void {
    if (hit) {
      this.connectionHits++
    } else {
      this.connectionMisses++
    }

    const total = this.connectionHits + this.connectionMisses
    const hitRate = total > 0 ? this.connectionHits / total : 0

    const metric: ConnectionMetric = {
      timestamp: new Date().toISOString(),
      totalConnections: stats.totalConnections,
      activeConnections: stats.activeConnections,
      hitCount: this.connectionHits,
      missCount: this.connectionMisses,
      hitRate: hitRate * 100,
    }

    this.connectionBuffer.push(metric)

    // Alert on low hit rate
    if (total > 10 && hitRate < 0.8) {
      logger.warn(`⚠️ Low connection pool hit rate: ${(hitRate * 100).toFixed(1)}%`)
    }
  }

  /**
   * Record cache access
   */
  recordCacheAccess(hit: boolean, entriesCount: number): void {
    if (hit) {
      this.cacheHits++
    } else {
      this.cacheMisses++
    }

    const total = this.cacheHits + this.cacheMisses
    const hitRate = total > 0 ? this.cacheHits / total : 0

    const metric: CacheMetric = {
      timestamp: new Date().toISOString(),
      totalRequests: total,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: hitRate * 100,
      entriesCount,
    }

    this.cacheBuffer.push(metric)

    // Alert on low cache hit rate for mcp:// URIs
    if (total > 10 && hitRate < 0.6) {
      logger.warn(`⚠️ Low cache hit rate: ${(hitRate * 100).toFixed(1)}%`)
    }
  }

  /**
   * Collect memory metrics
   */
  private collectMemoryMetrics(): void {
    const mem = process.memoryUsage()

    const metric: MemoryMetric = {
      timestamp: new Date().toISOString(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      totalMB: (mem.heapUsed + mem.external) / 1024 / 1024,
    }

    this.memoryBuffer.push(metric)

    // Alert on high memory usage
    const totalGB = metric.totalMB / 1024
    if (totalGB > 3.5) {
      logger.error(`🚨 High memory usage: ${totalGB.toFixed(2)}GB (limit: 4GB)`)
    } else if (totalGB > 3) {
      logger.warn(`⚠️ Memory usage approaching limit: ${totalGB.toFixed(2)}GB`)
    }
  }

  /**
   * Get current performance summary
   */
  async getPerformanceSummary(): Promise<PerformanceMetrics> {
    // Calculate averages from buffers
    const recentQueries = this.queryBuffer.slice(-100)
    const avgQueryTime =
      recentQueries.length > 0
        ? recentQueries.reduce((sum, q) => sum + q.executionTimeMs, 0) / recentQueries.length
        : 0

    const mem = process.memoryUsage()
    const memoryGB = (mem.heapUsed + mem.external) / 1024 / 1024 / 1024

    const connectionHitRate =
      this.connectionHits + this.connectionMisses > 0
        ? (this.connectionHits / (this.connectionHits + this.connectionMisses)) * 100
        : 0

    const cacheHitRate =
      this.cacheHits + this.cacheMisses > 0
        ? (this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100
        : 0

    return {
      queryTime: avgQueryTime,
      memoryUsage: memoryGB,
      connectionPoolHitRate: connectionHitRate,
      cacheHitRate: cacheHitRate,
      spaceIsolation: true, // Always true when SpaceContext is used
    }
  }

  /**
   * Flush metrics to disk
   */
  private async flush(): Promise<void> {
    const date = new Date().toISOString().split('T')[0]

    // Write each metric type to its own file
    await this.writeMetrics(`${date}-queries.json`, this.queryBuffer)
    await this.writeMetrics(`${date}-memory.json`, this.memoryBuffer)
    await this.writeMetrics(`${date}-connections.json`, this.connectionBuffer)
    await this.writeMetrics(`${date}-cache.json`, this.cacheBuffer)

    // Write summary
    const summary = await this.getPerformanceSummary()
    await this.writeMetrics(`${date}-summary.json`, [
      {
        timestamp: new Date().toISOString(),
        ...summary,
        queryCount: this.queryCount,
        bufferSizes: {
          queries: this.queryBuffer.length,
          memory: this.memoryBuffer.length,
          connections: this.connectionBuffer.length,
          cache: this.cacheBuffer.length,
        },
      },
    ])

    // Clear buffers after successful write
    this.queryBuffer = []
    this.memoryBuffer = []
    this.connectionBuffer = []
    this.cacheBuffer = []

    logger.debug('📊 Metrics flushed to disk')
  }

  /**
   * Write metrics to file (append mode)
   */
  private async writeMetrics(filename: string, metrics: any[]): Promise<void> {
    if (metrics.length === 0) return

    const filepath = path.join(this.config.logsDir, filename)

    try {
      // Read existing content if file exists
      let existingData: any[] = []
      try {
        const content = await fs.readFile(filepath, 'utf-8')
        existingData = JSON.parse(content)
      } catch {
        // File doesn't exist or is empty
      }

      // Append new metrics
      const allData = [...existingData, ...metrics]

      // Write back
      await fs.writeFile(filepath, JSON.stringify(allData, null, 2))

      // Check file size for rotation
      const stats = await fs.stat(filepath)
      if (stats.size > this.config.maxFileSize) {
        await this.rotateFile(filepath)
      }
    } catch (error) {
      logger.error('Failed to write metrics:', error)
    }
  }

  /**
   * Rotate large files
   */
  private async rotateFile(filepath: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const rotatedPath = filepath.replace('.json', `-${timestamp}.json`)

    await fs.rename(filepath, rotatedPath)
    logger.info(`📊 Rotated metrics file: ${path.basename(rotatedPath)}`)
  }

  /**
   * Clean old log files
   */
  private async cleanOldLogs(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.logsDir)
      const now = Date.now()
      const maxAge = this.config.retentionDays * 24 * 60 * 60 * 1000

      for (const file of files) {
        const filepath = path.join(this.config.logsDir, file)
        const stats = await fs.stat(filepath)

        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filepath)
          logger.info(`🗑️ Deleted old metrics file: ${file}`)
        }
      }
    } catch (error) {
      // Gracefully handle errors (e.g., directory doesn't exist)
      const err = error as { code?: string; message?: string }
      if (err.code !== 'ENOENT') {
        logger.debug(`Could not clean old logs: ${err.message}`)
      }
    }
  }

  /**
   * Ensure log directory exists
   */
  private async ensureLogDir(): Promise<void> {
    await fs.mkdir(this.config.logsDir, { recursive: true })
  }

  /**
   * Get metrics for a specific date range
   */
  async getMetrics(
    startDate: string,
    endDate: string,
    type: 'queries' | 'memory' | 'connections' | 'cache'
  ): Promise<any[]> {
    const metrics: any[] = []
    const files = await fs.readdir(this.config.logsDir)

    for (const file of files) {
      if (!file.includes(type)) continue

      const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/)
      if (!dateMatch) continue

      const fileDate = dateMatch[1]
      if (fileDate >= startDate && fileDate <= endDate) {
        const filepath = path.join(this.config.logsDir, file)
        const content = await fs.readFile(filepath, 'utf-8')
        const data = JSON.parse(content)
        metrics.push(...data)
      }
    }

    return metrics.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }
}

// Singleton instance
let metricsCollector: MetricsCollector | null = null

/**
 * Get or create the metrics collector instance
 */
export function getMetricsCollector(): MetricsCollector {
  if (!metricsCollector) {
    metricsCollector = new MetricsCollector()
  }
  return metricsCollector
}
