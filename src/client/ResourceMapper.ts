import { DuckDBService } from '../duckdb/service.js'
import { escapeIdentifier, escapeFilePath } from '../utils/sql-escape.js'
import { logger } from '../utils/logger.js'

/**
 * Resource types that can be mapped to DuckDB tables
 */
export enum ResourceType {
  JSON = 'application/json',
  CSV = 'text/csv',
  PARQUET = 'application/parquet',
  TEXT = 'text/plain',
  UNKNOWN = 'unknown',
}

/**
 * Metadata about a mapped resource
 */
export interface MappedResource {
  resourceUri: string
  tableName: string
  resourceType: ResourceType
  serverAlias?: string
  createdAt: Date
  lastRefresh?: Date
  rowCount?: number
  columns?: Array<{ name: string; type: string }>
}

/**
 * Maps MCP resources to DuckDB tables
 */
export class ResourceMapper {
  private mappedResources = new Map<string, MappedResource>()
  private duckdb: DuckDBService

  constructor(duckdb: DuckDBService) {
    this.duckdb = duckdb
  }

  /**
   * Detect resource type from MIME type or content
   */
  detectResourceType(mimeType?: string, content?: string): ResourceType {
    if (mimeType) {
      switch (mimeType.toLowerCase()) {
        case 'application/json':
        case 'application/ld+json':
          return ResourceType.JSON
        case 'text/csv':
        case 'application/csv':
          return ResourceType.CSV
        case 'application/parquet':
        case 'application/octet-stream':
          if (mimeType.includes('parquet')) {
            return ResourceType.PARQUET
          }
          break
        case 'text/plain':
          return ResourceType.TEXT
      }
    }

    // Try to detect from content
    if (content) {
      const trimmed = content.trim()
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        return ResourceType.JSON
      }
      if (trimmed.includes(',') && trimmed.split('\n')[0]?.includes(',')) {
        return ResourceType.CSV
      }
    }

