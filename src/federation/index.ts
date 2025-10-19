/**
 * Federation Module - Unified exports for DuckDB MCP Federation
 *
 * Provides federated query execution across multiple MCP servers
 * using the mcp:// protocol for transparent data access.
 */

import { DuckDBService } from '../duckdb/service.js'
import { QueryRouter } from './QueryRouter.js'
import type { QueryPlan } from './QueryRouter.js'
import { ResourceRegistry } from './ResourceRegistry.js'
import { MCPConnectionPool } from './ConnectionPool.js'
import { logger } from '../utils/logger.js'

// Re-export all federation components
export { QueryRouter } from './QueryRouter.js'
export { ResourceRegistry } from './ResourceRegistry.js'
export { MCPConnectionPool, MCPConnectionPool as ConnectionPool } from './ConnectionPool.js'
export type { QueryPlan, QueryResult } from './QueryRouter.js'
export type { FederatedResource } from './ResourceRegistry.js'
export type { ConnectionPoolConfig, PooledConnection } from './ConnectionPool.js'

/**
 * Configuration for the federation system
 */
export interface FederationConfig {
  /** DuckDB service instance */
  duckdb?: DuckDBService
  /** Connection timeout in milliseconds */
  connectionTimeout?: number
  /** Whether to enable query caching */
  enableCache?: boolean
  /** Cache TTL in milliseconds */
  cacheTTL?: number
}

/**
 * Federation manager that coordinates all components
 */
export class FederationManager {
  private router: QueryRouter
  private registry: ResourceRegistry
  private connectionPool: MCPConnectionPool
  private duckdb: DuckDBService
  private servers = new Map<
    string,
    { connectionString: string; metadata?: Record<string, unknown> }
  >()

  constructor(config: FederationConfig = {}) {
    this.duckdb = config.duckdb || new DuckDBService()
    this.connectionPool = new MCPConnectionPool({
      connectionTTL: config.connectionTimeout || 30000,
    })
    this.registry = new ResourceRegistry()
    this.router = new QueryRouter(this.duckdb, this.connectionPool, this.registry)

    logger.info('🌐 Federation Manager initialized')
  }

  /**
   * Execute a federated query
   * Alias for router.executeQuery with better naming
   */
  async federateQuery(sql: string): Promise<unknown> {
    logger.debug(`🔄 Federating query: ${sql.substring(0, 100)}...`)

    try {
      const result = await this.router.executeQuery(sql)
      const data = (result as { data?: unknown[] }).data
      logger.info(`✅ Federated query successful, returned ${data?.length || 0} rows`)
      return result
    } catch (error) {
      logger.error('❌ Federation query failed:', error)
      throw error
    }
  }

  /**
   * Register an MCP server for federation
   */
  async registerServer(
    alias: string,
    connectionString: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    logger.info(`📝 Registering server: ${alias} -> ${connectionString}`)

    // Store server information
    this.servers.set(alias, { connectionString, metadata })

    // Pre-connect to server
    try {
      await this.connectionPool.getClient(connectionString)
      logger.info(`✅ Successfully connected to ${alias}`)
    } catch {
      logger.warn(`⚠️ Could not pre-connect to ${alias}, will retry on demand`)
    }
  }

  /**
   * List all registered servers
   */
  listServers(): Array<{ alias: string; connectionString: string; status: string }> {
    const servers: Array<{ alias: string; connectionString: string; status: string }> = []

    for (const [alias, info] of this.servers) {
      servers.push({
        alias,
        connectionString: info.connectionString,
        status: 'registered', // Simple status for now
      })
    }

    return servers
  }

  /**
   * Analyze a query without executing it
   */
  analyzeQuery(sql: string): QueryPlan {
    return this.router.analyzeQuery(sql)
  }

  /**
   * Explain how a query will be executed
   */
  explainQuery(sql: string): string {
    return this.router.explainQuery(sql)
  }

  /**
   * Get federation statistics
   */
  getStats(): Record<string, unknown> {
    return {
      router: this.router.getStats(),
      registry: {
        servers: this.servers.size,
        resources: this.registry.getAllResources().length,
      },
      connectionPool: this.connectionPool.getStats(),
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    logger.info('🧹 Cleaning up federation resources')
    // QueryRouter doesn't have cleanup, just close connection pool
    await this.connectionPool.close()
  }
}

/**
 * Create a pre-configured federation router
 */
export function createFederationRouter(
  duckdb?: DuckDBService,
  config?: Partial<FederationConfig>
): QueryRouter {
  const db = duckdb || new DuckDBService()
  const pool = new MCPConnectionPool({
    connectionTTL: config?.connectionTimeout || 30000,
  })
  const registry = new ResourceRegistry()

  return new QueryRouter(db, pool, registry)
}

/**
 * Quick helper to execute federated queries
 */
export async function federateQuery(sql: string, duckdb?: DuckDBService): Promise<unknown> {
  const router = createFederationRouter(duckdb)
  try {
    return await router.executeQuery(sql)
  } finally {
    // Router doesn't have cleanup, resources will be cleaned up on connection close
  }
}
