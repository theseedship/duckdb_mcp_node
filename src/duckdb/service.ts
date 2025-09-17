import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api'
import { z } from 'zod'
import { escapeIdentifier, escapeString } from '../utils/sql-escape.js'

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
 * DuckDB service for executing queries and managing connections
 */
export class DuckDBService {
  private instance: DuckDBInstance | null = null
  private connection: DuckDBConnection | null = null
  private config: DuckDBConfig
  private isInitialized = false

  constructor(config?: Partial<DuckDBConfig>) {
    this.config = DuckDBConfigSchema.parse(config || {})
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

      // Skip extension loading for now to prevent timeouts
      // Extensions can be loaded on-demand when needed
      // TODO: Make extension loading lazy or async

      // Configure S3 if credentials provided
      if (this.config.s3Config?.accessKey && this.config.s3Config?.secretKey) {
        await this.configureS3()
      }

      this.isInitialized = true
      console.error('DuckDB initialized successfully')
    } catch (error) {
      console.error('Failed to initialize DuckDB:', error)
      throw error
    }
  }

  /**
   * Configure S3 credentials for DuckDB
   */
  private async configureS3(): Promise<void> {
    if (!this.connection || !this.config.s3Config) {
      return
    }

    const { endpoint, accessKey, secretKey, region, useSSL } = this.config.s3Config

    const sql = `
      CREATE SECRET IF NOT EXISTS s3_secret (
        TYPE S3,
        KEY_ID '${accessKey}',
        SECRET '${secretKey}',
        ${endpoint ? `ENDPOINT '${endpoint}',` : ''}
        REGION '${region}',
        USE_SSL ${useSSL}
      )
    `

    await this.executeQuery(sql)
    console.error('S3 configuration applied')
  }

  /**
   * Execute a SQL query and return results
   */
  async executeQuery<T = any>(sql: string, _params?: any[]): Promise<T[]> {
    if (!this.isInitialized || !this.connection) {
      throw new Error('Database not initialized. Call initialize() first.')
    }

    try {
      const result = await this.connection.run(sql)
      const rows = await result.getRowObjectsJson()
      return rows as T[]
    } catch (error: any) {
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

    switch (format) {
      case 'parquet':
        exportSql = `COPY (${sql}) TO '${outputPath}' (FORMAT PARQUET)`
        break
      case 'csv':
        exportSql = `COPY (${sql}) TO '${outputPath}' (FORMAT CSV, HEADER)`
        break
      case 'json':
        exportSql = `COPY (${sql}) TO '${outputPath}' (FORMAT JSON)`
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
    const sql = `
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = '${schema}'
        AND table_name = '${tableName}'
    `
    const result = await this.executeScalar<{ count: number }>(sql)
    return result ? result.count > 0 : false
  }

  /**
   * Get row count for a table
   */
  async getRowCount(tableName: string): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM ${escapeIdentifier(tableName)}`
    const result = await this.executeScalar<{ count: string | number }>(sql)
    return result ? Number(result.count) : 0
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      // Note: DuckDB node-api doesn't have explicit close methods yet
      // Just nullify references for garbage collection
      this.connection = null
      this.instance = null
      this.isInitialized = false
      console.error('DuckDB connection closed')
    }
  }

  /**
   * Check if the service is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.connection !== null
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