    return ResourceType.UNKNOWN
  }

  /**
   * Map a resource to a DuckDB table
   */
  async mapResource(
    resourceUri: string,
    tableName: string,
    data: any,
    mimeType?: string,
    serverAlias?: string
  ): Promise<MappedResource> {
    // Handle special case: Parquet file reference object from MCPClient
    if (data && typeof data === 'object' && data.type === 'parquet' && data.path) {
      // This is a Parquet file reference, not JSON data
      return this.handleParquetFileReference(resourceUri, tableName, data.path, serverAlias)
    }

    const resourceType = this.detectResourceType(
      mimeType,
      typeof data === 'string' ? data : JSON.stringify(data)
    )

    try {
      // Create table based on resource type
      switch (resourceType) {
        case ResourceType.JSON:
          await this.mapJSONResource(tableName, data)
          break
        case ResourceType.CSV:
          await this.mapCSVResource(tableName, data)
          break
        case ResourceType.PARQUET:
          await this.mapParquetResource(tableName, data)
          break
        default:
          throw new Error(`Unsupported resource type: ${resourceType}`)
      }

      // Get table metadata
      const columns = await this.duckdb.getTableColumns(tableName)
      const rowCount = await this.duckdb.getRowCount(tableName)

      const mapped: MappedResource = {
        resourceUri,
        tableName,
        resourceType,
        serverAlias,
        createdAt: new Date(),
        rowCount,
        columns: columns.map((col: any) => ({
          name: col.column_name,
          type: col.data_type,
        })),
      }

      this.mappedResources.set(tableName, mapped)
      return mapped
    } catch (error) {
      throw new Error(`Failed to map resource '${resourceUri}' to table '${tableName}': ${error}`)
    }
  }

  /**
   * Map JSON data to a DuckDB table
   */
  private async mapJSONResource(tableName: string, data: any): Promise<void> {
    // Handle both array and object data
    let jsonArray: any[]

    if (Array.isArray(data)) {
      jsonArray = data
    } else if (typeof data === 'object' && data !== null) {
      // Single object, wrap in array
      jsonArray = [data]
    } else if (typeof data === 'string') {
      // Try to parse JSON string
      try {
        const parsed = JSON.parse(data)
        jsonArray = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        throw new Error('Invalid JSON data')
      }
    } else {
      throw new Error('Invalid data format for JSON resource')
    }

    if (jsonArray.length === 0) {
      throw new Error('Cannot create table from empty JSON array')
    }

    await this.duckdb.createTableFromJSON(tableName, jsonArray)
  }

  /**
   * Map CSV data to a DuckDB table
   */
  private async mapCSVResource(tableName: string, data: string | any): Promise<void> {
    let csvContent: string

    if (typeof data === 'string') {
      csvContent = data
    } else if (Array.isArray(data)) {
      // Convert array to CSV
      csvContent = this.arrayToCSV(data)
    } else {
      throw new Error('Invalid data format for CSV resource')
    }

    // Write to temporary file and load
    const tempFile = `/tmp/mcp_resource_${Date.now()}.csv`
    const fs = await import('fs/promises')

    try {
      await fs.writeFile(tempFile, csvContent)
      await this.duckdb.executeQuery(`
        CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} AS 
        SELECT * FROM read_csv_auto(${escapeFilePath(tempFile)})
      `)
    } finally {
      // Clean up temp file
      await fs.unlink(tempFile).catch(() => {})
    }
  }

  /**
   * Map Parquet data to a DuckDB table
   */
  private async mapParquetResource(tableName: string, data: any): Promise<void> {
    // Parquet data should be a file path or URL
    if (typeof data === 'string') {
      await this.duckdb.executeQuery(`
        CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} AS 
        SELECT * FROM read_parquet(${escapeFilePath(data)})
      `)
    } else if (Buffer.isBuffer(data)) {
      // If it's binary data, write to temp file
      const tempFile = `/tmp/mcp_resource_${Date.now()}.parquet`
      const fs = await import('fs/promises')

      try {
        await fs.writeFile(tempFile, data)
        await this.duckdb.executeQuery(`
          CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} AS 
          SELECT * FROM read_parquet(${escapeFilePath(tempFile)})
        `)
      } finally {
        await fs.unlink(tempFile).catch(() => {})
      }
    } else {
      throw new Error('Invalid data format for Parquet resource')
    }
  }

  /**
   * Handle Parquet file reference from MCPClient
   */
  private async handleParquetFileReference(
    resourceUri: string,
    tableName: string,
    filePath: string,
    serverAlias?: string
  ): Promise<MappedResource> {
    try {
      // Create table from Parquet file
      await this.duckdb.executeQuery(`
        CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} AS 
        SELECT * FROM read_parquet(${escapeFilePath(filePath)})
      `)

      // Clean up temp file after loading
      const fs = await import('fs/promises')
      await fs.unlink(filePath).catch(() => {
        logger.warn(`Could not delete temp Parquet file: ${filePath}`)
      })

      // Get table metadata
      const columns = await this.duckdb.getTableColumns(tableName)
      const rowCount = await this.duckdb.getRowCount(tableName)

      const mapped: MappedResource = {
        resourceUri,
        tableName,
        resourceType: ResourceType.PARQUET,
        serverAlias,
        createdAt: new Date(),
        rowCount,
        columns: columns.map((col: any) => ({
          name: col.column_name,
          type: col.data_type,
        })),
      }

      this.mappedResources.set(tableName, mapped)
      return mapped
    } catch (error) {
      throw new Error(
        `Failed to map Parquet resource '${resourceUri}' to table '${tableName}': ${error}`
      )
    }
  }

  /**
   * Convert array of objects to CSV string
   */
  private arrayToCSV(data: any[]): string {
    if (data.length === 0) return ''

    const headers = Object.keys(data[0])
    const rows = data.map((row) =>
      headers
        .map((header) => {
          const value = row[header]
          if (value === null || value === undefined) return ''
          if (typeof value === 'string' && value.includes(',')) {
            return `"${value.replace(/"/g, '""')}"`
          }
          return String(value)
        })
        .join(',')
    )

    return [headers.join(','), ...rows].join('\n')
  }

  /**
   * Refresh a mapped resource
   */
  async refreshResource(tableName: string, newData: any): Promise<MappedResource> {
    const existing = this.mappedResources.get(tableName)
    if (!existing) {
      throw new Error(`Table '${tableName}' is not a mapped resource`)
    }

    // Re-map the resource
    const updated = await this.mapResource(
      existing.resourceUri,
      tableName,
      newData,
      existing.resourceType,
      existing.serverAlias
    )

    updated.lastRefresh = new Date()
    return updated
  }

  /**
   * Get information about a mapped resource
   */
  getMappedResource(tableName: string): MappedResource | undefined {
    return this.mappedResources.get(tableName)
  }

  /**
   * List all mapped resources
   */
  listMappedResources(): MappedResource[] {
    return Array.from(this.mappedResources.values())
  }

  /**
   * Unmap a resource (drop the table)
   */
  async unmapResource(tableName: string): Promise<void> {
    const mapped = this.mappedResources.get(tableName)
    if (!mapped) {
      throw new Error(`Table '${tableName}' is not a mapped resource`)
    }

    try {
      await this.duckdb.executeQuery(`DROP TABLE IF EXISTS ${escapeIdentifier(tableName)}`)
      this.mappedResources.delete(tableName)
      logger.info(`🗑️ Unmapped resource table '${tableName}'`)
    } catch (error) {
      throw new Error(`Failed to unmap resource '${tableName}': ${error}`)
    }
  }

  /**
   * Clear all mapped resources
   */
  async clearAllMappings(): Promise<void> {
    const tableNames = Array.from(this.mappedResources.keys())

    for (const tableName of tableNames) {
      await this.unmapResource(tableName)
    }

    logger.info('🧹 Cleared all resource mappings')
  }
}
