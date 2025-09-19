/**
 * Library mode exports for @seed-ship/duckdb-mcp-native
 * Use this when embedding DuckDB MCP tools in other MCP servers
 *
 * This does NOT auto-initialize the server - you control initialization
 */

import { DuckDBMCPServer } from './server/mcp-server.js'
import { nativeToolHandlers, nativeToolDefinitions } from './tools/native-tools.js'
import { DuckDBService } from './duckdb/service.js'
import type { DuckDBConfig } from './duckdb/service.js'

// Export the server class for embedded mode
export { DuckDBMCPServer }

// Export the DuckDB service for direct usage
export { DuckDBService }

// Export configuration type
export type { DuckDBConfig }

// Export native tool handlers and definitions for direct integration
export { nativeToolHandlers, nativeToolDefinitions }

/**
 * Factory function to create an embedded server instance
 * This gives you full control over the server lifecycle
 */
export function createEmbeddedServer(config?: {
  embeddedMode?: boolean
  duckdbService?: DuckDBService
}) {
  return new DuckDBMCPServer({
    ...config,
    embeddedMode: true, // Ensure it doesn't start stdio transport
  })
}

/**
 * Convenience function to get tool handlers without starting a server
 * Useful for quick integration into existing MCP servers
 */
export async function getToolHandlers(duckdbConfig?: DuckDBConfig) {
  const service = new DuckDBService(duckdbConfig)
  await service.initialize()

  const context = {
    duckdb: service,
    spaceId: undefined,
    applySpaceContext: undefined,
  }

  // Return handlers bound to this context
  return Object.fromEntries(
    Object.entries(nativeToolHandlers).map(([name, handler]) => [
      name,
      (args: any) => handler(args, context),
    ])
  )
}

/**
 * Get tool handlers bound to an existing DuckDB service
 * This prevents creating duplicate DuckDB instances
 */
export function getToolHandlersWithService(duckdbService: DuckDBService) {
  const context = {
    duckdb: duckdbService,
    spaceId: undefined,
    applySpaceContext: undefined,
  }

  // Return handlers bound to the provided service
  return Object.fromEntries(
    Object.entries(nativeToolHandlers).map(([name, handler]) => [
      name,
      (args: any) => handler(args, context),
    ])
  )
}

/**
 * Re-export tool definitions for easy access
 */
export { nativeToolDefinitions as toolDefinitions }

/**
 * Export DuckLake service for lakehouse functionality
 */
export { DuckLakeService, DuckLakeCatalog } from './service/ducklake.js'
export type { DuckLakeOptions, DeltaLogEntry, ChangeSet } from './service/ducklake.js'
