import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api'
import { z } from 'zod'
import { performance } from 'perf_hooks'
import { escapeIdentifier, escapeString, escapeFilePath } from '../utils/sql-escape.js'
import { logger } from '../utils/logger.js'
import { VirtualFilesystem, VirtualFilesystemConfig } from '../filesystem/index.js'
import { ResourceRegistry } from '../federation/ResourceRegistry.js'
import { MCPConnectionPool } from '../federation/ConnectionPool.js'
import { getMetricsCollector } from '../monitoring/MetricsCollector.js'

// Configuration schema for DuckDB
const DuckDBConfigSchema = z.object({
  memory: z.string().default('4GB'),
  threads: z.number().default(4),
  allowUnsignedExtensions: z.boolean().default(false),
  s3Config: z
    .object({
      endpoint: z.string().optional(),
      accessKey: z.string().optional(),
      secretKey: z.string().optional(),
      region: z.string().default('us-east-1'),
      useSSL: z.boolean().default(false),
    })
    .optional(),
})

export type DuckDBConfig = z.infer<typeof DuckDBConfigSchema>

/**
 * Extended configuration with Virtual Filesystem support
 */
export interface DuckDBServiceConfig extends DuckDBConfig {
  virtualFilesystem?: {
    enabled?: boolean
    config?: VirtualFilesystemConfig
    resourceRegistry?: ResourceRegistry
    connectionPool?: MCPConnectionPool
  }
}

/**
 * DuckDB service for executing queries and managing connections
 */
export class DuckDBService {
  private instance: DuckDBInstance | null = null
  private connection: DuckDBConnection | null = null
  private config: DuckDBConfig
  private isInitialized = false
  private virtualFs?: VirtualFilesystem
  private extendedConfig?: Partial<DuckDBServiceConfig>

  constructor(config?: Partial<DuckDBServiceConfig>) {
    this.config = DuckDBConfigSchema.parse(config || {})
    this.extendedConfig = config
  }

  /**
   * Initialize DuckDB instance and connection
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    try {
      // Create DuckDB instance with configuration
      const instanceConfig: any = {
        max_memory: this.config.memory,
        threads: this.config.threads.toString(),
      }

      if (this.config.allowUnsignedExtensions) {
        instanceConfig.allow_unsigned_extensions = 'true'
      }

      this.instance = await DuckDBInstance.create(':memory:', instanceConfig)
      this.connection = await this.instance.connect()

      // Mark as initialized once connection is ready
      this.isInitialized = true

      // Load DuckPGQ extension for Property Graph queries (SQL:2023 standard)
      if (this.config.allowUnsignedExtensions && process.env.ENABLE_DUCKPGQ !== 'false') {
        await this.loadDuckPGQ()
      }

      // Configure S3 if credentials provided (optional, non-blocking)
      if (this.config.s3Config?.accessKey && this.config.s3Config?.secretKey) {
        try {
          await this.configureS3()
          // Disabled to prevent JSON-RPC corruption
          // logger.debug('S3 configuration applied successfully')
        } catch (error) {
          logger.warn('Failed to configure S3, continuing without S3 support:', error)
          // Continue without S3 - database is still functional
        }
      }

      // Initialize Virtual Filesystem if enabled
      if (this.extendedConfig?.virtualFilesystem?.enabled) {
        await this.initializeVirtualFilesystem()
      }
    } catch (error) {
      logger.error('Failed to initialize DuckDB:', error)
      throw error
    }
  }

  /**
   * Initialize Virtual Filesystem for mcp:// URI support
   */
  private async initializeVirtualFilesystem(): Promise<void> {
    const vfsConfig = this.extendedConfig?.virtualFilesystem

    if (!vfsConfig) return

    // Create or use provided resource registry
    const resourceRegistry = vfsConfig.resourceRegistry || new ResourceRegistry()

    // Create or use provided connection pool
    const connectionPool = vfsConfig.connectionPool || new MCPConnectionPool()

    // Create Virtual Filesystem
    this.virtualFs = new VirtualFilesystem(resourceRegistry, connectionPool, vfsConfig.config)

    await this.virtualFs.initialize()

    // logger.debug('Virtual Filesystem enabled for DuckDB') // Disabled to avoid STDIO interference
  }

  /**
   * Execute a SQL query with Virtual Filesystem support
   */
  async executeQueryWithVFS<T = any>(sql: string, params?: any[]): Promise<T[]> {
    // If VFS is enabled, preprocess the query
    if (this.virtualFs) {
      sql = await this.virtualFs.processQuery(sql)
    }

    // Execute the transformed query
    return this.executeQuery(sql, params)
  }

