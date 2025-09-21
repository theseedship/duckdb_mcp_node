/**
 * DuckLake MCP Tools - ACID transactions and time travel for DuckDB
 * @internal
 */

import { z } from 'zod'
import { DuckDBService } from '../duckdb/service.js'
import { DuckLakeService } from '../service/ducklake.js'
import { SpaceContextFactory } from '../context/SpaceContext.js'
import { DuckLakeSpaceAdapter } from '../adapters/DuckLakeSpaceAdapter.js'
import { logger } from '../utils/logger.js'

/**
 * Input schema for ducklake.attach tool
 */
export const DuckLakeAttachInputSchema = z.object({
  spaceId: z.string().optional().describe('Space ID to attach DuckLake to'),
  catalogName: z.string().describe('Name for the DuckLake catalog'),
  catalogLocation: z.string().describe('S3/MinIO path for catalog data'),
  format: z.enum(['DELTA', 'ICEBERG']).default('DELTA').describe('Table format to use'),
  enableTimeTravel: z.boolean().default(true).describe('Enable time travel queries'),
  retentionDays: z.number().min(1).max(365).default(30).describe('Days to retain old versions'),
  compressionType: z
    .enum(['ZSTD', 'SNAPPY', 'LZ4', 'GZIP', 'NONE'])
    .default('ZSTD')
    .describe('Compression for Parquet files'),
  s3Config: z
    .object({
      endpoint: z.string().optional(),
      region: z.string().default('us-east-1'),
      accessKeyId: z.string().optional(),
      secretAccessKey: z.string().optional(),
      useSSL: z.boolean().default(true),
    })
    .optional()
    .describe('S3/MinIO configuration if not already set'),
})

export type DuckLakeAttachInput = z.infer<typeof DuckLakeAttachInputSchema>

/**
 * Input schema for ducklake.snapshots tool
 */
export const DuckLakeSnapshotsInputSchema = z.object({
  spaceId: z.string().optional().describe('Space ID for multi-tenant isolation'),
  catalogName: z.string().describe('DuckLake catalog name'),
  tableName: z.string().describe('Table to get snapshots for'),
  action: z
    .enum(['list', 'details', 'clone', 'rollback'])
    .default('list')
    .describe('Action to perform'),
  version: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Version number or timestamp for details/clone/rollback'),
  targetTableName: z.string().optional().describe('Target table name for clone operation'),
})

export type DuckLakeSnapshotsInput = z.infer<typeof DuckLakeSnapshotsInputSchema>

/**
 * Input schema for ducklake.time_travel tool
 */
export const DuckLakeTimeTravelInputSchema = z.object({
  spaceId: z.string().optional().describe('Space ID for multi-tenant isolation'),
  catalogName: z.string().describe('DuckLake catalog name'),
  tableName: z.string().describe('Table to query'),
  query: z.string().describe('SQL query to execute'),
  timestamp: z
    .union([z.number(), z.string()])
    .describe('Version number or ISO timestamp to query at'),
  limit: z.number().min(1).max(10000).default(100).describe('Maximum rows to return'),
})

export type DuckLakeTimeTravelInput = z.infer<typeof DuckLakeTimeTravelInputSchema>

/**
 * Handler implementations
 */
export class DuckLakeToolHandlers {
  private ducklakeService?: DuckLakeService
  private spaceFactory?: SpaceContextFactory
  private adapter?: DuckLakeSpaceAdapter

  constructor(private duckdb: DuckDBService) {
    // Lazy load DuckLake service on first use
  }

  /**
   * Get or create DuckLake service
   */
  private getDuckLakeService(): DuckLakeService {
    if (!this.ducklakeService) {
      this.ducklakeService = new DuckLakeService(this.duckdb)
    }
    return this.ducklakeService
  }

  /**
   * Set space factory for multi-tenant support
   */
  setSpaceFactory(factory: SpaceContextFactory): void {
    this.spaceFactory = factory
    this.adapter = new DuckLakeSpaceAdapter(this.duckdb)
  }

