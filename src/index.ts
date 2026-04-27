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

// Graph algorithm tools exports (S2: F1-F5)
export { graphToolHandlers, graphToolDefinitions } from './tools/graph-tools.js'
export {
  handlePageRank,
  handleEigenvector,
  handleCommunityDetect,
  handleModularity,
  handleWeightedPath,
  handleTemporalFilter,
  handleComparePeriods,
  handleGraphExport,
} from './tools/graph-tools.js'

// Graph helper utilities (v1.3.0) — exposed so hosts can build their own
// custom centrality / pathing queries without duplicating the dedup-safe
// subquery logic. `buildNodeSubquery` is critical for algorithms iterating
// over nodes — see graph-utils.ts for the cascade-amplification rationale.
export {
  validateGraphTables,
  buildNodeSubquery,
  buildEdgeSubquery,
  getColumnRefs,
  tempTablePrefix,
  dropTempTable,
  cleanupTempTables,
} from './tools/graph-utils.js'

export type { ValidateGraphTablesOptions, ValidateGraphTablesResult } from './tools/graph-utils.js'

// Discovery API (v1.3.0) — host runtimes can boot-validate their op
// bindings against what the plugin actually ships. Avoids silent drift
// when the plugin adds/removes ops.
export { AVAILABLE_OPS, type AvailableOp } from './tools/available-ops.js'

// ComputeSession — pinned-connection executor for stateful multi-statement
// algorithms (v1.2.0). Hosts that route reads/writes to different
// connections must wrap their service via openComputeSession before passing
// it to graph handlers, otherwise temp tables created by the algorithm are
// silently lost between CREATE and final SELECT.
//
// v1.4.0: sessions opened via openComputeSession also expose metrics()
// returning {queries_run, total_duration_ms, last_query_at, errors_count}.
export {
  openComputeSession,
  ensureSession,
  type ComputeSession,
  type DuckDBLike,
  type SessionMetrics,
} from './compute-session.js'

// Structured error codes for graph handlers (v1.4.0). Hosts can route
// fallbacks by inspecting `.code` instead of grepping error messages.
// `GraphError extends Error` so existing `instanceof Error` and `.message`
// code keeps working unchanged.
export { GraphError, type GraphErrorCode } from './errors/graph-errors.js'

// Export graph types for TypeScript users
export type {
  PageRankResult,
  PageRankNode,
  EigenvectorResult,
  EigenvectorNode,
  CommunityDetectResult,
  CommunityInfo,
  CommunityNode,
  ModularityResult,
  WeightedPathResult,
  PathResult,
  PathStep,
  TemporalFilterResult,
  ComparePeriodsResult,
  EdgeChange,
  PeriodMetrics,
  GraphExportResult,
} from './types/graph-types.js'

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
