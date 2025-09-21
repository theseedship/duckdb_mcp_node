#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * CLI tool for viewing DuckDB MCP metrics
 *
 * Usage:
 *   npx tsx src/cli/metrics-viewer.ts --summary
 *   npx tsx src/cli/metrics-viewer.ts --queries --today
 *   npx tsx src/cli/metrics-viewer.ts --memory --last 7
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { parseArgs } from 'util'

// Interface for CLI options (currently unused but kept for future extensions)
// interface MetricsViewerOptions {
//   summary?: boolean
//   queries?: boolean
//   memory?: boolean
//   connections?: boolean
//   cache?: boolean
//   today?: boolean
//   last?: number
//   date?: string
// }

class MetricsViewer {
  private metricsDir: string

  constructor(metricsDir?: string) {
    this.metricsDir = metricsDir || path.join(process.cwd(), 'logs', 'metrics')
  }

  /**
   * View current performance summary
   */
  async viewSummary(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const summaryFile = path.join(this.metricsDir, `${today}-summary.json`)

    try {
      const content = await fs.readFile(summaryFile, 'utf-8')
      const summaries = JSON.parse(content)

      if (summaries.length === 0) {
        console.log('No summary data available')
        return
      }

      const latest = summaries[summaries.length - 1]

      console.log('\n📊 Performance Metrics Summary')
      console.log('════════════════════════════════════════════')
      console.log(`📅 Timestamp: ${latest.timestamp}`)
      console.log(
        `⚡ Avg Query Time: ${latest.queryTime.toFixed(2)}ms ${latest.queryTime < 100 ? '✅' : '⚠️'}`
      )
      console.log(
        `💾 Memory Usage: ${latest.memoryUsage.toFixed(2)}GB / 4GB ${latest.memoryUsage < 4 ? '✅' : '🚨'}`
      )
      console.log(
        `🔗 Connection Pool Hit Rate: ${latest.connectionPoolHitRate.toFixed(1)}% ${latest.connectionPoolHitRate > 80 ? '✅' : '⚠️'}`
      )
      console.log(
        `📦 Cache Hit Rate: ${latest.cacheHitRate.toFixed(1)}% ${latest.cacheHitRate > 60 ? '✅' : '⚠️'}`
      )
      console.log(`🔒 Space Isolation: ${latest.spaceIsolation ? '✅ Enabled' : '❌ Disabled'}`)
      console.log(`📈 Total Queries: ${latest.queryCount}`)
      console.log('════════════════════════════════════════════')
    } catch {
      console.log(`No summary data for ${today}`)
    }
  }

  /**
   * View query metrics
   */
  async viewQueries(days: number = 1): Promise<void> {
    const metrics = await this.loadMetrics('queries', days)

    if (metrics.length === 0) {
      console.log('No query data available')
      return
    }

    console.log('\n🔍 Query Metrics')
    console.log('════════════════════════════════════════════')

    // Group by simple vs complex
    const simple = metrics.filter((m) => m.isSimple)
    const complex = metrics.filter((m) => !m.isSimple)

    console.log(`Total Queries: ${metrics.length}`)
    console.log(
      `Simple (<100ms): ${simple.length} (${((simple.length / metrics.length) * 100).toFixed(1)}%)`
    )
    console.log(
      `Complex (>100ms): ${complex.length} (${((complex.length / metrics.length) * 100).toFixed(1)}%)`
    )

    // Find slowest queries
    const slowest = metrics.sort((a, b) => b.executionTimeMs - a.executionTimeMs).slice(0, 5)

    console.log('\n🐌 Slowest Queries:')
    for (const query of slowest) {
      console.log(`  ${query.executionTimeMs}ms - ${query.sql.substring(0, 50)}...`)
    }

    // Calculate percentiles
    const times = metrics.map((m) => m.executionTimeMs).sort((a, b) => a - b)
    const p50 = times[Math.floor(times.length * 0.5)]
    const p95 = times[Math.floor(times.length * 0.95)]
    const p99 = times[Math.floor(times.length * 0.99)]

    console.log('\n📊 Response Time Percentiles:')
    console.log(`  P50: ${p50}ms`)
    console.log(`  P95: ${p95}ms`)
    console.log(`  P99: ${p99}ms`)
    console.log('════════════════════════════════════════════')
  }

  /**
   * View memory metrics
   */
  async viewMemory(days: number = 1): Promise<void> {
    const metrics = await this.loadMetrics('memory', days)

    if (metrics.length === 0) {
      console.log('No memory data available')
      return
    }

    console.log('\n💾 Memory Metrics')
    console.log('════════════════════════════════════════════')

    // Find min/max/avg
    const mbValues = metrics.map((m) => m.totalMB)
    const min = Math.min(...mbValues)
    const max = Math.max(...mbValues)
    const avg = mbValues.reduce((a, b) => a + b, 0) / mbValues.length

    console.log(`Samples: ${metrics.length}`)
    console.log(`Min Memory: ${(min / 1024).toFixed(2)}GB`)
    console.log(`Max Memory: ${(max / 1024).toFixed(2)}GB`)
    console.log(`Avg Memory: ${(avg / 1024).toFixed(2)}GB`)

    // Find memory spikes
    const spikes = metrics.filter((m) => m.totalMB / 1024 > 3)
    if (spikes.length > 0) {
      console.log(`\n⚠️ Memory Warnings (>3GB): ${spikes.length}`)
      for (const spike of spikes.slice(0, 3)) {
        console.log(`  ${spike.timestamp}: ${(spike.totalMB / 1024).toFixed(2)}GB`)
      }
    }

    // Show latest
    const latest = metrics[metrics.length - 1]
    console.log(`\n📍 Current Memory: ${(latest.totalMB / 1024).toFixed(2)}GB`)
    console.log(`  Heap Used: ${(latest.heapUsed / 1024 / 1024 / 1024).toFixed(2)}GB`)
    console.log(`  Heap Total: ${(latest.heapTotal / 1024 / 1024 / 1024).toFixed(2)}GB`)
    console.log(`  External: ${(latest.external / 1024 / 1024 / 1024).toFixed(2)}GB`)
    console.log('════════════════════════════════════════════')
  }