  /**
   * Attach a DuckLake catalog
   */
  async attach(input: DuckLakeAttachInput): Promise<any> {
    try {
      // Configure S3 if provided
      if (input.s3Config) {
        await this.configureS3(input.s3Config)
      }

      // If spaceId is provided, use space-aware attachment
      if (input.spaceId && this.spaceFactory && this.adapter) {
        const space = await this.spaceFactory.getOrCreate(input.spaceId, {
          ducklake: {
            enabled: true,
            format: input.format,
            enableTimeTravel: input.enableTimeTravel,
            retentionDays: input.retentionDays,
            compressionType: input.compressionType,
            catalogLocation: input.catalogLocation,
          },
        })

        const catalog = await this.adapter.initializeForSpace(space)

        return {
          success: true,
          catalogName: catalog?.name,
          location: catalog?.location,
          spaceId: input.spaceId,
          message: `DuckLake catalog attached for space ${input.spaceId}`,
        }
      }

      // Direct catalog creation without space
      const catalog = await this.getDuckLakeService().createCatalog(
        input.catalogName,
        input.catalogLocation,
        {
          format: input.format,
          enableTimeTravel: input.enableTimeTravel,
          retentionDays: input.retentionDays,
          compressionType: input.compressionType,
          versioning: true,
          multiTenant: false,
        }
      )

      return {
        success: true,
        catalogName: catalog.name,
        location: catalog.location,
        format: input.format,
        message: `DuckLake catalog '${input.catalogName}' attached successfully`,
      }
    } catch (error) {
      logger.error('Failed to attach DuckLake catalog:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to attach catalog',
      }
    }
  }

  /**
   * List or manage snapshots
   */
  async snapshots(input: DuckLakeSnapshotsInput): Promise<any> {
    try {
      // Get catalog
      const catalog = await this.getDuckLakeService().getCatalog(input.catalogName)
      if (!catalog) {
        throw new Error(`Catalog '${input.catalogName}' not found`)
      }

      // Handle space-aware operations
      let tableName = input.tableName
      if (input.spaceId && this.spaceFactory) {
        const space = await this.spaceFactory.get(input.spaceId)
        if (space) {
          tableName = space.qualifyTableName(input.tableName)
        }
      }

      switch (input.action) {
        case 'list': {
          // List all snapshots
          const result = await this.duckdb.executeQuery(`
            SELECT version, timestamp, operation, operation_parameters
            FROM ducklake_${input.catalogName}._delta_log
            WHERE table_name = '${tableName}'
            ORDER BY version DESC
            LIMIT 100
          `)

          return {
            success: true,
            snapshots: result.map((row: any) => ({
              version: row.version,
              timestamp: row.timestamp,
              operation: row.operation,
              parameters: JSON.parse(row.operation_parameters || '{}'),
            })),
          }
        }

        case 'details': {
          if (!input.version) {
            throw new Error('Version required for details action')
          }

          const deltaLog = await catalog.getDeltaLog(tableName, Number(input.version))
          if (!deltaLog) {
            throw new Error(`Version ${input.version} not found for table ${tableName}`)
          }

          return {
            success: true,
            version: deltaLog.version,
            timestamp: deltaLog.timestamp,
            operation: deltaLog.operation,
            files: deltaLog.files,
            metadata: deltaLog.metadata,
          }
        }

        case 'clone': {
          if (!input.version || !input.targetTableName) {
            throw new Error('Version and targetTableName required for clone action')
          }

          // Clone table at specific version
          const data = await catalog.timeTravel(tableName, Number(input.version))

          if (data.length > 0) {
            // Create target table with data
            const targetTable = input.spaceId
              ? `space_${input.spaceId}.${input.targetTableName}`
              : input.targetTableName

            await this.duckdb.executeQuery(`
              CREATE TABLE ${targetTable} AS
              SELECT * FROM (${JSON.stringify(data)})
            `)
          }

          return {
            success: true,
            message: `Table ${tableName} cloned to ${input.targetTableName} at version ${input.version}`,
          }
        }

        case 'rollback': {
          if (!input.version) {
            throw new Error('Version required for rollback action')
          }

          // Get data at specific version
          const data = await catalog.timeTravel(tableName, Number(input.version))

          // Truncate current table and insert old data
          await this.duckdb.executeQuery(`TRUNCATE TABLE ${tableName}`)

          if (data.length > 0) {
            // Insert old data back
            const columns = Object.keys(data[0]).join(', ')
            const values = data
              .map(
                (row) =>
                  `(${Object.values(row)
                    .map((v) => (typeof v === 'string' ? `'${v}'` : v))
                    .join(', ')})`
              )
              .join(', ')

            await this.duckdb.executeQuery(`
              INSERT INTO ${tableName} (${columns})
              VALUES ${values}
            `)
          }

          // Log the rollback
          await catalog.commitTransaction(
            tableName,
            {
              additions: [],
              deletions: [],
              metadata: {
                operation: 'ROLLBACK',
                toVersion: input.version,
                timestamp: new Date().toISOString(),
              },
            },
            'UPDATE'
          )

          return {
            success: true,
            message: `Table ${tableName} rolled back to version ${input.version}`,
          }
        }

        default:
          throw new Error(`Unknown action: ${input.action}`)
      }
    } catch (error) {
      logger.error('Failed to handle snapshots:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to handle snapshots',
      }
    }
  }

