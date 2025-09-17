/**
 * DuckDB MCP Client Module
 *
 * Provides functionality to connect DuckDB to external MCP servers
 * and create virtual tables from MCP resources.
 */

import { MCPClient } from './MCPClient.js'
import { ResourceMapper } from './ResourceMapper.js'
import { VirtualTableManager } from './VirtualTable.js'
import type { DuckDBService } from '../duckdb/service.js'

export { MCPClient } from './MCPClient.js'
export type { MCPClientConfig, AttachedServer } from './MCPClient.js'

export { ResourceMapper, ResourceType } from './ResourceMapper.js'
export type { MappedResource } from './ResourceMapper.js'

export { VirtualTableManager } from './VirtualTable.js'
export type { VirtualTable, VirtualTableConfig } from './VirtualTable.js'

/**
 * Create a fully configured MCP client with DuckDB integration
 */
export function createMCPClient(
  duckdbService: DuckDBService,
  config?: import('./MCPClient.js').MCPClientConfig
): {
  client: MCPClient
  mapper: ResourceMapper
  virtualTables: VirtualTableManager
} {
  const client = new MCPClient(config)
  client.setDuckDBService(duckdbService)

  const mapper = new ResourceMapper(duckdbService)
  const virtualTables = new VirtualTableManager(duckdbService, client)

  return {
    client,
    mapper,
    virtualTables,
  }
}
