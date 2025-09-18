/**
 * DuckDB MCP Node - Main entry point
 *
 * Two usage modes:
 *
 * 1. Standalone MCP Server:
 *    ```typescript
 *    import { DuckDBMCPServer } from 'duckdb_mcp_node'
 *    const server = new DuckDBMCPServer()
 *    await server.start()
 *    ```
 *
 * 2. Embedded in another MCP server:
 *    ```typescript
 *    import { nativeToolHandlers, nativeToolDefinitions } from 'duckdb_mcp_node'
 *    // Register tools in your MCP server
 *    server.registerTools(nativeToolDefinitions)
 *    // Use handlers directly
 *    const result = await nativeToolHandlers.query_duckdb({ sql: 'SELECT 1' })
 *    ```
 *
 * @packageDocumentation
 */

// Protocol exports
export * from './protocol/types.js'
export * from './protocol/messages.js'
export * from './protocol/transport.js'

// DuckDB exports
export * from './duckdb/service.js'

// Server exports
export * from './server/mcp-server.js'

// Client exports
export * from './client/MCPClient.js'
export * from './client/ResourceMapper.js'
export * from './client/VirtualTable.js'

// Service exports
export * from './service/DuckDBMcpNativeService.js'
export * from './service/types.js'

// Tools exports
export * from './tools/duckdb-mcp-tools.js'

// Native tools exports (for embedding in other MCP servers)
export {
  nativeToolHandlers,
  nativeToolDefinitions,
  nativeToolSchemas,
} from './tools/native-tools.js'

// Export types for TypeScript users
export type {
  QueryDuckDBInput,
  ListTablesInput,
  DescribeTableInput,
  LoadCSVInput,
  LoadParquetInput,
  ExportDataInput,
} from './tools/native-tools.js'

// Federation exports
export * from './federation/ResourceRegistry.js'
export * from './federation/ConnectionPool.js'
export * from './federation/QueryRouter.js'

// Utilities exports
export * from './utils/connection-reset.js'

// Main API
export { DuckDBService, getDuckDBService, createDuckDBService } from './duckdb/service.js'
export { DuckDBMCPServer } from './server/mcp-server.js'
export { MCPClient } from './client/MCPClient.js'
export { ResourceMapper } from './client/ResourceMapper.js'
export { VirtualTableManager } from './client/VirtualTable.js'
export {
  DuckDBMcpNativeService,
  getDuckDBMcpNativeService,
  createDuckDBMcpNativeService,
} from './service/DuckDBMcpNativeService.js'
export {
  Transport,
  StdioTransport,
  HTTPTransport,
  WebSocketTransport,
  TCPTransport,
} from './protocol/index.js'
export { MessageFormatter, MessageRouter, CorrelationTracker } from './protocol/messages.js'
export { duckdbMcpTools, duckdbMcpSchemas } from './tools/duckdb-mcp-tools.js'

// Federation API
export { ResourceRegistry } from './federation/ResourceRegistry.js'
export { MCPConnectionPool } from './federation/ConnectionPool.js'
export { QueryRouter } from './federation/QueryRouter.js'
export { ConnectionReset } from './utils/connection-reset.js'
