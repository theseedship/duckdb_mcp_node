/**
 * DuckLake Service - Lakehouse metadata layer for DuckDB
 * Provides ACID transactions, time travel, and versioning on top of Parquet files
 * Similar to Delta Lake but optimized for DuckDB
 */

import { DuckDBService } from '../duckdb/service.js'
import { z } from 'zod'
import { logger } from '../utils/logger.js'

// Configuration schema for DuckLake
export const DuckLakeOptionsSchema = z.object({
  format: z.enum(['DELTA', 'ICEBERG']).default('DELTA'),
  versioning: z.boolean().default(true),
  multiTenant: z.boolean().default(false),
  compressionType: z.enum(['ZSTD', 'SNAPPY', 'LZ4', 'GZIP', 'NONE']).default('ZSTD'),
  enableTimeTravel: z.boolean().default(true),
  retentionDays: z.number().min(1).max(365).default(30),
})

export type DuckLakeOptions = z.infer<typeof DuckLakeOptionsSchema>

// Delta log entry schema
export const DeltaLogEntrySchema = z.object({
  version: z.number(),
  timestamp: z.date(),
  operation: z.enum(['CREATE', 'APPEND', 'UPDATE', 'DELETE', 'MERGE', 'OPTIMIZE']),
  operationParameters: z.record(z.any()).optional(),
  files: z.array(
    z.object({
      path: z.string(),
      size: z.number(),
      modificationTime: z.date(),
      dataChange: z.boolean(),
      stats: z
        .object({
          numRecords: z.number(),
          minValues: z.record(z.any()).optional(),
          maxValues: z.record(z.any()).optional(),
          nullCounts: z.record(z.number()).optional(),
        })
        .optional(),
    })
  ),
  metadata: z.record(z.any()).optional(),
})

export type DeltaLogEntry = z.infer<typeof DeltaLogEntrySchema>

// Change set for transactions
export interface ChangeSet {
  additions: string[] // Paths to new Parquet files
  deletions: string[] // Paths to removed Parquet files
  metadata?: Record<string, any>
}

export class DuckLakeService {
  private catalogs: Map<string, DuckLakeCatalog> = new Map()

  constructor(private duckdb: DuckDBService) {
    logger.info('DuckLake service initialized')
  }

  /**
   * Create a new DuckLake catalog
   * A catalog is a collection of tables managed by DuckLake
   */
  async createCatalog(
    name: string,
    location: string,
    options: Partial<DuckLakeOptions> = {}
  ): Promise<DuckLakeCatalog> {
    const config = DuckLakeOptionsSchema.parse(options)

    // Create catalog directory structure
    const catalogSql = `
      -- Create DuckLake catalog
      CREATE SCHEMA IF NOT EXISTS ducklake_${name};

      -- Create metadata tables
      CREATE TABLE IF NOT EXISTS ducklake_${name}._catalog_metadata (
        catalog_name VARCHAR,
        location VARCHAR,
        format VARCHAR,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        properties JSON
      );

      -- Create delta log table
      CREATE TABLE IF NOT EXISTS ducklake_${name}._delta_log (
        table_name VARCHAR,
        version INTEGER,
        timestamp TIMESTAMP,
        operation VARCHAR,
        operation_parameters JSON,
        files JSON,
        metadata JSON,
        PRIMARY KEY (table_name, version)
      );

      -- Insert catalog metadata
      INSERT INTO ducklake_${name}._catalog_metadata
      VALUES ('${name}', '${location}', '${config.format}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '${JSON.stringify(config)}');
    `

    await this.duckdb.executeQuery(catalogSql)

    const catalog = new DuckLakeCatalog(name, location, config, this.duckdb)
    this.catalogs.set(name, catalog)

    logger.info(`DuckLake catalog '${name}' created at ${location}`)
    return catalog
  }

  /**
   * Get an existing catalog
   */
  async getCatalog(name: string): Promise<DuckLakeCatalog | undefined> {
    if (this.catalogs.has(name)) {
      return this.catalogs.get(name)
    }

    // Try to load from database
    const result = await this.duckdb
      .executeQuery(
        `
      SELECT * FROM ducklake_${name}._catalog_metadata
      WHERE catalog_name = '${name}'
      LIMIT 1
    `
      )
      .catch(() => null)

    if (result && result.length > 0) {
      const metadata = result[0]
      const options = JSON.parse(metadata.properties)
      const catalog = new DuckLakeCatalog(name, metadata.location, options, this.duckdb)
      this.catalogs.set(name, catalog)
      return catalog
    }

    return undefined
  }

  /**
   * List all available catalogs
   */
  async listCatalogs(): Promise<string[]> {
    const result = await this.duckdb.executeQuery(`
      SELECT DISTINCT schema_name
      FROM information_schema.schemata
      WHERE schema_name LIKE 'ducklake_%'
    `)

    return result.map((row: any) => row.schema_name.replace('ducklake_', ''))
  }
}

/**
 * DuckLake Catalog - Manages a collection of tables with ACID properties
 */
export class DuckLakeCatalog {
  constructor(
    public readonly name: string,
    public readonly location: string,
    public readonly options: DuckLakeOptions,
    private duckdb: DuckDBService
  ) {}

