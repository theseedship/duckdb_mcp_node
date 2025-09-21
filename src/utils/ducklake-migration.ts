/**
 * DuckLake Migration Utilities
 * @internal - Helper functions for migrating data to DuckLake format
 */

import { DuckDBService } from '../duckdb/service.js'
import { DuckLakeService } from '../service/ducklake.js'
import { SpaceContextFactory } from '../context/SpaceContext.js'
import { DuckLakeSpaceAdapter } from '../adapters/DuckLakeSpaceAdapter.js'
import { logger } from './logger.js'
import * as fs from 'fs/promises'
import * as path from 'path'

export interface MigrationOptions {
  source: string | string[]
  catalogName: string
  tableName: string
  spaceId?: string
  format?: 'DELTA' | 'ICEBERG'
  partitionBy?: string[]
  overwrite?: boolean
  validateSchema?: boolean
  batchSize?: number
  compressionType?: 'ZSTD' | 'SNAPPY' | 'LZ4' | 'GZIP' | 'NONE'
}

export interface MigrationResult {
  success: boolean
  tableName: string
  rowCount: number
  version: number
  duration: number
  errors?: string[]
}

/**
 * Main migration utility class
 */
export class DuckLakeMigration {
  private ducklakeService: DuckLakeService
  private adapter?: DuckLakeSpaceAdapter

  constructor(
    private duckdb: DuckDBService,
    private spaceFactory?: SpaceContextFactory
  ) {
    this.ducklakeService = new DuckLakeService(duckdb)
    if (spaceFactory) {
      this.adapter = new DuckLakeSpaceAdapter(duckdb)
    }
  }