  /**
   * Load DuckPGQ extension for Property Graph queries
   *
   * Supports multiple installation sources:
   * - community: Official DuckDB community repository (default)
   * - edge: Edge/nightly builds for experimental DuckDB versions
   * - custom: Custom repository URL specified in DUCKPGQ_CUSTOM_REPO
   *
   * Environment variables:
   * - DUCKPGQ_SOURCE: Installation source (community/edge/custom)
   * - DUCKPGQ_CUSTOM_REPO: Custom repository URL (when source=custom)
   * - DUCKPGQ_VERSION: Specific version to install (optional)
   * - DUCKPGQ_STRICT_MODE: If true, throw error on load failure
   *
   * @throws Error if DUCKPGQ_STRICT_MODE=true and load fails
   */
  private async loadDuckPGQ(): Promise<void> {
    if (!this.connection) {
      logger.warn('Cannot load DuckPGQ: connection not established')
      return
    }

    const source = process.env.DUCKPGQ_SOURCE || 'community'
    const customRepo = process.env.DUCKPGQ_CUSTOM_REPO
    const version = process.env.DUCKPGQ_VERSION
    const strictMode = process.env.DUCKPGQ_STRICT_MODE === 'true'

    let installCommand: string
    let sourceDescription: string = 'unknown source'

    try {
      // Build install command based on source
      switch (source) {
        case 'community':
          // Official DuckDB community repository
          installCommand = version
            ? `INSTALL duckpgq FROM community VERSION '${version}'`
            : 'INSTALL duckpgq FROM community'
          sourceDescription = 'DuckDB community repository'
          logger.info(
            `Loading DuckPGQ from ${sourceDescription}${version ? ` (version ${version})` : ''}`
          )
          break

        case 'edge':
          // Edge/nightly builds - typically from cwida repo direct downloads
          // Note: This requires the extension to be available via a public URL
          // Users should check https://github.com/cwida/duckpgq-extension for available builds
          installCommand = 'INSTALL duckpgq FROM community'
          sourceDescription = 'edge builds (via community with fallback)'
          logger.info(
            'Loading DuckPGQ from edge builds. ' +
              'Note: Edge builds must be published to community repo or use source=custom with DUCKPGQ_CUSTOM_REPO'
          )
          break

        case 'custom':
          // Custom repository URL
          if (!customRepo) {
            const error = new Error(
              'DUCKPGQ_SOURCE=custom requires DUCKPGQ_CUSTOM_REPO environment variable'
            )
            if (strictMode) throw error
            logger.warn(error.message)
            return
          }
          installCommand = `INSTALL duckpgq FROM '${customRepo}'`
          sourceDescription = `custom repository (${customRepo})`
          logger.info(`Loading DuckPGQ from ${sourceDescription}`)
          break

        default: {
          const error = new Error(
            `Invalid DUCKPGQ_SOURCE: ${source}. Must be one of: community, edge, custom`
          )
          if (strictMode) throw error
          logger.warn(error.message)
          return
        }
      }

      // Execute install and load commands
      await this.connection.run(`
        ${installCommand};
        LOAD duckpgq;
      `)

      // Success! Log available features
      logger.info(
        `DuckPGQ extension loaded successfully from ${sourceDescription}. ` +
          'Property Graph features available: GRAPH_TABLE syntax, fixed-length paths, ' +
          'ANY SHORTEST paths (with ->* syntax), bounded quantifiers (->{n,m}), ' +
          'Kleene operators when used with ANY SHORTEST. ' +
          'Note: Standalone Kleene operators (->*, ->+) without ANY SHORTEST may not work in all versions. ' +
          'Run npm run test:duckpgq:syntax to validate your configuration.'
      )
    } catch (error: any) {
      const errorMessage = error?.message || String(error)

      // Check if this is a known compatibility issue
      const isCompatibilityIssue =
        errorMessage.includes('HTTP 404') || errorMessage.includes('duckpgq')
      const isDuckDB14x = true // We're using DuckDB 1.4.x

      if (isCompatibilityIssue && isDuckDB14x && source === 'community') {
        // Expected issue: DuckPGQ community binaries not yet available for DuckDB 1.4.x
        logger.info(
          'DuckPGQ community binaries not yet available for DuckDB 1.4.x (as of 2025-10-20). ' +
            'This is expected and non-blocking. Options: ' +
            '1) Wait for official 1.4.x release, ' +
            '2) Use DUCKPGQ_SOURCE=edge (if available), ' +
            '3) Use DUCKPGQ_SOURCE=custom with a compatible build. ' +
            'Database continues to work normally for non-graph queries. ' +
            'Set ENABLE_DUCKPGQ=false to suppress this message. ' +
            'See: https://github.com/cwida/duckpgq-extension/issues/276'
        )

        // Don't throw in non-strict mode for this expected case
        if (strictMode) {
          throw new Error(
            `DuckPGQ strict mode enabled but extension unavailable for DuckDB 1.4.x. ` +
              `Try DUCKPGQ_SOURCE=edge or custom. Original error: ${errorMessage}`
          )
        }
      } else {
        // Unexpected error
        logger.warn(
          `Failed to load DuckPGQ from ${sourceDescription}: ${errorMessage}. ` +
            'Database will continue without graph features.'
        )

        if (strictMode) {
          throw new Error(`DuckPGQ strict mode enabled but load failed: ${errorMessage}`)
        }
      }

      // In non-strict mode, continue without DuckPGQ
      // Database is still functional for non-graph queries
    }
  }

