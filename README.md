# DuckDB MCP Native

Native Node.js/TypeScript implementation of DuckDB MCP (Model Context Protocol) extension.

## Features

- 🚀 **Native TypeScript**: Pure Node.js implementation, no C++ dependencies
- 🔧 **MCP Protocol**: Full JSON-RPC 2.0 implementation with stdio/TCP/WebSocket transports
- 📊 **DuckDB Integration**: Execute SQL queries, manage tables, load data files
- 🔒 **Security**: SQL injection prevention, configurable security modes
- 📦 **Modular**: Clean architecture with reusable components
- 🔄 **Resource Management**: Virtual tables, resource mapping, auto-refresh
- 💾 **Smart Caching**: 5-minute TTL resource cache with configurable options
- 🛠️ **Rich Toolset**: 9+ MCP tools for comprehensive database control

## Installation

```bash
npm install
```

## Quick Start

### 1. Start the MCP Server

```bash
# Using npm script
npm run dev:server

# Or directly with tsx
MCP_MODE=stdio tsx src/server/mcp-server.ts
```

### 2. Test with MCP Inspector

```bash
npm run inspector
```

### 3. Run Example Tests

```bash
npm run example:query
```

## Available Tools

The MCP server exposes the following tools:

### Core Database Tools

#### `query_duckdb`

Execute SQL queries on DuckDB with automatic result limiting and security features.

#### `create_table_from_json`

Create DuckDB tables from JSON data with automatic schema inference.

#### `read_parquet`

Read and query Parquet files directly without loading into memory.

#### `read_csv`

Import CSV files with automatic type detection and parsing.

#### `export_data`

Export query results to various formats (Parquet, CSV, JSON).

### MCP Service Management Tools

#### `mcpServe`

Start an MCP server to expose DuckDB tables and resources.

#### `mcpAttach`

Connect to external MCP servers and access their resources.

#### `mcpDetach`

Disconnect from MCP servers and clean up resources.

#### `mcpCreateVirtualTable`

Map MCP resources to DuckDB virtual tables for SQL querying.

#### `mcpCallTool`

Execute tools on connected MCP servers.

#### `mcpStatus`

Get status of all active servers and clients.

#### `mcpListResources`

List available resources from connected MCP servers.

#### `mcpListTools`

List available tools from connected MCP servers.

#### `mcpClearCache`

Clear the resource cache to force fresh data retrieval.

## API Usage

### TypeScript/JavaScript

```typescript
import { getDuckDBService, getDuckDBMcpNativeService, MCPClient } from '@deposium/duckdb-mcp-native'

// Initialize DuckDB
const duckdb = await getDuckDBService()

// Execute queries
const results = await duckdb.executeQuery('SELECT * FROM employees')

// Start MCP server
const service = getDuckDBMcpNativeService()
await service.startServer('my-server')

// Connect to external MCP server
await service.attachMCP('stdio://path/to/server', 'alias')

// Create virtual table from MCP resource
await service.createVirtualTable('alias', 'resource://data', 'my_table')
```

### MCP Client Example

```typescript
// Create a client to consume MCP resources
const client = new MCPClient()
await client.attachServer('stdio://duckdb-server', 'db', 'stdio')

// List available resources
const resources = await client.listResources()

// Read a resource (table data)
const data = await client.readResource('duckdb://table/employees')

// Execute a tool
const result = await client.callTool('db', 'query_duckdb', {
  sql: 'SELECT COUNT(*) FROM employees',
})
```

## MCP Client Features (Phase 2)

The DuckDB MCP server now includes advanced MCP client capabilities for connecting to external MCP servers and creating virtual tables.

### Virtual Tables and External MCP Servers

#### `attach_mcp`

Attach an external MCP server to enable data federation.

```json
{
  "url": "stdio://weather-server?args=--api-key,YOUR_KEY",
  "alias": "weather",
  "transport": "stdio"
}
```

#### `create_virtual_table`

Create a virtual table from an MCP resource.

```json
{
  "table_name": "weather_data",
  "resource_uri": "weather://current",
  "server_alias": "weather",
  "auto_refresh": true,
  "refresh_interval": 60000,
  "lazy_load": false,
  "max_rows": 10000
}
```

#### `query_hybrid`

Execute hybrid queries across local and virtual tables.

```json
{
  "sql": "SELECT * FROM sales JOIN weather_data ON sales.date = weather_data.date",
  "limit": 1000
}
```

### Additional MCP Client Tools

- **`detach_mcp`**: Detach an MCP server
- **`list_attached_servers`**: List all attached MCP servers
- **`list_mcp_resources`**: List resources from attached servers
- **`drop_virtual_table`**: Drop a virtual table
- **`list_virtual_tables`**: List all virtual tables
- **`refresh_virtual_table`**: Refresh virtual table with latest data

### Virtual Table Features

- **Auto-refresh**: Automatically update virtual tables at specified intervals
- **Lazy Loading**: Load data only when first accessed
- **Row Limiting**: Control memory usage by limiting rows
- **Hybrid Queries**: Seamlessly join local and remote data
- **Resource Mapping**: Automatic detection and conversion of JSON, CSV, and Parquet formats
- **Caching**: Configurable caching for improved performance

## Examples

### Running Examples

```bash
# Test MCP Inspector compatibility
npm run example:inspector

# Run client library example
npm run example:client

# Test basic server functionality
npm run example:test
```

