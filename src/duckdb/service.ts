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
  // Engine-level sandbox posture. Controls which DuckDB filesystems / external
  // access are disabled AFTER extensions + S3 are set up.
  //  - 'off'         : no engine hardening (legacy behaviour)
  //  - 'no-local-fs' : disable LocalFileSystem + HTTPFileSystem (blocks arbitrary
  //                    local file read/write and http(s) SSRF) while keeping S3
  //  - 'strict'      : enable_external_access=false (blocks ALL external access,
  //                    including S3/httpfs) — for pure-compute deployments
  // When unset, resolves from MCP_SANDBOX, else defaults to 'no-local-fs' iff
  // MCP_SECURITY_MODE=production. NEVER keyed on NODE_ENV (would silently break
  // library-mode consumers that set NODE_ENV but not MCP_SECURITY_MODE).
  sandbox: z.enum(['off', 'no-local-fs', 'strict']).optional(),
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
  private _onagerLoaded = false
  private _sandboxLevel: 'off' | 'no-local-fs' | 'strict' = 'off'

  /**
   * Whether the Onager graph-analytics extension was successfully loaded.
   * Only true when ENABLE_ONAGER=true and the community binary loaded.
   * @since v1.6.0
   */
  get onagerLoaded(): boolean {
    return this._onagerLoaded
  }

  /**
   * The engine-level sandbox posture actually applied to this instance.
   * 'off' until initialize() runs. @since v1.7.0
   */
  get sandboxLevel(): 'off' | 'no-local-fs' | 'strict' {
    return this._sandboxLevel
  }

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

      // Load Onager graph-analytics extension (65 native graph table
      // functions: centrality, community, paths, link prediction, …).
      // Opt-IN (unlike DuckPGQ) because Onager is alpha (0.1.0-alpha.x)
      // and its API may change between releases. @since v1.6.0
      if (this.config.allowUnsignedExtensions && process.env.ENABLE_ONAGER === 'true') {
        await this.loadOnager()
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

      // Engine-level security hardening. MUST run last — after extensions (which
      // need INSTALL/LOAD) and S3 provisioning (CREATE SECRET writes to the local
      // secret store) have completed, because the sandbox disables exactly those
      // capabilities and the lock is one-way within the session.
      await this.applyEngineHardening()
    } catch (error) {
      logger.error('Failed to initialize DuckDB:', error)
      throw error
    }
  }

  /**
   * Resolve the effective sandbox level. Explicit config/env wins; otherwise
   * hardened iff MCP_SECURITY_MODE=production. Deliberately NOT keyed on
   * NODE_ENV. @since v1.7.0
   */
  private resolveSandboxLevel(): 'off' | 'no-local-fs' | 'strict' {
    const explicit = this.config.sandbox ?? process.env.MCP_SANDBOX
    if (explicit === 'off' || explicit === 'no-local-fs' || explicit === 'strict') {
      return explicit
    }
    return process.env.MCP_SECURITY_MODE === 'production' ? 'no-local-fs' : 'off'
  }

  /**
   * Apply engine-level sandboxing to the live connection. Validated on DuckDB
   * 1.5.4: disabling LocalFileSystem+HTTPFileSystem blocks arbitrary local file
   * read/write and http(s) SSRF while leaving S3FileSystem functional; 'strict'
   * uses enable_external_access=false (a one-way latch) to block all external
   * access. lock_configuration=true then prevents injected SQL from re-opening
   * the gate (e.g. SET s3_endpoint / SET disabled_filesystems). @since v1.7.0
   */
  private async applyEngineHardening(): Promise<void> {
    if (!this.connection) return
    const level = this.resolveSandboxLevel()
    this._sandboxLevel = level
    if (level === 'off') return

    try {
      if (level === 'strict') {
        if (this.config.s3Config?.accessKey) {
          logger.warn(
            'MCP_SANDBOX=strict disables all external access; configured S3/httpfs will be unreachable'
          )
        }
        await this.connection.run('SET enable_external_access=false')
      } else {
        // no-local-fs: block local disk + raw http(s); keep S3FileSystem.
        try {
          await this.connection.run(`SET disabled_filesystems='LocalFileSystem,HTTPFileSystem'`)
        } catch {
          // Fall back to at least blocking the unconditional local-file vector.
          await this.connection.run(`SET disabled_filesystems='LocalFileSystem'`)
        }
      }
      // Seal the configuration so a later statement cannot relax it.
      try {
        await this.connection.run('SET lock_configuration=true')
      } catch (lockError) {
        logger.warn('Could not lock DuckDB configuration after hardening:', lockError)
      }
    } catch (error) {
      // Hardening must fail CLOSED: if we cannot apply the sandbox we asked for,
      // refuse to initialize rather than silently run wide open.
      logger.error(`Failed to apply security sandbox (level=${level}):`, error)
      throw new Error(
        `Failed to apply security sandbox (level=${level}): ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      )
    }
  }

  /**
   * Defense-in-depth statement gate, enforced in every query path (so it also
   * covers library-mode consumers that bypass the MCP server's HITL handler).
   * The engine sandbox is the primary control; this blocks code-loading /
   * external-attach statements that the engine may still permit. @since v1.7.0
   */
  private enforceSandboxPolicy(sql: string): void {
    if (this._sandboxLevel === 'off') return
    const blocked: Array<[RegExp, string]> = [
      [/\bINSTALL\b/i, 'INSTALL'],
      [/\bLOAD\b/i, 'LOAD'],
      [/\bATTACH\b/i, 'ATTACH'],
    ]
    for (const [pattern, op] of blocked) {
      if (pattern.test(sql)) {
        throw new Error(
          `Operation ${op} is blocked by security sandbox (level=${this._sandboxLevel})`
        )
      }
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
   * Load the Onager graph-analytics extension (community).
   *
   * Onager (https://github.com/CogitatorTech/onager) ships ~65 native graph
   * table functions — centrality (pagerank, betweenness, katz, closeness…),
   * community detection (louvain, infomap, label_prop…), shortest paths
   * (dijkstra, bellman_ford, floyd_warshall), link prediction (adamic_adar,
   * jaccard…), graph metrics, MST, ego/k-hop subgraphs and more — callable
   * directly on edge tables without CREATE PROPERTY GRAPH.
   *
   * Opt-in via ENABLE_ONAGER=true because the extension is alpha:
   * - node ids must be BIGINT (cast with `column::BIGINT`)
   * - some functions bind only via named parameters (e.g. `source = 1`)
   * - not built for osx_amd64 / windows_amd64_mingw / WASM
   *
   * Environment variables:
   * - ENABLE_ONAGER: 'true' to install+load (default: off)
   * - ONAGER_STRICT_MODE: 'true' to throw on load failure (default: warn)
   *
   * Requires DuckDB >= 1.5.4 (first version with a published Onager binary
   * compatible with the current release line).
   *
   * @since v1.6.0
   */
  private async loadOnager(): Promise<void> {
    if (!this.connection) {
      logger.warn('Cannot load Onager: connection not established')
      return
    }

    const strictMode = process.env.ONAGER_STRICT_MODE === 'true'

    try {
      logger.info('Loading Onager graph-analytics extension from DuckDB community repository')
      await this.connection.run(`
        INSTALL onager FROM community;
        LOAD onager;
      `)
      this._onagerLoaded = true
      logger.info(
        'Onager extension loaded successfully. ~65 native graph table functions available ' +
          '(onager_ctr_* centrality, onager_cmm_* community, onager_pth_* paths, ' +
          'onager_lnk_* link prediction, onager_mtr_* metrics, onager_sub_* subgraphs, …). ' +
          'Note: node ids must be BIGINT; some functions require named parameters.'
      )
    } catch (error: any) {
      const errorMessage = error?.message || String(error)
      logger.warn(
        `Failed to load Onager: ${errorMessage}. ` +
          'Database continues without Onager graph analytics (DuckPGQ and the ' +
          'iterative-SQL graph tools are unaffected). Onager requires DuckDB >= 1.5.4 ' +
          'and is not built for all platforms. Set ENABLE_ONAGER=false to suppress.'
      )
      if (strictMode) {
        throw new Error(`Onager strict mode enabled but load failed: ${errorMessage}`)
      }
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

    // Defense-in-depth: enforced in all query paths, including library mode.
    this.enforceSandboxPolicy(sql)

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