  /**
   * Configure S3 credentials for DuckDB
   */
  private async configureS3(): Promise<void> {
    if (!this.connection || !this.config.s3Config) {
      return
    }

    let { endpoint } = this.config.s3Config
    const { accessKey, secretKey, region, useSSL } = this.config.s3Config

    // We only call this method when accessKey and secretKey are present
    if (!accessKey || !secretKey) {
      return
    }

    // Determine which endpoint to use based on execution context
    // If we're in a Railway/production environment, use private endpoint
    // Otherwise, use public endpoint for local testing
    if (!endpoint) {
      // Check if we're in Railway (production) environment
      const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME
      const isProduction = process.env.NODE_ENV === 'production'

      if (isRailway || isProduction) {
        // Use private endpoint for internal communication
        endpoint = process.env.MINIO_PRIVATE_ENDPOINT
        // Logging disabled to prevent JSON-RPC corruption
        // logger.debug('Using MinIO private endpoint for internal communication')
      } else {
        // Use public endpoint for local development
        endpoint = process.env.MINIO_PUBLIC_ENDPOINT
        // Logging disabled to prevent JSON-RPC corruption
        // logger.debug('Using MinIO public endpoint for local development')
      }
    }

    // Escape all S3 parameters to prevent SQL injection
    const sql = `
      CREATE SECRET IF NOT EXISTS s3_secret (
        TYPE S3,
        KEY_ID ${escapeString(accessKey)},
        SECRET ${escapeString(secretKey)},
        ${endpoint ? `ENDPOINT ${escapeString(endpoint)},` : ''}
        REGION ${escapeString(region)},
        USE_SSL ${useSSL}
      )
    `

    await this.executeQuery(sql)
    // S3 configuration applied successfully
  }

  /**
   * Execute a SQL query and return results
   */
  async executeQuery<T = any>(sql: string, _params?: any[]): Promise<T[]> {
    if (!this.isInitialized || !this.connection) {
      throw new Error('Database not initialized. Call initialize() first.')
    }

    // Start timing
    const startTime = performance.now()

    try {
      const result = await this.connection.run(sql)
      const rows = await result.getRowObjectsJson()

      // Record metrics
      const executionTimeMs = performance.now() - startTime
      const metricsCollector = getMetricsCollector()
      metricsCollector.recordQuery(
        sql,
        executionTimeMs,
        rows.length,
        undefined // Will add space ID support later
      )

      return rows as T[]
    } catch (error: any) {
      // Record failed query metrics
      const executionTimeMs = performance.now() - startTime
      const metricsCollector = getMetricsCollector()
      metricsCollector.recordQuery(sql, executionTimeMs, 0, undefined)

      throw new Error(`Query failed: ${error.message}`)
    }
  }

