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
 * ## API Stability Guarantee
 *
 * ### Experimental Phase (v0.x)
 *
 * **Versions**: v0.10.x - v0.99.x
 *
 * **Stability**: EXPERIMENTAL
 *
 * - Breaking changes possible between minor versions
 * - New features may have unstable APIs
 * - Recommended: Pin exact versions (`"@seed-ship/duckdb-mcp-native": "0.10.4"`)
 * - Test thoroughly before upgrading
 *
 * **Experimental Features** (v0.10.x):
 * - Mastra AI integration (`/mastra` export) - Phase 0 preparation (see {@link https://github.com/theseedship/duckdb_mcp_node/blob/main/docs/MASTRA_INTEGRATION.md|MASTRA_INTEGRATION.md})
 * - DuckLake advanced features (snapshots, time travel)
 * - MotherDuck cloud integration (awaiting DuckDB v1.4.0 support)
 *
 * ### Stable Phase (v1.x+)
 *
 * **Versions**: v1.0.0+ (Planned Q2 2026)
 *
 * **Stability**: STABLE - Strict semantic versioning
 *
 * - **Major (v1 → v2)**: Breaking changes, migration guide provided
 * - **Minor (v1.0 → v1.1)**: New features, backward compatible
 * - **Patch (v1.0.0 → v1.0.1)**: Bug fixes, backward compatible
 * - Recommended: Use semver ranges (`"^1.0.0"` for auto-updates)
 *
 * **Production-Ready Features** (v1.0.0+):
 * - Core DuckDB tools (query, load, export)
 * - Federation and virtual tables
 * - Process mining tools (P2.8/P2.9 validated)
 * - Mastra AI integration (Phase 2 completion)
 *
 * @packageDocumentation
 * @see {@link https://github.com/theseedship/duckdb_mcp_node|GitHub Repository}
 * @see {@link https://github.com/theseedship/duckdb_mcp_node/blob/main/docs/MASTRA_INTEGRATION.md|Mastra Integration Roadmap}
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

// Process mining tools exports (P2.8/P2.9 validated)
export { processToolHandlers, processToolDefinitions } from './tools/process-tools.js'

// Export process types for TypeScript users
export type {
  ProcessDescribeResult,
  ProcessSimilarResult,
  ProcessComposeResult,
  ProcessSummary,
  ProcessStep,
  ProcessEdge,
} from './types/process-types.js'

// Data helper tools exports (json_to_parquet, profile_parquet, sample_parquet)
export { dataHelperToolHandlers, dataHelperToolDefinitions } from './tools/data-helper-tools.js'

// DuckLake tools exports (ACID transactions, time travel, snapshots)
export {
  createDuckLakeToolDefinitions,
  createDuckLakeToolHandlers,
} from './tools/ducklake-tools.js'

// MotherDuck tools exports (cloud integration)
export { getMotherDuckToolDefinitions, createMotherDuckHandlers } from './tools/motherduck-tools.js'

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