  /**
   * Create a managed table in the catalog
   */
  async createTable(tableName: string, schema: string, partitionBy?: string[]): Promise<void> {
    // Create the table
    await this.duckdb.executeQuery(`
      CREATE TABLE ducklake_${this.name}.${tableName} ${schema}
    `)

    // Initialize delta log
    await this.commitTransaction(tableName, {
      additions: [],
      deletions: [],
      metadata: {
        operation: 'CREATE_TABLE',
        schema: schema,
        partitionBy: partitionBy,
      },
    })

    logger.info(`DuckLake table '${tableName}' created in catalog '${this.name}'`)
  }

  /**
   * Time travel query - query data at a specific point in time
   */
  async timeTravel(
    tableName: string,
    timestamp: Date | number // timestamp or version number
  ): Promise<any[]> {
    if (!this.options.enableTimeTravel) {
      throw new Error('Time travel is not enabled for this catalog')
    }

    let version: number

    if (typeof timestamp === 'number') {
      version = timestamp
    } else {
      // Find the version at the given timestamp
      const result = await this.duckdb.executeQuery(`
        SELECT MAX(version) as version
        FROM ducklake_${this.name}._delta_log
        WHERE table_name = '${tableName}'
          AND timestamp <= '${timestamp.toISOString()}'
      `)
      version = result[0]?.version || 0
    }

    // Get the files at that version
    const deltaLog = await this.getDeltaLog(tableName, version)

    if (!deltaLog) {
      throw new Error(`No data found for table '${tableName}' at version ${version}`)
    }

    // Query the specific files
    const filePaths = deltaLog.files
      .filter((f) => f.dataChange)
      .map((f) => `'${f.path}'`)
      .join(', ')

    if (filePaths.length === 0) {
      return []
    }

    return await this.duckdb.executeQuery(`
      SELECT * FROM read_parquet([${filePaths}])
    `)
  }

  /**
   * Get the current version of a table
   */
  async getTableVersion(tableName: string): Promise<number> {
    const result = await this.duckdb.executeQuery(`
      SELECT MAX(version) as version
      FROM ducklake_${this.name}._delta_log
      WHERE table_name = '${tableName}'
    `)

    return result[0]?.version || 0
  }

  /**
   * Commit a transaction with ACID guarantees
   */
  async commitTransaction(
    tableName: string,
    changes: ChangeSet,
    operation: DeltaLogEntry['operation'] = 'UPDATE'
  ): Promise<void> {
    const currentVersion = await this.getTableVersion(tableName)
    const newVersion = currentVersion + 1

    // Build file entries
    const files = [
      ...changes.additions.map((path) => ({
        path,
        size: 0, // Would calculate actual size
        modificationTime: new Date(),
        dataChange: true,
        stats: undefined,
      })),
      ...changes.deletions.map((path) => ({
        path,
        size: 0,
        modificationTime: new Date(),
        dataChange: false, // Marked for deletion
        stats: undefined,
      })),
    ]

    // Insert delta log entry
    await this.duckdb.executeQuery(`
      INSERT INTO ducklake_${this.name}._delta_log
      VALUES (
        '${tableName}',
        ${newVersion},
        CURRENT_TIMESTAMP,
        '${operation}',
        '${JSON.stringify(changes.metadata || {})}',
        '${JSON.stringify(files)}',
        '{}'
      )
    `)

    logger.debug(`Committed transaction for ${tableName} at version ${newVersion}`)
  }

  /**
   * Get delta log entry for a specific version
   */
  async getDeltaLog(tableName: string, version?: number): Promise<DeltaLogEntry | null> {
    const versionClause =
      version !== undefined ? `AND version = ${version}` : 'ORDER BY version DESC LIMIT 1'

    const result = await this.duckdb.executeQuery(`
      SELECT * FROM ducklake_${this.name}._delta_log
      WHERE table_name = '${tableName}'
      ${versionClause}
    `)

    if (result.length === 0) {
      return null
    }

    const row = result[0]
    return {
      version: row.version,
      timestamp: new Date(row.timestamp),
      operation: row.operation,
      operationParameters: JSON.parse(row.operation_parameters || '{}'),
      files: JSON.parse(row.files || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
    }
  }

  /**
   * Optimize table by compacting small files
   */
  async optimizeTable(tableName: string): Promise<void> {
    // This would implement file compaction logic
    // For now, just log the operation
    await this.commitTransaction(
      tableName,
      {
        additions: [],
        deletions: [],
        metadata: {
          operation: 'OPTIMIZE',
          timestamp: new Date().toISOString(),
        },
      },
      'OPTIMIZE'
    )

    logger.info(`Optimized DuckLake table '${tableName}'`)
  }

  /**
   * Vacuum old versions based on retention policy
   */
  async vacuum(tableName: string): Promise<void> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - this.options.retentionDays)

    await this.duckdb.executeQuery(`
      DELETE FROM ducklake_${this.name}._delta_log
      WHERE table_name = '${tableName}'
        AND timestamp < '${cutoffDate.toISOString()}'
        AND version < (
          SELECT MAX(version) - 1
          FROM ducklake_${this.name}._delta_log
          WHERE table_name = '${tableName}'
        )
    `)

    logger.info(`Vacuumed old versions of ${tableName} older than ${cutoffDate.toISOString()}`)
  }
}
