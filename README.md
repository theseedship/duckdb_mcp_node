# ⚠️ NOT READY FOR PROD USE - WORK IN PROGRESS

# DuckDB MCP Native

Native Node.js/TypeScript implementation of DuckDB MCP (Model Context Protocol) extension.

## Current Status (September 17, 2025)

**✅ Working Features:**

- Native TypeScript implementation (no C++ dependencies)
- JSON-RPC 2.0 implementation with **all transports**
- DuckDB integration with SQL queries and table management
- SQL injection prevention and security modes
- Resource caching with 5-minute TTL
- 14 MCP server tools for database operations
- Virtual table creation from JSON/CSV/Parquet (Parquet bug fixed!)
- **NEW: HTTP transport with polling support**
- **NEW: WebSocket transport with auto-reconnection**
- **NEW: TCP transport for C++ compatibility**

**🚧 Not Yet Implemented:**

- MotherDuck cloud integration
- Virtual filesystem for mcp:// URIs
- Connection pooling
- Authentication layer
- SaaS security mode (from Python version)
- Full test coverage (currently ~7-15%, not production ready)

## Features

- 🚀 **Native TypeScript**: Pure Node.js implementation, no C++ dependencies
- 🔧 **MCP Protocol**: JSON-RPC 2.0 implementation with stdio, HTTP, WebSocket, and TCP transports
- 📊 **DuckDB Integration**: Execute SQL queries, manage tables, load data files
- 🔒 **Security**: SQL injection prevention, configurable security modes
- 📦 **Modular**: Clean architecture with reusable components
- 🔄 **Resource Management**: Virtual tables, resource mapping, auto-refresh
- 💾 **Smart Caching**: 5-minute TTL resource cache with configurable options
- 🛠️ **Rich Toolset**: 14 MCP server tools for comprehensive database control

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

The MCP server exposes 14 working tools:

### Database Operations (5 tools)

1. **`query_duckdb`** - Execute SQL queries with automatic result limiting
2. **`list_tables`** - List all tables in a schema
3. **`describe_table`** - Get table structure and row count
4. **`load_csv`** - Load CSV files into DuckDB
5. **`load_parquet`** - Load Parquet files into DuckDB

### MCP Client Operations (9 tools)

6. **`attach_mcp`** - Attach external MCP server (stdio transport only)
7. **`detach_mcp`** - Detach MCP server connection
8. **`list_attached_servers`** - List all attached MCP servers
9. **`list_mcp_resources`** - List resources from attached servers
10. **`create_virtual_table`** - Create virtual table from MCP resource
11. **`drop_virtual_table`** - Remove virtual table
12. **`list_virtual_tables`** - List all virtual tables
13. **`refresh_virtual_table`** - Refresh virtual table data
14. **`query_hybrid`** - Execute queries across local and virtual tables

### Note on Tool Availability

The 9 additional tools mentioned in `duckdb-mcp-tools.ts` (mcpServe, mcpAttach, etc.) are programmatic APIs, not exposed as MCP tools through the server protocol.

## Known Limitations

### Transport Support

- ✅ **stdio**: Fully working
- ✅ **HTTP**: Implemented with polling support
- ✅ **WebSocket**: Implemented with auto-reconnection
- ✅ **TCP**: Implemented with keep-alive

### Testing

- Only ~7-15% code coverage
- 15 tests currently skipped in DuckDBMcpNativeService.test.ts
- Limited integration testing

### Features

- No authentication/authorization
- No connection pooling
- No virtual filesystem for mcp:// URIs
- Limited error recovery mechanisms

## API Usage

### TypeScript/JavaScript

```typescript
import { getDuckDBService, getDuckDBMcpNativeService, MCPClient } from '@deposium/duckdb-mcp-native'

// Initialize DuckDB
const duckdb = await getDuckDBService()

// Execute queries
const results = await duckdb.executeQuery('SELECT * FROM employees')

// Start MCP server (stdio transport only)
const service = getDuckDBMcpNativeService()
await service.startServer('my-server', { transport: 'stdio' })

// Connect to external MCP server (stdio only)
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

### ✅ Completed

- **Core Protocol Implementation**
  - JSON-RPC 2.0 message layer
  - Stdio transport only
  - Basic error handling
  - SQL injection prevention (fixed in Sept 2025)

- **DuckDB Integration**
  - Query execution with auto-limiting
  - Table management
  - File loading (CSV, Parquet, JSON)
  - Data export capabilities

- **MCP Client & Service (Partial)**
  - MCP client for external resources
  - Virtual table mapping
  - Resource caching (5-min TTL)
  - 14 working MCP server tools
  - CI/CD with GitHub Actions

### 🚧 In Progress

- **Testing & Stability**
  - Increase test coverage from ~7-15% to 30%+
  - Fix skipped tests (15 tests currently skipped)
  - Add integration tests

### 📋 Planned

- **Transport Layer**
  - [ ] HTTP transport implementation
  - [ ] WebSocket transport implementation
  - [ ] TCP transport implementation

- **Production Features**
  - [ ] Virtual filesystem for mcp:// URIs
  - [ ] Connection pooling
  - [ ] Authentication layer
  - [ ] Performance optimizations
  - [ ] NPM package publication
  - [ ] Comprehensive documentation

### Test Coverage Status

- **Current**: ~7-15% coverage
- **Tests**: 85+ tests written
  - 70+ passing (new tests added Sept 2025)
  - 15 skipped (DuckDBMcpNativeService.test.ts)
- **Target**: 30%+ for alpha, 70%+ for production

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