  /**
   * Execute time travel query
   */
  async timeTravel(input: DuckLakeTimeTravelInput): Promise<any> {
    try {
      // Get catalog
      const catalog = await this.getDuckLakeService().getCatalog(input.catalogName)
      if (!catalog) {
        throw new Error(`Catalog '${input.catalogName}' not found`)
      }

      // Handle space-aware operations
      let tableName = input.tableName
      let query = input.query
      if (input.spaceId && this.spaceFactory) {
        const space = await this.spaceFactory.get(input.spaceId)
        if (space) {
          tableName = space.qualifyTableName(input.tableName)
          query = space.applyToQuery(input.query)
        }
      }

      // Parse timestamp
      const timestamp =
        typeof input.timestamp === 'string' ? new Date(input.timestamp) : input.timestamp

      // Execute time travel query
      const data = await catalog.timeTravel(tableName, timestamp)

      // Apply query on the time-traveled data
      // Note: This is a simplified implementation. In production, you'd want
      // to use DuckDB's native time travel syntax when available
      const tempTableName = `_tt_${Date.now()}`

      if (data.length > 0) {
        // Create temporary table with time-traveled data
        const values = data
          .map(
            (row) =>
              `(${Object.values(row)
                .map((v) => (typeof v === 'string' ? `'${v}'` : v))
                .join(', ')})`
          )
          .join(', ')

        await this.duckdb.executeQuery(`
          CREATE TEMPORARY TABLE ${tempTableName} AS
          SELECT * FROM VALUES ${values}
        `)

        // Execute the user's query on the time-traveled data
        const queryWithTempTable = query.replace(tableName, tempTableName)
        const result = await this.duckdb.executeQuery(`${queryWithTempTable} LIMIT ${input.limit}`)

        // Clean up
        await this.duckdb.executeQuery(`DROP TABLE IF EXISTS ${tempTableName}`)

        return {
          success: true,
          timestamp: timestamp instanceof Date ? timestamp.toISOString() : `Version ${timestamp}`,
          rowCount: result.length,
          data: result,
        }
      }

      return {
        success: true,
        timestamp: timestamp instanceof Date ? timestamp.toISOString() : `Version ${timestamp}`,
        rowCount: 0,
        data: [],
        message: 'No data found at specified timestamp',
      }
    } catch (error) {
      logger.error('Failed to execute time travel query:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute time travel query',
      }
    }
  }

  /**
   * Configure S3/MinIO settings
   */
  private async configureS3(config: any): Promise<void> {
    const queries: string[] = []

    if (config.endpoint) {
      queries.push(`SET s3_endpoint='${config.endpoint}'`)
    }
    if (config.region) {
      queries.push(`SET s3_region='${config.region}'`)
    }
    if (config.accessKeyId) {
      queries.push(`SET s3_access_key_id='${config.accessKeyId}'`)
    }
    if (config.secretAccessKey) {
      queries.push(`SET s3_secret_access_key='${config.secretAccessKey}'`)
    }
    queries.push(`SET s3_use_ssl=${config.useSSL ? 'true' : 'false'}`)
    queries.push(`SET s3_url_style='path'`) // Common for MinIO

    for (const query of queries) {
      await this.duckdb.executeQuery(query)
    }
  }
}

/**
 * Create tool definitions
 */
export function createDuckLakeToolDefinitions() {
  return [
    {
      name: 'ducklake.attach',
      description: 'Attach or create a DuckLake catalog for ACID transactions and time travel',
      inputSchema: DuckLakeAttachInputSchema,
    },
    {
      name: 'ducklake.snapshots',
      description: 'List, view, clone or rollback table snapshots with version control',
      inputSchema: DuckLakeSnapshotsInputSchema,
    },
    {
      name: 'ducklake.time_travel',
      description: 'Execute queries on historical data at a specific point in time',
      inputSchema: DuckLakeTimeTravelInputSchema,
    },
  ]
}

/**
 * Create tool handlers
 */
export function createDuckLakeToolHandlers(
  duckdb: DuckDBService,
  spaceFactory?: SpaceContextFactory
) {
  const handlers = new DuckLakeToolHandlers(duckdb)

  if (spaceFactory) {
    handlers.setSpaceFactory(spaceFactory)
  }

  return {
    'ducklake.attach': (input: any) => handlers.attach(input),
    'ducklake.snapshots': (input: any) => handlers.snapshots(input),
    'ducklake.time_travel': (input: any) => handlers.timeTravel(input),
  }
}
