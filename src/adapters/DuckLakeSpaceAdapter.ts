/**
 * DuckLake Space Adapter - Bridges Space Context with DuckLake functionality
 * @internal - Not documented publicly
 */

import { DuckDBService } from '../duckdb/service.js'
import { DuckLakeService, DuckLakeCatalog, DuckLakeOptions } from '../service/ducklake.js'
import { SpaceContext } from '../context/SpaceContext.js'
import { logger } from '../utils/logger.js'

/**
 * Adapter that connects Space Context with DuckLake features
 * @internal
 */
export class DuckLakeSpaceAdapter {
  private ducklakeService: DuckLakeService
  private spaceCatalogs: Map<string, DuckLakeCatalog> = new Map()

  constructor(private duckdb: DuckDBService) {
    this.ducklakeService = new DuckLakeService(duckdb)
  }

  /**
   * Initialize DuckLake for a space
   */
  async initializeForSpace(space: SpaceContext): Promise<DuckLakeCatalog | null> {
    if (!space.isDuckLakeEnabled()) {
      return null
    }

    const spaceId = space.getId()
    const catalogName = space.getDuckLakeCatalog()

    if (!catalogName) {
      logger.warn(`DuckLake enabled for space ${spaceId} but no catalog name found`)
      return null
    }

    // Check if catalog already exists
    let catalog = await this.ducklakeService.getCatalog(catalogName)

    if (!catalog) {
      // Create new catalog for the space
      const ducklakeConfig = space.config.ducklake!
      const catalogLocation = ducklakeConfig.catalogLocation || `s3://ducklake/${space.getSchema()}`

      const options: Partial<DuckLakeOptions> = {
        format: ducklakeConfig.format || 'DELTA',
        enableTimeTravel: ducklakeConfig.enableTimeTravel ?? true,
        retentionDays: ducklakeConfig.retentionDays || 30,
        compressionType: ducklakeConfig.compressionType || 'ZSTD',
        versioning: ducklakeConfig.versioning ?? true,
        multiTenant: ducklakeConfig.multiTenant ?? false,
      }

      catalog = await this.ducklakeService.createCatalog(catalogName, catalogLocation, options)
    }

    this.spaceCatalogs.set(spaceId, catalog)
    logger.debug(`DuckLake initialized for space ${spaceId} with catalog ${catalogName}`)

    return catalog
  }

  /**
   * Create a DuckLake managed table in a space
   */
  async createSpaceTable(
    space: SpaceContext,
    tableName: string,
    schema: string,
    partitionBy?: string[]
  ): Promise<void> {
    const catalog = await this.getCatalogForSpace(space)
    if (!catalog) {
      throw new Error(`DuckLake not enabled for space ${space.getId()}`)
    }

    // Apply space table prefix
    const qualifiedTableName = space.qualifyTableName(tableName)
    await catalog.createTable(qualifiedTableName, schema, partitionBy)

    logger.debug(`Created DuckLake table ${qualifiedTableName} in space ${space.getId()}`)
  }

  /**
   * Time travel query for a space table
   */
  async timeTravelQuery(
    space: SpaceContext,
    tableName: string,
    timestamp: Date | number
  ): Promise<any[]> {
    const catalog = await this.getCatalogForSpace(space)
    if (!catalog) {
      throw new Error(`DuckLake not enabled for space ${space.getId()}`)
    }

    const qualifiedTableName = space.qualifyTableName(tableName)
    return await catalog.timeTravel(qualifiedTableName, timestamp)
  }

  /**
   * Get table version in a space
   */
  async getSpaceTableVersion(space: SpaceContext, tableName: string): Promise<number> {
    const catalog = await this.getCatalogForSpace(space)
    if (!catalog) {
      throw new Error(`DuckLake not enabled for space ${space.getId()}`)
    }

    const qualifiedTableName = space.qualifyTableName(tableName)
    return await catalog.getTableVersion(qualifiedTableName)
  }

  /**
   * List all snapshots for a space table
   */
  async listSnapshots(
    space: SpaceContext,
    tableName: string
  ): Promise<Array<{ version: number; timestamp: Date; operation: string }>> {
    const catalog = await this.getCatalogForSpace(space)
    if (!catalog) {
      throw new Error(`DuckLake not enabled for space ${space.getId()}`)
    }

    const qualifiedTableName = space.qualifyTableName(tableName)
    const catalogName = catalog.name

    const result = await this.duckdb.executeQuery(`
      SELECT version, timestamp, operation
      FROM ${catalogName}._delta_log
      WHERE table_name = '${qualifiedTableName}'
      ORDER BY version DESC
      LIMIT 100
    `)

    return result.map((row: any) => ({
      version: row.version,
      timestamp: new Date(row.timestamp),
      operation: row.operation,
    }))
  }