  /**
   * Execute a SQL query and return a single result
   */
  async executeScalar<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const results = await this.executeQuery<T>(sql, params)
    return results.length > 0 ? results[0] : null
  }

  /**
   * Get database schema information
   */
  async getSchema(): Promise<any[]> {
    const sql = `
      SELECT 
        table_schema,
        table_name,
        table_type
      FROM information_schema.tables
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY table_schema, table_name
    `
    return this.executeQuery(sql)
  }

  /**
   * Get columns for a specific table
   */
  async getTableColumns(tableName: string, schema: string = 'main'): Promise<any[]> {
    const sql = `
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = ${escapeString(schema)}
        AND table_name = ${escapeString(tableName)}
      ORDER BY ordinal_position
    `
    return this.executeQuery(sql)
  }

  /**
   * Create a table from JSON data
   */
  async createTableFromJSON(tableName: string, jsonData: any[]): Promise<void> {
    // DuckDB requires JSON data to be passed as VALUES, not read_json_auto which expects a file
    if (jsonData.length === 0) {
      throw new Error('Cannot create table from empty JSON array')
    }

    // Get the keys from the first object to define columns
    const keys = Object.keys(jsonData[0])
    const columns = keys.map((key) => `${escapeIdentifier(key)} VARCHAR`).join(', ')

    // Create the table
    await this.executeQuery(`CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} (${columns})`)

    // Insert data
    for (const row of jsonData) {
      const values = keys
        .map((key) => {
          const value = row[key]
          if (value === null || value === undefined) {
            return 'NULL'
          }
          if (typeof value === 'string') {
            return escapeString(value)
          }
          return String(value)
        })
        .join(', ')

      await this.executeQuery(`INSERT INTO ${escapeIdentifier(tableName)} VALUES (${values})`)
    }
  }

  /**
   * Read a Parquet file
   */
  async readParquet(path: string, limit?: number): Promise<any[]> {
    let sql = `SELECT * FROM read_parquet(${escapeString(path)})`
    if (limit) {
      sql += ` LIMIT ${Math.min(parseInt(String(limit), 10) || 1000, 100000)}`
    }
    return this.executeQuery(sql)
  }

  /**
   * Read a CSV file
   */
  async readCSV(path: string, limit?: number): Promise<any[]> {
    let sql = `SELECT * FROM read_csv_auto(${escapeString(path)})`
    if (limit) {
      sql += ` LIMIT ${Math.min(parseInt(String(limit), 10) || 1000, 100000)}`
    }
    return this.executeQuery(sql)
  }

  /**
   * Read a JSON file
   */
  async readJSON(path: string, limit?: number): Promise<any[]> {
    let sql = `SELECT * FROM read_json_auto(${escapeString(path)})`
    if (limit) {
      sql += ` LIMIT ${Math.min(parseInt(String(limit), 10) || 1000, 100000)}`
    }
    return this.executeQuery(sql)
  }

  /**
   * Export query results to a file
   */
  async exportToFile(
    sql: string,
    outputPath: string,
    format: 'parquet' | 'csv' | 'json'
  ): Promise<void> {
    let exportSql: string

    // Escape the output path to prevent SQL injection
    const safePath = escapeFilePath(outputPath)

    switch (format) {
      case 'parquet':
        exportSql = `COPY (${sql}) TO ${safePath} (FORMAT PARQUET)`
        break
      case 'csv':
        exportSql = `COPY (${sql}) TO ${safePath} (FORMAT CSV, HEADER)`
        break
      case 'json':
        exportSql = `COPY (${sql}) TO ${safePath} (FORMAT JSON)`
        break
      default:
        throw new Error(`Unsupported export format: ${format}`)
    }

    await this.executeQuery(exportSql)
  }

  /**
   * Check if a table exists
   */
  async tableExists(tableName: string, schema: string = 'main'): Promise<boolean> {
    // DuckDB Node API doesn't support prepared statements yet, use escaped strings
    const sql = `
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = ${escapeString(schema)}
        AND table_name = ${escapeString(tableName)}
    `
    const result = await this.executeScalar<{ count: string | number }>(sql)
    return result ? Number(result.count) > 0 : false
  }

  /**
   * Get row count for a table
   */
  async getRowCount(tableName: string, schema: string = 'main'): Promise<number> {
    const qualifiedName = `${escapeIdentifier(schema)}.${escapeIdentifier(tableName)}`
    const sql = `SELECT COUNT(*) as count FROM ${qualifiedName}`
    const result = await this.executeScalar<{ count: string | number }>(sql)
    return result ? Number(result.count) : 0
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      try {
        // Properly disconnect the DuckDB connection
        this.connection.disconnectSync()
      } catch {
        // Silently ignore disconnect errors during cleanup
      }

      // Nullify references for garbage collection
      this.connection = null
      this.instance = null
      this.isInitialized = false
    }
  }

  /**
   * Check if the service is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.connection !== null
  }

  /**
   * Get Virtual Filesystem instance
   */
  getVirtualFilesystem(): VirtualFilesystem | undefined {
    return this.virtualFs
  }

  /**
   * Check if Virtual Filesystem is enabled
   */
  hasVirtualFilesystem(): boolean {
    return this.virtualFs !== undefined
  }

  /**
   * List available MCP resources
   */
  listMCPResources(): string[] {
    return this.virtualFs?.listAvailableResources() || []
  }

  /**
   * Search for MCP resources by pattern
   */
  searchMCPResources(pattern: string): string[] {
    return this.virtualFs?.searchResources(pattern) || []
  }
}

// Singleton instance for convenience
let duckDBInstance: DuckDBService | null = null

/**
 * Get or create a singleton DuckDB service instance
 */
export async function getDuckDBService(config?: Partial<DuckDBConfig>): Promise<DuckDBService> {
  if (!duckDBInstance) {
    duckDBInstance = new DuckDBService(config)
    await duckDBInstance.initialize()
  }
  return duckDBInstance
}

/**
 * Create a new DuckDB service instance (non-singleton)
 */
export function createDuckDBService(config?: Partial<DuckDBConfig>): DuckDBService {
  return new DuckDBService(config)
}
