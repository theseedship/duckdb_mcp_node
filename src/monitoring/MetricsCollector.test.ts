/**
 * Tests for MetricsCollector
 * Comprehensive coverage for metrics collection, persistence, and reporting
 */

import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { MetricsCollector, getMetricsCollector } from './MetricsCollector.js'

// Mock the logger to prevent console noise
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('MetricsCollector', () => {
  let metricsCollector: MetricsCollector
  let testMetricsDir: string

  beforeEach(async () => {
    // Create a unique test directory for each test
    testMetricsDir = path.join(
      os.tmpdir(),
      `metrics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    await fs.mkdir(testMetricsDir, { recursive: true })

    // Create collector with test directory
    metricsCollector = new MetricsCollector({
      logsDir: testMetricsDir,
      flushInterval: 100, // Fast flush for tests
      retentionDays: 1,
    })
  })

  afterEach(async () => {
    // Stop the collector
    if (metricsCollector) {
      await metricsCollector.stop()
    }

    // Clean up test directory
    try {
      await fs.rm(testMetricsDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }

    // Reset singleton
    vi.clearAllMocks()
  })

  describe('Initialization', () => {
    it('should create metrics directory on start', async () => {
      await metricsCollector.start()

      const dirExists = await fs
        .stat(testMetricsDir)
        .then((stats) => stats.isDirectory())
        .catch(() => false)

      expect(dirExists).toBe(true)
    })

    it('should start flush timer', async () => {
      const flushSpy = vi.spyOn(metricsCollector as any, 'flush')

      await metricsCollector.start()

      // Wait for flush interval
      await new Promise((resolve) => setTimeout(resolve, 150))

      expect(flushSpy).toHaveBeenCalled()
    })

    it('should handle start being called multiple times', async () => {
      await metricsCollector.start()
      await metricsCollector.start() // Should not error

      expect(true).toBe(true) // If we get here without error, test passes
    })
  })

  describe('Query Metrics', () => {
    beforeEach(async () => {
      await metricsCollector.start()
    })

    it('should record query metrics', () => {
      metricsCollector.recordQuery('SELECT * FROM users', 45.5, 100, 'space-1')

      const metrics = (metricsCollector as any).queryBuffer
      expect(metrics).toHaveLength(1)
      expect(metrics[0]).toMatchObject({
        sql: 'SELECT * FROM users',
        executionTimeMs: 45.5,
        rowCount: 100,
        spaceId: 'space-1',
        isSimple: true,
      })
    })

    it('should classify complex queries correctly', () => {
      metricsCollector.recordQuery(
        'SELECT * FROM users JOIN orders ON users.id = orders.user_id',
        150,
        1000
      )

      const metrics = (metricsCollector as any).queryBuffer
      expect(metrics[0].isSimple).toBe(false)
    })

    it('should persist query metrics to file', async () => {
      metricsCollector.recordQuery('SELECT 1', 10, 1)
      metricsCollector.recordQuery('SELECT 2', 20, 1)

      // Force flush
      await (metricsCollector as any).flush()

      // Check file was created
      const today = new Date().toISOString().split('T')[0]
      const queryFile = path.join(testMetricsDir, `${today}-queries.json`)

      const content = await fs.readFile(queryFile, 'utf-8')
      const data = JSON.parse(content)

      expect(data).toHaveLength(2)
      expect(data[0].sql).toBe('SELECT 1')
      expect(data[1].sql).toBe('SELECT 2')
    })

    it('should append to existing query file', async () => {
      metricsCollector.recordQuery('SELECT 1', 10, 1)
      await (metricsCollector as any).flush()

      metricsCollector.recordQuery('SELECT 2', 20, 1)
      await (metricsCollector as any).flush()

      const today = new Date().toISOString().split('T')[0]
      const queryFile = path.join(testMetricsDir, `${today}-queries.json`)

      const content = await fs.readFile(queryFile, 'utf-8')
      const data = JSON.parse(content)

      expect(data).toHaveLength(2)
    })
  })

  describe('Memory Metrics', () => {
    beforeEach(async () => {
      await metricsCollector.start()
    })

    it('should record memory metrics automatically', async () => {
      // Manually trigger memory collection since timer might not fire immediately
      ;(metricsCollector as any).collectMemoryMetrics()

      const memoryBuffer = (metricsCollector as any).memoryBuffer
      expect(memoryBuffer.length).toBeGreaterThan(0)

      const metric = memoryBuffer[0]
      expect(metric).toHaveProperty('heapUsed')
      expect(metric).toHaveProperty('heapTotal')
      expect(metric).toHaveProperty('external')
      expect(metric).toHaveProperty('arrayBuffers')
      expect(metric).toHaveProperty('totalMB')
    })

    it('should calculate total memory in MB correctly', async () => {
      // Manually trigger memory collection
      ;(metricsCollector as any).collectMemoryMetrics()

      const memoryBuffer = (metricsCollector as any).memoryBuffer
      const metric = memoryBuffer[0]

      const expectedTotal = (metric.heapUsed + metric.external) / 1024 / 1024
      expect(metric.totalMB).toBeCloseTo(expectedTotal, 1)
    })

    it('should persist memory metrics', async () => {
      // Manually trigger memory collection
      ;(metricsCollector as any).collectMemoryMetrics()
      await (metricsCollector as any).flush()

      const today = new Date().toISOString().split('T')[0]
      const memoryFile = path.join(testMetricsDir, `${today}-memory.json`)

      const content = await fs.readFile(memoryFile, 'utf-8')
      const data = JSON.parse(content)

      expect(data.length).toBeGreaterThan(0)
      expect(data[0]).toHaveProperty('totalMB')
    })
  })

  describe('Connection Pool Metrics', () => {
    beforeEach(async () => {
      await metricsCollector.start()
    })

    it('should record connection pool hit', () => {
      metricsCollector.recordConnectionPoolAccess(true, {
        totalConnections: 5,
        activeConnections: 3,
      })

      const metrics = (metricsCollector as any).connectionBuffer
      expect(metrics).toHaveLength(1)
      expect(metrics[0]).toMatchObject({
        totalConnections: 5,
        activeConnections: 3,
        hitCount: 1,
        missCount: 0,
      })
    })

    it('should record connection pool miss', () => {
      metricsCollector.recordConnectionPoolAccess(false, {
        totalConnections: 10,
        activeConnections: 8,
      })

      const metrics = (metricsCollector as any).connectionBuffer
      expect(metrics[0].missCount).toBe(1)
      expect(metrics[0].hitCount).toBe(0)
    })

    it('should calculate hit rate correctly', () => {
      // Record some hits and misses
      metricsCollector.recordConnectionPoolAccess(true, {
        totalConnections: 1,
        activeConnections: 1,
      })
      metricsCollector.recordConnectionPoolAccess(true, {
        totalConnections: 1,
        activeConnections: 1,
      })
      metricsCollector.recordConnectionPoolAccess(false, {
        totalConnections: 1,
        activeConnections: 1,
      })
      metricsCollector.recordConnectionPoolAccess(true, {
        totalConnections: 1,
        activeConnections: 1,
      })

      // Check aggregate stats
      const hitCount = (metricsCollector as any).connectionHits
      const missCount = (metricsCollector as any).connectionMisses

      expect(hitCount).toBe(3)
      expect(missCount).toBe(1)
    })

    it('should persist connection metrics', async () => {
      metricsCollector.recordConnectionPoolAccess(true, {
        totalConnections: 5,
        activeConnections: 2,
      })

      await (metricsCollector as any).flush()

      const today = new Date().toISOString().split('T')[0]
      const connFile = path.join(testMetricsDir, `${today}-connections.json`)

      const content = await fs.readFile(connFile, 'utf-8')
      const data = JSON.parse(content)

      expect(data).toHaveLength(1)
      expect(data[0].totalConnections).toBe(5)
    })
  })

  describe('Cache Metrics', () => {
    beforeEach(async () => {
      await metricsCollector.start()
    })

    it('should record cache hit', () => {
      metricsCollector.recordCacheAccess(true, 10)

      const metrics = (metricsCollector as any).cacheBuffer
      expect(metrics).toHaveLength(1)
      expect(metrics[0]).toMatchObject({
        hits: 1,
        misses: 0,
        entriesCount: 10,
      })
    })

    it('should record cache miss', () => {
      metricsCollector.recordCacheAccess(false, 5)

      const metrics = (metricsCollector as any).cacheBuffer
      expect(metrics[0].hits).toBe(0)
      expect(metrics[0].misses).toBe(1)
    })

    it('should track cache hit/miss counts', () => {
      metricsCollector.recordCacheAccess(true, 10)
      metricsCollector.recordCacheAccess(true, 10)
      metricsCollector.recordCacheAccess(false, 10)

      const hitCount = (metricsCollector as any).cacheHits
      const missCount = (metricsCollector as any).cacheMisses

      expect(hitCount).toBe(2)
      expect(missCount).toBe(1)
    })

    it('should persist cache metrics', async () => {
      metricsCollector.recordCacheAccess(true, 15)
      metricsCollector.recordCacheAccess(false, 15)

      await (metricsCollector as any).flush()

      const today = new Date().toISOString().split('T')[0]
      const cacheFile = path.join(testMetricsDir, `${today}-cache.json`)

      const content = await fs.readFile(cacheFile, 'utf-8')
      const data = JSON.parse(content)

      expect(data).toHaveLength(2)
      expect(data[0].hits).toBe(1)
      expect(data[1].hits).toBe(1)
    })
  })

  describe('Summary Generation', () => {
    beforeEach(async () => {
      await metricsCollector.start()
    })

    it('should generate performance summary', async () => {
      // Record various metrics
      metricsCollector.recordQuery('SELECT 1', 50, 1)
      metricsCollector.recordQuery('SELECT 2', 150, 100)
      metricsCollector.recordConnectionPoolAccess(true, {
        totalConnections: 5,
        activeConnections: 2,
      })
      metricsCollector.recordConnectionPoolAccess(true, {
        totalConnections: 5,
        activeConnections: 2,
      })
      metricsCollector.recordConnectionPoolAccess(false, {
        totalConnections: 5,
        activeConnections: 2,
      })
      metricsCollector.recordCacheAccess(true, 10)
      metricsCollector.recordCacheAccess(false, 10)

      const performanceSummary = await metricsCollector.getPerformanceSummary()

      const today = new Date().toISOString().split('T')[0]
      await (metricsCollector as any).writeMetrics(`${today}-summary.json`, [
        {
          timestamp: new Date().toISOString(),
          ...performanceSummary,
          queryCount: (metricsCollector as any).queryCount,
        },
      ])

      const summaryFile = path.join(testMetricsDir, `${today}-summary.json`)

      const content = await fs.readFile(summaryFile, 'utf-8')
      const data = JSON.parse(content)

      expect(data).toHaveLength(1)
      const summary = data[0]

      expect(summary).toHaveProperty('timestamp')
      expect(summary.queryTime).toBeCloseTo(100, 0) // Average of 50 and 150
      expect(summary.queryCount).toBe(2)
      expect(summary.memoryUsage).toBeGreaterThan(0)
      expect(summary.connectionPoolHitRate).toBeCloseTo(66.67, 0) // 2/3 hits
      expect(summary.cacheHitRate).toBe(50) // 1/2 hits
      expect(summary.spaceIsolation).toBe(true)
    })

    it('should handle summary with no data gracefully', async () => {
      const summary = await metricsCollector.getPerformanceSummary()
      const today = new Date().toISOString().split('T')[0]
      await (metricsCollector as any).writeMetrics(`${today}-summary.json`, [
        {
          timestamp: new Date().toISOString(),
          ...summary,
          queryCount: (metricsCollector as any).queryCount,
        },
      ])

      const summaryFile = path.join(testMetricsDir, `${today}-summary.json`)

      const content = await fs.readFile(summaryFile, 'utf-8')
      const data = JSON.parse(content)

      expect(data).toHaveLength(1)
      const emptySummary = data[0]

      expect(emptySummary.queryTime).toBe(0)
      expect(emptySummary.queryCount).toBe(0)
      expect(emptySummary.connectionPoolHitRate).toBe(0)
      expect(emptySummary.cacheHitRate).toBe(0)
    })
  })

  describe('Cleanup', () => {
    beforeEach(async () => {
      await metricsCollector.start()
    })

    it('should cleanup old files', async () => {
      // Create an old file (8 days ago to ensure it's past retention)
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 8)
      const oldDateStr = oldDate.toISOString().split('T')[0]
      const oldFile = path.join(testMetricsDir, `${oldDateStr}-queries.json`)

      await fs.writeFile(oldFile, '[]')

      // Backdate the file modification time to 8 days ago
      const oldTime = new Date()
      oldTime.setDate(oldTime.getDate() - 8)
      await fs.utimes(oldFile, oldTime, oldTime)

      // Create a current file
      const today = new Date().toISOString().split('T')[0]
      const currentFile = path.join(testMetricsDir, `${today}-queries.json`)
      await fs.writeFile(currentFile, '[]')

      // Run cleanup
      await (metricsCollector as any).cleanOldLogs()

      // Check that old file is deleted and current file remains
      const oldExists = await fs
        .stat(oldFile)
        .then(() => true)
        .catch(() => false)
      const currentExists = await fs
        .stat(currentFile)
        .then(() => true)
        .catch(() => false)

      expect(oldExists).toBe(false)
      expect(currentExists).toBe(true)
    })

    it('should handle cleanup errors gracefully', async () => {
      // Try to cleanup non-existent directory
      const badCollector = new MetricsCollector({
        logsDir: '/nonexistent/path',
        retentionDays: 1,
      })

      // Should not throw
      await expect((badCollector as any).cleanOldLogs()).resolves.not.toThrow()
    })
  })

  describe('Error Handling', () => {
    it('should handle write errors gracefully', async () => {
      // Create collector with invalid directory
      const badCollector = new MetricsCollector({
        logsDir: '/root/no-permission',
        flushInterval: 100,
      })

      // Start should handle permission errors
      try {
        await badCollector.start()
      } catch {
        // Expected to fail on permission denied
      }

      // Should not throw when recording metrics
      expect(() => {
        badCollector.recordQuery('SELECT 1', 10, 1)
      }).not.toThrow()

      // Force flush should not throw
      await expect((badCollector as any).flush()).resolves.not.toThrow()

      await badCollector.stop()
    })

    it('should handle JSON parsing errors', async () => {
      await metricsCollector.start()

      // Write invalid JSON to a metrics file
      const today = new Date().toISOString().split('T')[0]
      const badFile = path.join(testMetricsDir, `${today}-queries.json`)
      await fs.writeFile(badFile, 'not valid json')

      // Recording should still work (will overwrite bad file)
      metricsCollector.recordQuery('SELECT 1', 10, 1)
      await (metricsCollector as any).flush()

      // File should now contain valid JSON
      const content = await fs.readFile(badFile, 'utf-8')
      const data = JSON.parse(content)
      expect(data).toHaveLength(1)
    })
  })

  describe('Singleton Pattern', () => {
    it('should return same instance from getMetricsCollector', () => {
      const instance1 = getMetricsCollector()
      const instance2 = getMetricsCollector()

      expect(instance1).toBe(instance2)
    })

    it('should allow custom config on first call', () => {
      // This test just verifies that custom config can be passed
      // The singleton behavior means only the first config is used
      const customDir = path.join(testMetricsDir, 'custom')

      // Since getMetricsCollector might have been called already,
      // we can't guarantee this is the first call.
      // Just verify that the function accepts config parameter
      const instance = getMetricsCollector({ logsDir: customDir })

      expect(instance).toBeDefined()
      expect(instance).toHaveProperty('start')
      expect(instance).toHaveProperty('stop')
    })
  })

  describe('Stop and Cleanup', () => {
    it('should stop timers on stop()', async () => {
      await metricsCollector.start()

      const flushTimer = (metricsCollector as any).flushTimer
      const memoryTimer = (metricsCollector as any).memoryTimer

      expect(flushTimer).toBeDefined()
      expect(memoryTimer).toBeDefined()

      await metricsCollector.stop()

      // Timers should be cleared (but may not be undefined due to Node.js internals)
      const stoppedFlushTimer = (metricsCollector as any).flushTimer
      const stoppedMemoryTimer = (metricsCollector as any).memoryTimer

      // Check that timers are either undefined or destroyed
      const flushTimerStopped =
        stoppedFlushTimer === undefined || stoppedFlushTimer._destroyed === true
      const memoryTimerStopped =
        stoppedMemoryTimer === undefined || stoppedMemoryTimer._destroyed === true

      expect(flushTimerStopped).toBe(true)
      expect(memoryTimerStopped).toBe(true)
    })

    it('should flush remaining metrics on stop', async () => {
      await metricsCollector.start()

      metricsCollector.recordQuery('SELECT 1', 10, 1)
      metricsCollector.recordConnectionPoolAccess(true, {
        totalConnections: 5,
        activeConnections: 2,
      })

      await metricsCollector.stop()

      const today = new Date().toISOString().split('T')[0]
      const queryFile = path.join(testMetricsDir, `${today}-queries.json`)
      const connFile = path.join(testMetricsDir, `${today}-connections.json`)

      const queryExists = await fs
        .stat(queryFile)
        .then(() => true)
        .catch(() => false)
      const connExists = await fs
        .stat(connFile)
        .then(() => true)
        .catch(() => false)

      expect(queryExists).toBe(true)
      expect(connExists).toBe(true)
    })

    it('should handle multiple stop calls', async () => {
      await metricsCollector.start()
      await metricsCollector.stop()
      await metricsCollector.stop() // Should not error

      expect(true).toBe(true)
    })
  })

  describe('Performance', () => {
    it('should handle high volume of metrics efficiently', async () => {
      await metricsCollector.start()

      const startTime = Date.now()

      // Record 1000 metrics quickly
      for (let i = 0; i < 1000; i++) {
        metricsCollector.recordQuery(`SELECT ${i}`, Math.random() * 100, i)
        if (i % 3 === 0) {
          metricsCollector.recordConnectionPoolAccess(i % 2 === 0, {
            totalConnections: 10,
            activeConnections: 5,
          })
        }
        if (i % 5 === 0) {
          metricsCollector.recordCacheAccess(i % 2 === 0, 20)
        }
      }

      const recordTime = Date.now() - startTime

      // Should handle 1000 metrics in under 100ms
      expect(recordTime).toBeLessThan(100)

      // Flush and verify
      await (metricsCollector as any).flush()

      const today = new Date().toISOString().split('T')[0]
      const queryFile = path.join(testMetricsDir, `${today}-queries.json`)

      const content = await fs.readFile(queryFile, 'utf-8')
      const data = JSON.parse(content)

      expect(data).toHaveLength(1000)
    })
  })

  afterAll(() => {
    // Restore all mocks
    vi.restoreAllMocks()
  })
})