### Using the MCP Client Library

```typescript
import { DuckDBService } from '@deposium/duckdb-mcp-native'
import { MCPClient, VirtualTableManager } from '@deposium/duckdb-mcp-native/client'

// Initialize services
const duckdb = new DuckDBService()
const mcpClient = new MCPClient()
const virtualTables = new VirtualTableManager(duckdb, mcpClient)

// Attach external MCP server
await mcpClient.attachServer('stdio://data-server', 'external', 'stdio')

// Create virtual table from MCP resource
await virtualTables.createVirtualTable('external_data', 'data://sales', 'external', {
  autoRefresh: true,
  refreshInterval: 60000,
})

// Execute hybrid query
const results = await virtualTables.executeHybridQuery(
  'SELECT * FROM local_table JOIN external_data ON ...'
)
```

## Configuration

Create a `.env` file based on `.env.example`:

```env
# DuckDB Configuration
DUCKDB_MEMORY=4GB
DUCKDB_THREADS=4

# MCP Server Configuration
MCP_SERVER_NAME=duckdb-mcp-native
MCP_SERVER_VERSION=0.1.0
MCP_MODE=stdio

# Security Configuration
MCP_SECURITY_MODE=development
MCP_MAX_QUERY_SIZE=1000000
MCP_QUERY_TIMEOUT=30000

# S3/MinIO Configuration (optional)
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=your_access_key
MINIO_SECRET_KEY=your_secret_key
MINIO_USE_SSL=false
MINIO_REGION=us-east-1
```

## Usage Examples

### Using as a Library

```typescript
import { DuckDBMCPServer } from '@deposium/duckdb-mcp-native'

// Create and start server
const server = new DuckDBMCPServer()
await server.start()
```

### Direct DuckDB Usage

```typescript
import { getDuckDBService } from '@deposium/duckdb-mcp-native'

// Get DuckDB service instance
const duckdb = await getDuckDBService({
  memory: '4GB',
  threads: 4,
})

// Execute queries
const results = await duckdb.executeQuery('SELECT * FROM my_table')
console.log(results)

// Load Parquet files
const data = await duckdb.readParquet('s3://bucket/data.parquet')
console.log(data)
```

### Creating Custom MCP Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Create client
const client = new Client({
  name: 'my-client',
  version: '1.0.0',
})

// Connect to server
const transport = new StdioClientTransport({
  command: 'tsx',
  args: ['src/server/mcp-server.ts'],
})

await client.connect(transport)

// Call tools
const result = await client.callTool('query_duckdb', {
  sql: 'SELECT COUNT(*) FROM my_table',
})
```

## Architecture

```
src/
├── duckdb/           # DuckDB service layer
│   ├── service.ts    # Core DuckDB operations
│   └── types.ts      # Type definitions
├── client/           # MCP Client (Phase 2)
│   ├── MCPClient.ts  # External MCP server connections
│   ├── ResourceMapper.ts # Resource to table mapping
│   ├── VirtualTable.ts   # Virtual table management
│   └── index.ts      # Client exports
├── server/           # MCP Server
│   └── mcp-server.ts # Main server implementation
├── examples/         # Usage examples
│   ├── client-example.ts       # Client library usage
│   ├── mcp-inspector-test.ts   # MCP Inspector compatibility
│   └── test-server.ts          # Basic server testing
└── index.ts          # Main entry point
```

### Component Overview

```
├── protocol/          # MCP Protocol implementation
│   ├── types.ts       # TypeScript types for JSON-RPC 2.0
│   ├── messages.ts    # Message formatting and routing
│   └── transport.ts   # Transport implementations (stdio, TCP, WebSocket)
├── server/            # MCP Server
│   └── mcp-server.ts  # Main server implementation
├── duckdb/            # DuckDB integration
│   └── service.ts     # DuckDB service wrapper
└── index.ts           # Main exports
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

## Security Modes

### Development Mode (default)

- All SQL queries allowed
- No query size limits
- Verbose logging

### Production Mode

- Dangerous SQL operations blocked (DROP, TRUNCATE, etc.)
- Query size limits enforced
- Security validation on all queries

Set via environment variable:

```bash
MCP_SECURITY_MODE=production
```

## Roadmap

- [x] **Phase 1: Core Protocol Implementation** ✅
  - [x] JSON-RPC 2.0 message layer
  - [x] Stdio transport
  - [x] Basic error handling
  - [x] Security: SQL injection prevention

- [x] **Phase 2: DuckDB Integration** ✅
  - [x] Query execution with auto-limiting
  - [x] Table management
  - [x] File loading (CSV, Parquet, JSON)
  - [x] Data export capabilities

- [x] **Phase 3: MCP Client & Service** ✅
  - [x] MCP client for external resources
  - [x] Virtual table mapping
  - [x] Resource caching (5-min TTL)
  - [x] DuckDBMcpNativeService unified API
  - [x] 9+ MCP management tools
  - [ ] TCP and WebSocket transports
  - [ ] Virtual filesystem for mcp:// URIs

- [ ] **Phase 4: Production Ready**
  - [x] Comprehensive test suite (24 tests)
  - [x] CI/CD with GitHub Actions
  - [ ] Performance optimizations
  - [ ] Connection pooling
  - [ ] Authentication layer
  - [ ] NPM package publication

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