  /**
   * Migrate existing space data to DuckLake
   */
  async migrateSpaceToDuckLake(
    space: SpaceContext,
    tableName: string,
    sourceParquetPath: string
  ): Promise<void> {
    const catalog = await this.getCatalogForSpace(space)
    if (!catalog) {
      throw new Error(`DuckLake not enabled for space ${space.getId()}`)
    }

    const qualifiedTableName = space.qualifyTableName(tableName)

    // Create table from Parquet file
    await this.duckdb.executeQuery(`
      CREATE TABLE IF NOT EXISTS ${qualifiedTableName} AS
      SELECT * FROM read_parquet('${sourceParquetPath}')
    `)

    // Add initial delta log entry
    await catalog.commitTransaction(
      qualifiedTableName,
      {
        additions: [sourceParquetPath],
        deletions: [],
        metadata: {
          operation: 'MIGRATE_FROM_PARQUET',
          source: sourceParquetPath,
          migratedAt: new Date().toISOString(),
          spaceId: space.getId(),
        },
      },
      'CREATE'
    )

    logger.debug(`Migrated ${sourceParquetPath} to DuckLake table ${qualifiedTableName}`)
  }

  /**
   * Clone a table at a specific version
   */
  async cloneTableAtVersion(
    space: SpaceContext,
    sourceTalbleName: string,
    targetTableName: string,
    version: number
  ): Promise<void> {
    const catalog = await this.getCatalogForSpace(space)
    if (!catalog) {
      throw new Error(`DuckLake not enabled for space ${space.getId()}`)
    }

    const sourceQualified = space.qualifyTableName(sourceTalbleName)
    const targetQualified = space.qualifyTableName(targetTableName)

    // Get data at specific version
    const data = await catalog.timeTravel(sourceQualified, version)

    // Create new table with that data
    if (data.length > 0) {
      // Create table with same schema as source
      await this.duckdb.executeQuery(`
        CREATE TABLE ${targetQualified} AS
        SELECT * FROM ${sourceQualified}
        WHERE 1=0
      `)

      // Insert versioned data
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
        INSERT INTO ${targetQualified} (${columns})
        VALUES ${values}
      `)
    }

    logger.debug(`Cloned ${sourceQualified} at version ${version} to ${targetQualified}`)
  }

  /**
   * Get or initialize catalog for a space
   */
  private async getCatalogForSpace(space: SpaceContext): Promise<DuckLakeCatalog | null> {
    const spaceId = space.getId()

    if (this.spaceCatalogs.has(spaceId)) {
      return this.spaceCatalogs.get(spaceId)!
    }

    return await this.initializeForSpace(space)
  }

  /**
   * Execute a federated query across multiple space catalogs
   */
  async federatedTimeTravel(
    spaces: SpaceContext[],
    query: string,
    timestamp: Date
  ): Promise<any[]> {
    const results: any[] = []

    for (const space of spaces) {
      if (!space.isDuckLakeEnabled()) {
        continue
      }

      const catalog = await this.getCatalogForSpace(space)
      if (!catalog) {
        continue
      }

      // Transform query for this space
      const spaceQuery = space.applyToQuery(query)

      // Execute with time travel
      const spaceResults = await this.duckdb.executeQuery(`
        ${spaceQuery} AS OF TIMESTAMP '${timestamp.toISOString()}'
      `)

      results.push({
        spaceId: space.getId(),
        data: spaceResults,
      })
    }

    return results
  }

  /**
   * Vacuum all tables in a space
   */
  async vacuumSpace(space: SpaceContext): Promise<void> {
    const catalog = await this.getCatalogForSpace(space)
    if (!catalog) {
      throw new Error(`DuckLake not enabled for space ${space.getId()}`)
    }

    // Get all tables in the space
    const tables = await this.duckdb.executeQuery(`
      SELECT DISTINCT table_name
      FROM ${catalog.name}._delta_log
    `)

    for (const row of tables) {
      await catalog.vacuum(row.table_name)
    }

    logger.debug(`Vacuumed all tables in space ${space.getId()}`)
  }

  /**
   * Get space-level statistics
   */
  async getSpaceStatistics(space: SpaceContext): Promise<any> {
    const catalog = await this.getCatalogForSpace(space)
    if (!catalog) {
      return { ducklakeEnabled: false }
    }

    const stats = await this.duckdb.executeQuery(`
      SELECT
        COUNT(DISTINCT table_name) as table_count,
        SUM(version) as total_versions,
        MIN(timestamp) as earliest_change,
        MAX(timestamp) as latest_change
      FROM ${catalog.name}._delta_log
    `)

    return {
      ducklakeEnabled: true,
      spaceId: space.getId(),
      catalogName: catalog.name,
      ...stats[0],
    }
  }
}
