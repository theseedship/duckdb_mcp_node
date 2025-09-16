# DuckDB MCP Native

Native Node.js/TypeScript implementation of DuckDB MCP (Model Context Protocol) extension.

## Features

- 🚀 **Native TypeScript**: Pure Node.js implementation, no C++ dependencies
- 🔧 **MCP Protocol**: Full JSON-RPC 2.0 implementation with stdio/TCP/WebSocket transports
- 📊 **DuckDB Integration**: Execute SQL queries, manage tables, load data files
- 🔒 **Security**: Configurable security modes for development and production
- 📦 **Modular**: Clean architecture with reusable components

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

### `query_duckdb`

Execute SQL queries on DuckDB.

```json
{
  "sql": "SELECT * FROM my_table",
  "limit": 1000
}
```

### `list_tables`

List all tables in DuckDB.

```json
{
  "schema": "main"
}
```

### `describe_table`

Get schema information for a table.

```json
{
  "table_name": "my_table",
  "schema": "main"
}
```

### `load_csv`

Load a CSV file into DuckDB.

```json
{
  "path": "/path/to/file.csv",
  "table_name": "my_table"
}
```

### `load_parquet`

Load a Parquet file into DuckDB.

```json
{
  "path": "s3://bucket/file.parquet",
  "table_name": "my_table"
}
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

- [x] Phase 1: Core Protocol Implementation
  - [x] JSON-RPC 2.0 message layer
  - [x] Stdio transport
  - [x] Basic error handling

- [x] Phase 2: DuckDB Integration
  - [x] Query execution
  - [x] Table management
  - [x] File loading (CSV, Parquet, JSON)

- [ ] Phase 3: Advanced Features
  - [ ] TCP and WebSocket transports
  - [ ] MCP client for external resources
  - [ ] Virtual filesystem for mcp:// URIs
  - [ ] Resource publishing

- [ ] Phase 4: Production Ready
  - [ ] Comprehensive test suite
  - [ ] Performance optimizations
  - [ ] Connection pooling
  - [ ] Rate limiting

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
