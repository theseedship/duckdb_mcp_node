import { DuckDBService } from '../duckdb/service.js'
import { MCPClient } from './MCPClient.js'
import { ResourceMapper, MappedResource } from './ResourceMapper.js'

/**
 * Configuration for virtual tables
 */
export interface VirtualTableConfig {
  autoRefresh?: boolean
  refreshInterval?: number // milliseconds
  lazyLoad?: boolean
  maxRows?: number
}

/**
 * Represents a virtual table backed by an MCP resource
 */
export interface VirtualTable {
  name: string
  resourceUri: string
  serverAlias?: string
  config: VirtualTableConfig
  metadata: MappedResource
  refreshTimer?: ReturnType<typeof setInterval>
}

/**
 * Manages virtual tables that are backed by MCP resources
 */
export class VirtualTableManager {
  private virtualTables = new Map<string, VirtualTable>()
  private duckdb: DuckDBService
  private mcpClient: MCPClient
  private resourceMapper: ResourceMapper

  constructor(duckdb: DuckDBService, mcpClient: MCPClient) {
    this.duckdb = duckdb
    this.mcpClient = mcpClient
    this.resourceMapper = new ResourceMapper(duckdb)
  }

  /**
   * Create a virtual table from an MCP resource
   */
  async createVirtualTable(
    tableName: string,
    resourceUri: string,
    serverAlias?: string,
    config: VirtualTableConfig = {}
  ): Promise<VirtualTable> {
    // Check if table already exists
    if (this.virtualTables.has(tableName)) {
      throw new Error(`Virtual table '${tableName}' already exists`)
    }

    const tableConfig: VirtualTableConfig = {
      autoRefresh: config.autoRefresh ?? false,
      refreshInterval: config.refreshInterval ?? 60000, // 1 minute default
      lazyLoad: config.lazyLoad ?? false,
      maxRows: config.maxRows,
    }

    try {
      // Create the actual table if not lazy loading
      let metadata: MappedResource | undefined

      if (!tableConfig.lazyLoad) {
        const data = await this.mcpClient.readResource(resourceUri, serverAlias)

        // Apply row limit if specified
        let limitedData = data
        if (tableConfig.maxRows && Array.isArray(data) && data.length > tableConfig.maxRows) {
          limitedData = data.slice(0, tableConfig.maxRows)
          console.info(`⚠️ Limited table '${tableName}' to ${tableConfig.maxRows} rows`)
        }

        metadata = await this.resourceMapper.mapResource(
          resourceUri,
          tableName,
          limitedData,
          undefined,
          serverAlias
        )
      }

      // Create virtual table record
      const virtualTable: VirtualTable = {
        name: tableName,
        resourceUri,
        serverAlias,
        config: tableConfig,
        metadata: metadata || {
          resourceUri,
          tableName,
          resourceType: this.resourceMapper.detectResourceType(),
          serverAlias,
          createdAt: new Date(),
        },
      }

      // Set up auto-refresh if enabled
      if (tableConfig.autoRefresh && tableConfig.refreshInterval > 0) {
        virtualTable.refreshTimer = setInterval(
          () => this.refreshVirtualTable(tableName).catch(console.error),
          tableConfig.refreshInterval
        )
        console.info(
          `🔄 Auto-refresh enabled for table '${tableName}' (every ${tableConfig.refreshInterval}ms)`
        )
      }

      this.virtualTables.set(tableName, virtualTable)

      console.info(
        `✅ Created virtual table '${tableName}' from '${resourceUri}'` +
          (tableConfig.lazyLoad ? ' (lazy-loaded)' : ` with ${metadata?.rowCount || 0} rows`)
      )

      return virtualTable
    } catch (error) {
      throw new Error(`Failed to create virtual table '${tableName}': ${error}`)
    }
  }

  /**
   * Load a lazy-loaded virtual table
   */
  async loadVirtualTable(tableName: string): Promise<void> {
    const virtualTable = this.virtualTables.get(tableName)
    if (!virtualTable) {
      throw new Error(`Virtual table '${tableName}' not found`)
    }

    if (!virtualTable.config.lazyLoad) {
      console.info(`ℹ️ Table '${tableName}' is already loaded`)
      return
    }

    // Load the data
    const data = await this.mcpClient.readResource(
      virtualTable.resourceUri,
      virtualTable.serverAlias
    )

    // Apply row limit if specified
    let limitedData = data
    if (
      virtualTable.config.maxRows &&
      Array.isArray(data) &&
      data.length > virtualTable.config.maxRows
    ) {
      limitedData = data.slice(0, virtualTable.config.maxRows)
    }

    // Map to table
    virtualTable.metadata = await this.resourceMapper.mapResource(
      virtualTable.resourceUri,
      tableName,
      limitedData,
      undefined,
      virtualTable.serverAlias
    )

    // Update config
    virtualTable.config.lazyLoad = false

    console.info(
      `📊 Loaded virtual table '${tableName}' with ${virtualTable.metadata.rowCount || 0} rows`
    )
  }