  /**
   * View connection pool metrics
   */
  async viewConnections(days: number = 1): Promise<void> {
    const metrics = await this.loadMetrics('connections', days)

    if (metrics.length === 0) {
      console.log('No connection data available')
      return
    }

    console.log('\n🔗 Connection Pool Metrics')
    console.log('════════════════════════════════════════════')

    const latest = metrics[metrics.length - 1]
    console.log(`Total Connections: ${latest.totalConnections}`)
    console.log(`Active Connections: ${latest.activeConnections}`)
    console.log(`Hit Count: ${latest.hitCount}`)
    console.log(`Miss Count: ${latest.missCount}`)
    console.log(`Hit Rate: ${latest.hitRate.toFixed(1)}%`)

    // Calculate average hit rate
    const avgHitRate = metrics.reduce((sum, m) => sum + m.hitRate, 0) / metrics.length
    console.log(`\n📊 Average Hit Rate: ${avgHitRate.toFixed(1)}%`)

    if (avgHitRate < 80) {
      console.log('⚠️ Low hit rate detected - consider adjusting pool size')
    }
    console.log('════════════════════════════════════════════')
  }

  /**
   * View cache metrics
   */
  async viewCache(days: number = 1): Promise<void> {
    const metrics = await this.loadMetrics('cache', days)

    if (metrics.length === 0) {
      console.log('No cache data available')
      return
    }

    console.log('\n📦 Cache Metrics')
    console.log('════════════════════════════════════════════')

    const latest = metrics[metrics.length - 1]
    console.log(`Total Requests: ${latest.totalRequests}`)
    console.log(`Hits: ${latest.hits}`)
    console.log(`Misses: ${latest.misses}`)
    console.log(`Hit Rate: ${latest.hitRate.toFixed(1)}%`)
    console.log(`Cached Entries: ${latest.entriesCount}`)

    // Calculate average hit rate
    const avgHitRate = metrics.reduce((sum, m) => sum + m.hitRate, 0) / metrics.length
    console.log(`\n📊 Average Hit Rate: ${avgHitRate.toFixed(1)}%`)

    if (avgHitRate < 60) {
      console.log('⚠️ Low cache hit rate for mcp:// URIs')
    }
    console.log('════════════════════════════════════════════')
  }

  /**
   * Load metrics from files
   */
  private async loadMetrics(type: string, days: number): Promise<any[]> {
    const metrics: any[] = []
    const today = new Date()

    for (let i = 0; i < days; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]

      const filename = `${dateStr}-${type}.json`
      const filepath = path.join(this.metricsDir, filename)

      try {
        const content = await fs.readFile(filepath, 'utf-8')
        const data = JSON.parse(content)
        metrics.push(...data)
      } catch {
        // File doesn't exist for this date
      }
    }

    return metrics
  }
}

// CLI interface
async function main() {
  const { values } = parseArgs({
    options: {
      summary: { type: 'boolean', short: 's' },
      queries: { type: 'boolean', short: 'q' },
      memory: { type: 'boolean', short: 'm' },
      connections: { type: 'boolean', short: 'c' },
      cache: { type: 'boolean', short: 'x' },
      today: { type: 'boolean', short: 't' },
      last: { type: 'string', short: 'l' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(`
DuckDB MCP Metrics Viewer

Usage:
  npx tsx src/cli/metrics-viewer.ts [options]

Options:
  -s, --summary        Show performance summary
  -q, --queries        Show query metrics
  -m, --memory         Show memory metrics
  -c, --connections    Show connection pool metrics
  -x, --cache          Show cache metrics
  -t, --today          Show today's data only
  -l, --last <days>    Show last N days of data
  -h, --help           Show this help message

Examples:
  npx tsx src/cli/metrics-viewer.ts --summary
  npx tsx src/cli/metrics-viewer.ts --queries --today
  npx tsx src/cli/metrics-viewer.ts --memory --last 7
  npx tsx src/cli/metrics-viewer.ts -q -m -c -x --today
`)
    process.exit(0)
  }

  const viewer = new MetricsViewer()
  const days = values.today ? 1 : values.last ? parseInt(values.last) : 1

  // Default to summary if no options specified
  if (!values.queries && !values.memory && !values.connections && !values.cache) {
    await viewer.viewSummary()
    return
  }

  if (values.summary) {
    await viewer.viewSummary()
  }

  if (values.queries) {
    await viewer.viewQueries(days)
  }

  if (values.memory) {
    await viewer.viewMemory(days)
  }

  if (values.connections) {
    await viewer.viewConnections(days)
  }

  if (values.cache) {
    await viewer.viewCache(days)
  }
}

// Run CLI
main().catch(console.error)

export { MetricsViewer }
