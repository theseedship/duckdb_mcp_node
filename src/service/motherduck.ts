/**
 * MotherDuck Cloud Service Integration
 * Provides connectivity to MotherDuck cloud instances
 */

import { DuckDBService } from '../duckdb/service.js'
import { logger } from '../utils/logger.js'

export interface MotherDuckConfig {
  token: string
  database?: string
  endpoint?: string
  timeout?: number
}

export interface MotherDuckStatus {
  connected: boolean
  database?: string
  cloudInstance?: string
  bytesUsed?: number
  bytesLimit?: number
  error?: string
}

/**
 * Service for managing MotherDuck cloud connections
 */
export class MotherDuckService {
  private duckdb: DuckDBService
  private config?: MotherDuckConfig
  private isConnected = false
  private attachedDatabase?: string

  constructor(duckdb: DuckDBService) {
    this.duckdb = duckdb
  }

  /**
   * Attach to MotherDuck cloud instance
   */
  async attach(config: MotherDuckConfig): Promise<void> {
    this.config = config

    try {
      // Build connection string
      const connectionString = this.buildConnectionString(config)

      // Execute ATTACH command
      await this.duckdb.executeQuery(`ATTACH '${connectionString}' AS motherduck`)

      // Set the database if specified
      if (config.database) {
        await this.duckdb.executeQuery(`USE motherduck.${config.database}`)
        this.attachedDatabase = config.database
      }

      this.isConnected = true
      logger.debug('Successfully connected to MotherDuck')
    } catch (error) {
      this.isConnected = false
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to connect to MotherDuck: ${errorMsg}`)
    }
  }

  /**
   * Detach from MotherDuck
   */
  async detach(): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected to MotherDuck')
    }

    try {
      await this.duckdb.executeQuery('DETACH motherduck')
      this.isConnected = false
      this.attachedDatabase = undefined
      this.config = undefined
      logger.debug('Successfully disconnected from MotherDuck')
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to disconnect from MotherDuck: ${errorMsg}`)
    }
  }

  /**
   * Get current MotherDuck status
   */
  async getStatus(): Promise<MotherDuckStatus> {
    if (!this.isConnected) {
      return {
        connected: false,
        error: 'Not connected to MotherDuck',
      }
    }

    try {
      // Get cloud storage info
      const storageInfo = await this.duckdb.executeQuery(`
        SELECT * FROM pragma_cloud_storage_info()
      `)

      return {
        connected: true,
        database: this.attachedDatabase,
        cloudInstance: this.config?.endpoint || 'app.motherduck.com',
        bytesUsed: storageInfo[0]?.bytes_used,
        bytesLimit: storageInfo[0]?.bytes_limit,
      }
    } catch (error) {
      return {
        connected: this.isConnected,
        database: this.attachedDatabase,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * List databases in MotherDuck
   */
  async listDatabases(): Promise<string[]> {
    if (!this.isConnected) {
      throw new Error('Not connected to MotherDuck')
    }

    try {
      const result = await this.duckdb.executeQuery(`
        SELECT database_name
        FROM motherduck.information_schema.schemata
        WHERE schema_name = 'main'
        GROUP BY database_name
      `)

      return result.map((row) => row.database_name)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to list MotherDuck databases: ${errorMsg}`)
    }
  }

  /**
   * Create a new database in MotherDuck
   */
  async createDatabase(name: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected to MotherDuck')
    }

    try {
      await this.duckdb.executeQuery(`CREATE DATABASE IF NOT EXISTS motherduck.${name}`)
      logger.debug(`Created MotherDuck database: ${name}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to create MotherDuck database: ${errorMsg}`)
    }
  }

  /**
   * Share a local table to MotherDuck
   */
  async shareTable(localTable: string, cloudTable?: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected to MotherDuck')
    }

    const targetTable = cloudTable || localTable
    const targetPath = this.attachedDatabase
      ? `motherduck.${this.attachedDatabase}.${targetTable}`
      : `motherduck.${targetTable}`

    try {
      await this.duckdb.executeQuery(
        `CREATE OR REPLACE TABLE ${targetPath} AS SELECT * FROM ${localTable}`
      )
      logger.debug(`Shared table ${localTable} to MotherDuck as ${targetPath}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to share table to MotherDuck: ${errorMsg}`)
    }
  }

  /**
   * Import a table from MotherDuck to local
   */
  async importTable(cloudTable: string, localTable?: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected to MotherDuck')
    }

    const targetTable = localTable || cloudTable
    const sourcePath = this.attachedDatabase
      ? `motherduck.${this.attachedDatabase}.${cloudTable}`
      : `motherduck.${cloudTable}`

    try {
      await this.duckdb.executeQuery(
        `CREATE OR REPLACE TABLE ${targetTable} AS SELECT * FROM ${sourcePath}`
      )
      logger.debug(`Imported table ${sourcePath} from MotherDuck as ${targetTable}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to import table from MotherDuck: ${errorMsg}`)
    }
  }

  /**
   * Execute a query on MotherDuck
   */
  async query(sql: string): Promise<any[]> {
    if (!this.isConnected) {
      throw new Error('Not connected to MotherDuck')
    }

    try {
      // Prefix tables with motherduck schema if not already qualified
      const qualifiedSql = this.qualifyTablesForMotherDuck(sql)
      return await this.duckdb.executeQuery(qualifiedSql)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`MotherDuck query failed: ${errorMsg}`)
    }
  }

  /**
   * Build MotherDuck connection string
   */
  private buildConnectionString(config: MotherDuckConfig): string {
    // MotherDuck connection format: md:[database]?motherduck_token=<token>
    let connectionString = 'md:'

    if (config.database) {
      connectionString += config.database
    }

    connectionString += `?motherduck_token=${config.token}`

    if (config.endpoint && config.endpoint !== 'app.motherduck.com') {
      connectionString += `&motherduck_endpoint=${config.endpoint}`
    }

    return connectionString
  }

  /**
   * Qualify table names for MotherDuck
   */
  private qualifyTablesForMotherDuck(sql: string): string {
    // Simple implementation - in production, use proper SQL parser
    if (sql.toLowerCase().includes('motherduck.')) {
      return sql // Already qualified
    }

    // For now, return as-is and let DuckDB handle it
    // A full implementation would parse and rewrite the SQL
    return sql
  }

  /**
   * Check if connected to MotherDuck
   */
  isAttached(): boolean {
    return this.isConnected
  }

  /**
   * Get current configuration
   */
  getConfig(): MotherDuckConfig | undefined {
    return this.config
  }
}
