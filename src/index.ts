// Protocol exports
export * from './protocol/types.js'
export * from './protocol/messages.js'
export * from './protocol/transport.js'

// DuckDB exports
export * from './duckdb/service.js'

// Server exports
export * from './server/mcp-server.js'

// Main API
export { DuckDBService, getDuckDBService, createDuckDBService } from './duckdb/service.js'
export { DuckDBMCPServer } from './server/mcp-server.js'
export {
  StdioTransport,
  TCPTransport,
  WebSocketTransport,
  Transport,
} from './protocol/transport.js'
export { MessageFormatter, MessageRouter, CorrelationTracker } from './protocol/messages.js'
