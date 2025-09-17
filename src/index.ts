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

// Main API
export { DuckDBService, getDuckDBService, createDuckDBService } from './duckdb/service.js'
export { DuckDBMCPServer } from './server/mcp-server.js'
export { MCPClient } from './client/MCPClient.js'
export { ResourceMapper } from './client/ResourceMapper.js'
export { VirtualTable } from './client/VirtualTable.js'
export {
  DuckDBMcpNativeService,
  getDuckDBMcpNativeService,
  createDuckDBMcpNativeService,
} from './service/DuckDBMcpNativeService.js'
export {
  StdioTransport,
  TCPTransport,
  WebSocketTransport,
  Transport,
} from './protocol/transport.js'
export { MessageFormatter, MessageRouter, CorrelationTracker } from './protocol/messages.js'
export { duckdbMcpTools, duckdbMcpSchemas } from './tools/duckdb-mcp-tools.js'