  /**
   * Refresh a virtual table with latest data
   */
  async refreshVirtualTable(tableName: string): Promise<void> {
    const virtualTable = this.virtualTables.get(tableName)
    if (!virtualTable) {
      throw new Error(`Virtual table '${tableName}' not found`)
    }

    if (virtualTable.config.lazyLoad) {
      console.info(`⚠️ Cannot refresh lazy-loaded table '${tableName}'. Load it first.`)
      return
    }

    try {
      // Clear cache and re-read resource
      this.mcpClient.clearCache(virtualTable.serverAlias)
      const data = await this.mcpClient.readResource(
        virtualTable.resourceUri,
        virtualTable.serverAlias,
        false // Don't use cache
      )

      // Apply row limit if specified
      let limitedData = data
      if (
        virtualTable.config.maxRows &&
        Array.isArray(data) &&
        data.length > virtualTable.config.maxRows
      ) {
        limitedData = data.slice(0, virtualTable.config.maxRows)
      }

      // Refresh the table
      virtualTable.metadata = await this.resourceMapper.refreshResource(tableName, limitedData)

      console.info(
        `🔄 Refreshed virtual table '${tableName}' (${virtualTable.metadata.rowCount} rows)`
      )
    } catch (error) {
      console.error(`Failed to refresh virtual table '${tableName}':`, error)
      throw error
    }
  }

  /**
   * Drop a virtual table
   */
  async dropVirtualTable(tableName: string): Promise<void> {
    const virtualTable = this.virtualTables.get(tableName)
    if (!virtualTable) {
      throw new Error(`Virtual table '${tableName}' not found`)
    }

    // Stop auto-refresh if active
    if (virtualTable.refreshTimer) {
      clearInterval(virtualTable.refreshTimer)
    }

    // Drop the actual table if it exists
    if (!virtualTable.config.lazyLoad) {
      await this.resourceMapper.unmapResource(tableName)
    }

    this.virtualTables.delete(tableName)

    console.info(`🗑️ Dropped virtual table '${tableName}'`)
  }

  /**
   * Get virtual table information
   */
  getVirtualTable(tableName: string): VirtualTable | undefined {
    return this.virtualTables.get(tableName)
  }

  /**
   * List all virtual tables
   */
  listVirtualTables(): VirtualTable[] {
    return Array.from(this.virtualTables.values())
  }

  /**
   * Execute a hybrid query across local and virtual tables
   */
  async executeHybridQuery(sql: string): Promise<any[]> {
    // Ensure all lazy tables referenced in the query are loaded
    const tableNames = Array.from(this.virtualTables.keys())
    const referencedTables = tableNames.filter((name) => new RegExp(`\\b${name}\\b`, 'i').test(sql))

    for (const tableName of referencedTables) {
      const vTable = this.virtualTables.get(tableName)
      if (vTable?.config.lazyLoad) {
        console.info(`📊 Auto-loading lazy table '${tableName}' for query`)
        await this.loadVirtualTable(tableName)
      }
    }

    // Execute the query
    return await this.duckdb.executeQuery(sql)
  }

  /**
   * Create a materialized view from a virtual table
   */
  async materializeVirtualTable(virtualTableName: string, materializedName: string): Promise<void> {
    const virtualTable = this.virtualTables.get(virtualTableName)
    if (!virtualTable) {
      throw new Error(`Virtual table '${virtualTableName}' not found`)
    }

    // Ensure table is loaded
    if (virtualTable.config.lazyLoad) {
      await this.loadVirtualTable(virtualTableName)
    }

    // Create materialized copy
    await this.duckdb.executeQuery(`
      CREATE TABLE ${materializedName} AS 
      SELECT * FROM ${virtualTableName}
    `)

    const rowCount = await this.duckdb.getRowCount(materializedName)

    console.info(
      `💾 Materialized virtual table '${virtualTableName}' as '${materializedName}' (${rowCount} rows)`
    )
  }

  /**
   * Update virtual table configuration
   */
  updateVirtualTableConfig(tableName: string, config: Partial<VirtualTableConfig>): void {
    const virtualTable = this.virtualTables.get(tableName)
    if (!virtualTable) {
      throw new Error(`Virtual table '${tableName}' not found`)
    }

    // Update config
    Object.assign(virtualTable.config, config)

    // Handle auto-refresh changes
    if (config.autoRefresh !== undefined || config.refreshInterval !== undefined) {
      // Clear existing timer
      if (virtualTable.refreshTimer) {
        clearInterval(virtualTable.refreshTimer)
        virtualTable.refreshTimer = undefined
      }

      // Set up new timer if enabled
      if (
        virtualTable.config.autoRefresh &&
        virtualTable.config.refreshInterval &&
        virtualTable.config.refreshInterval > 0
      ) {
        virtualTable.refreshTimer = setInterval(
          () => this.refreshVirtualTable(tableName).catch(console.error),
          virtualTable.config.refreshInterval
        )
        console.info(`🔄 Updated auto-refresh for table '${tableName}'`)
      }
    }
  }

  /**
   * Clean up all virtual tables
   */
  async cleanup(): Promise<void> {
    const tableNames = Array.from(this.virtualTables.keys())

    for (const tableName of tableNames) {
      await this.dropVirtualTable(tableName)
    }

    console.info('🧹 Cleaned up all virtual tables')
  }
}