  /**
   * Migrate Parquet files to DuckLake
   */
  async migrateParquet(options: MigrationOptions): Promise<MigrationResult> {
    const startTime = Date.now()
    const errors: string[] = []

    try {
      // Normalize source to array
      const sources = Array.isArray(options.source) ? options.source : [options.source]

      // Validate all source files exist
      for (const source of sources) {
        try {
          await fs.access(source)
        } catch {
          errors.push(`Source file not found: ${source}`)
        }
      }

      if (errors.length > 0) {
        return {
          success: false,
          tableName: options.tableName,
          rowCount: 0,
          version: 0,
          duration: Date.now() - startTime,
          errors,
        }
      }

      // Get or create catalog
      let catalog = await this.ducklakeService.getCatalog(options.catalogName)
      if (!catalog) {
        const catalogLocation = `s3://ducklake/${options.catalogName}`
        catalog = await this.ducklakeService.createCatalog(options.catalogName, catalogLocation, {
          format: options.format || 'DELTA',
          compressionType: options.compressionType || 'ZSTD',
          versioning: true,
        })
      }

      // Prepare table name with space context if needed
      let qualifiedTableName = options.tableName
      if (options.spaceId && this.spaceFactory) {
        const space = await this.spaceFactory.getOrCreate(options.spaceId, {
          ducklake: {
            enabled: true,
            format: options.format || 'DELTA',
            catalogLocation: catalog.location,
          },
        })
        qualifiedTableName = space.qualifyTableName(options.tableName)
      }

      // Drop existing table if overwrite is specified
      if (options.overwrite) {
        try {
          await this.duckdb.executeQuery(`DROP TABLE IF EXISTS ${qualifiedTableName}`)
        } catch (error) {
          logger.warn(`Could not drop table ${qualifiedTableName}: ${error}`)
        }
      }

      // Create union query for multiple files
      const unionQuery = sources
        .map((source) => `SELECT * FROM read_parquet('${source}')`)
        .join(' UNION ALL ')

      // Get schema from first file if validation is needed
      if (options.validateSchema) {
        const schemaResult = await this.duckdb.executeQuery(`
          SELECT column_name, data_type
          FROM (DESCRIBE SELECT * FROM read_parquet('${sources[0]}'))
        `)
        logger.debug(`Schema validation: ${JSON.stringify(schemaResult)}`)
      }

      // Create table with partitioning if specified
      let createTableQuery = `CREATE TABLE IF NOT EXISTS ${qualifiedTableName} AS `
      if (options.partitionBy && options.partitionBy.length > 0) {
        createTableQuery += `SELECT * FROM (${unionQuery}) PARTITION BY (${options.partitionBy.join(', ')})`
      } else {
        createTableQuery += unionQuery
      }

      // Execute migration
      await this.duckdb.executeQuery(createTableQuery)

      // Get row count
      const countResult = await this.duckdb.executeQuery(
        `SELECT COUNT(*) as count FROM ${qualifiedTableName}`
      )
      const rowCount = countResult[0].count

      // Create initial Delta log entry
      const version = await catalog.commitTransaction(
        qualifiedTableName,
        {
          additions: sources,
          deletions: [],
          metadata: {
            operation: 'MIGRATE_FROM_PARQUET',
            sources: sources,
            rowCount: rowCount,
            migratedAt: new Date().toISOString(),
            spaceId: options.spaceId,
            partitionBy: options.partitionBy,
          },
        },
        'CREATE'
      )

      logger.debug(
        `Successfully migrated ${rowCount} rows to ${qualifiedTableName} (version ${version})`
      )

      return {
        success: true,
        tableName: qualifiedTableName,
        rowCount,
        version,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      logger.error('Migration failed:', error)
      errors.push(error instanceof Error ? error.message : 'Unknown error')

      return {
        success: false,
        tableName: options.tableName,
        rowCount: 0,
        version: 0,
        duration: Date.now() - startTime,
        errors,
      }
    }
  }

  /**
   * Migrate CSV files to DuckLake
   */
  async migrateCSV(options: MigrationOptions & { csvOptions?: any }): Promise<MigrationResult> {
    const startTime = Date.now()
    const errors: string[] = []

    try {
      // Normalize source to array
      const sources = Array.isArray(options.source) ? options.source : [options.source]

      // Build CSV read options
      const csvOptions = options.csvOptions || {}
      const readCsvOptions = Object.entries(csvOptions)
        .map(([key, value]) => `${key}=${typeof value === 'string' ? `'${value}'` : value}`)
        .join(', ')

      // Create union query for CSV files
      const unionQuery = sources
        .map((source) => {
          const optStr = readCsvOptions ? `, ${readCsvOptions}` : ''
          return `SELECT * FROM read_csv('${source}'${optStr})`
        })
        .join(' UNION ALL ')

      // Use the same migration logic as Parquet
      return await this.migrateFromQuery({
        ...options,
        query: unionQuery,
        operation: 'MIGRATE_FROM_CSV',
      })
    } catch (error) {
      logger.error('CSV migration failed:', error)
      errors.push(error instanceof Error ? error.message : 'Unknown error')

      return {
        success: false,
        tableName: options.tableName,
        rowCount: 0,
        version: 0,
        duration: Date.now() - startTime,
        errors,
      }
    }
  }

  /**
   * Migrate from a SQL query result to DuckLake
   */
  async migrateFromQuery(
    options: MigrationOptions & { query: string; operation?: string }
  ): Promise<MigrationResult> {
    const startTime = Date.now()
    const errors: string[] = []

    try {
      // Get or create catalog
      let catalog = await this.ducklakeService.getCatalog(options.catalogName)
      if (!catalog) {
        const catalogLocation = `s3://ducklake/${options.catalogName}`
        catalog = await this.ducklakeService.createCatalog(options.catalogName, catalogLocation, {
          format: options.format || 'DELTA',
          compressionType: options.compressionType || 'ZSTD',
          versioning: true,
        })
      }

      // Prepare table name
      let qualifiedTableName = options.tableName
      if (options.spaceId && this.spaceFactory) {
        const space = await this.spaceFactory.getOrCreate(options.spaceId, {
          ducklake: {
            enabled: true,
            format: options.format || 'DELTA',
          },
        })
        qualifiedTableName = space.qualifyTableName(options.tableName)
      }

      // Drop if overwrite
      if (options.overwrite) {
        await this.duckdb.executeQuery(`DROP TABLE IF EXISTS ${qualifiedTableName}`)
      }

      // Create table from query
      let createTableQuery = `CREATE TABLE IF NOT EXISTS ${qualifiedTableName} AS `
      if (options.partitionBy && options.partitionBy.length > 0) {
        createTableQuery += `SELECT * FROM (${options.query}) PARTITION BY (${options.partitionBy.join(', ')})`
      } else {
        createTableQuery += options.query
      }

      await this.duckdb.executeQuery(createTableQuery)

      // Get row count
      const countResult = await this.duckdb.executeQuery(
        `SELECT COUNT(*) as count FROM ${qualifiedTableName}`
      )
      const rowCount = countResult[0].count

      // Create Delta log entry
      const version = await catalog.commitTransaction(
        qualifiedTableName,
        {
          additions: [],
          deletions: [],
          metadata: {
            operation: options.operation || 'MIGRATE_FROM_QUERY',
            query: options.query.substring(0, 500), // Truncate for storage
            rowCount: rowCount,
            migratedAt: new Date().toISOString(),
            spaceId: options.spaceId,
            partitionBy: options.partitionBy,
          },
        },
        'CREATE'
      )

      return {
        success: true,
        tableName: qualifiedTableName,
        rowCount,
        version,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      logger.error('Query migration failed:', error)
      errors.push(error instanceof Error ? error.message : 'Unknown error')

      return {
        success: false,
        tableName: options.tableName,
        rowCount: 0,
        version: 0,
        duration: Date.now() - startTime,
        errors,
      }
    }
  }

  /**
   * Batch migrate multiple tables
   */
  async batchMigrate(
    migrations: MigrationOptions[]
  ): Promise<{ total: number; successful: number; failed: number; results: MigrationResult[] }> {
    const results: MigrationResult[] = []
    let successful = 0
    let failed = 0

    for (const migration of migrations) {
      let result: MigrationResult

      // Determine migration type by file extension
      const source = Array.isArray(migration.source) ? migration.source[0] : migration.source
      const ext = path.extname(source).toLowerCase()

      if (ext === '.parquet') {
        result = await this.migrateParquet(migration)
      } else if (ext === '.csv') {
        result = await this.migrateCSV(migration)
      } else {
        result = {
          success: false,
          tableName: migration.tableName,
          rowCount: 0,
          version: 0,
          duration: 0,
          errors: [`Unsupported file type: ${ext}`],
        }
      }

      results.push(result)
      if (result.success) {
        successful++
      } else {
        failed++
      }
    }

    return {
      total: migrations.length,
      successful,
      failed,
      results,
    }
  }

  /**
   * Validate migration before executing
   */
  async validateMigration(options: MigrationOptions): Promise<{
    valid: boolean
    warnings: string[]
    errors: string[]
  }> {
    const warnings: string[] = []
    const errors: string[] = []

    // Check source files
    const sources = Array.isArray(options.source) ? options.source : [options.source]
    for (const source of sources) {
      try {
        const stats = await fs.stat(source)
        if (stats.size > 1_000_000_000) {
          warnings.push(
            `Large file detected (${source}): ${(stats.size / 1_000_000_000).toFixed(2)}GB`
          )
        }
      } catch {
        errors.push(`Source file not accessible: ${source}`)
      }
    }

    // Check catalog
    const catalog = await this.ducklakeService.getCatalog(options.catalogName)
    if (!catalog) {
      warnings.push(`Catalog '${options.catalogName}' will be created`)
    }

    // Check table existence
    if (!options.overwrite) {
      try {
        const result = await this.duckdb.executeQuery(
          `SELECT 1 FROM information_schema.tables WHERE table_name = '${options.tableName}' LIMIT 1`
        )
        if (result.length > 0) {
          errors.push(
            `Table '${options.tableName}' already exists. Use overwrite: true to replace.`
          )
        }
      } catch {
        // Table doesn't exist, which is fine
      }
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
    }
  }
}

/**
 * Create migration tool handlers for MCP
 */
export function createMigrationToolHandlers(
  duckdb: DuckDBService,
  spaceFactory?: SpaceContextFactory
) {
  const migration = new DuckLakeMigration(duckdb, spaceFactory)

  return {
    'ducklake.migrate_parquet': (input: any) => migration.migrateParquet(input),
    'ducklake.migrate_csv': (input: any) => migration.migrateCSV(input),
    'ducklake.migrate_query': (input: any) => migration.migrateFromQuery(input),
    'ducklake.batch_migrate': (input: any) => migration.batchMigrate(input),
    'ducklake.validate_migration': (input: any) => migration.validateMigration(input),
  }
}
