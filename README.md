# DuckDB MCP Native

[![npm version](https://badge.fury.io/js/@seed-ship%2Fduckdb-mcp-native.svg)](https://www.npmjs.com/package/@seed-ship/duckdb-mcp-native)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Native TypeScript implementation of DuckDB MCP (Model Context Protocol) server with federation capabilities.

## Status

**⚠️ Alpha - Not (yet) production ready** (15% test coverage)

### ✅ Working

- **Core**: Native TypeScript, no C++ dependencies
- **Transports**: stdio ✅ | WebSocket ✅ | TCP ✅ | HTTP ⚠️
- **Federation**: ResourceRegistry, ConnectionPool, QueryRouter
- **Tools**: 14 MCP tools for DuckDB operations
- **Virtual Tables**: JSON/CSV/Parquet with auto-refresh
- **Security**: SQL injection prevention, configurable modes

### 🚧 In Progress

- HTTP transport initialization issues
- MotherDuck cloud integration
- Virtual filesystem (mcp:// URIs)
- Test coverage (target: 80%)

## Installation

### As NPM Package

```bash
# Install from npm
npm install @seed-ship/duckdb-mcp-native
```

### As MCP Server for Claude Desktop

1. **Install the package globally:**

```bash
npm install -g @seed-ship/duckdb-mcp-native
```

2. **Configure Claude Desktop:**

Edit your Claude configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add the DuckDB MCP server:

```json
{
  "mcpServers": {
    "duckdb": {
      "command": "npx",
      "args": ["@seed-ship/duckdb-mcp-native"],
      "env": {
        "DUCKDB_MEMORY": "4GB",
        "DUCKDB_THREADS": "4",
        "MCP_SECURITY_MODE": "development"
      }
    }
  }
}
```

3. **Optional: Configure S3/MinIO for cloud storage:**

```json
{
  "mcpServers": {
    "duckdb": {
      "command": "npx",
      "args": ["@seed-ship/duckdb-mcp-native"],
      "env": {
        "DUCKDB_MEMORY": "4GB",
        "DUCKDB_THREADS": "4",
        "MCP_SECURITY_MODE": "development",
        "MINIO_PUBLIC_ENDPOINT": "https://s3.example.com",
        "MINIO_ACCESS_KEY": "your-access-key",
        "MINIO_SECRET_KEY": "your-secret-key",
        "MINIO_REGION": "us-east-1",
        "MINIO_USE_SSL": "true"
      }
    }
  }
}
```

4. **Restart Claude Desktop** to load the MCP server.

### For Development

```bash
git clone https://github.com/theseedship/duckdb_mcp_node
cd duckdb_mcp_node
npm install

# Start MCP server
npm run dev:server

# Test with Inspector
npm run inspector

# Run tests
npm test
```

## MCP Tools (17 Available)

### Database Operations

- `query_duckdb` - Execute SQL queries
- `list_tables` - List schema tables
- `describe_table` - Get table structure
- `load_csv` - Load CSV files
- `load_parquet` - Load Parquet files

### Federation Operations

- `attach_mcp` - Connect external MCP servers
- `detach_mcp` - Disconnect servers
- `list_attached_servers` - Show connections
- `list_mcp_resources` - List available resources
- `create_virtual_table` - Create from MCP resource
- `drop_virtual_table` - Remove virtual table
- `list_virtual_tables` - Show virtual tables
- `refresh_virtual_table` - Update table data
- `query_hybrid` - Query across local/remote data

### DuckLake Operations (Advanced)

- `ducklake.attach` - Attach or create DuckLake catalog for ACID transactions
- `ducklake.snapshots` - List, view, clone or rollback table snapshots
- `ducklake.time_travel` - Execute queries on historical data

## 🎯 Three Usage Modes

This package supports three distinct usage modes to fit different integration scenarios:

### Mode 1: Standalone Server

Run DuckDB MCP as an independent server that other applications can connect to.

```bash
# Configure in .env
DUCKDB_MEMORY=4GB
DUCKDB_THREADS=4
MCP_SECURITY_MODE=development

# Start server
npm run dev:server
# Or with npx
npx @seed-ship/duckdb-mcp-native
```

**Use case:** When you need a dedicated DuckDB service that multiple clients can connect to.

### Mode 2: Library Mode (/lib)

Import tool handlers directly into your existing MCP server without any auto-initialization.

```typescript
// Import from /lib for clean library mode (v0.3.0+)
import { nativeToolHandlers, nativeToolDefinitions } from '@seed-ship/duckdb-mcp-native/lib'

// Register tools in your MCP server
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [...yourTools, ...nativeToolDefinitions],
  }
})

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name in nativeToolHandlers) {
    const handler = nativeToolHandlers[name]
    return await handler(args)
  }
  // ... handle your other tools
})
```

**Use case:** Adding DuckDB capabilities to an existing MCP server (like deposium_MCPs).

### Mode 3: Embedded Server

Create a server instance with full control over its lifecycle and configuration.

```typescript
import { createEmbeddedServer } from '@seed-ship/duckdb-mcp-native/lib'

// Create embedded server with custom config
const duckdbServer = createEmbeddedServer({
  embeddedMode: true, // Prevents stdio transport initialization
  duckdbService: yourDuckDBInstance, // Optional: use your own DuckDB instance
})

// Start when ready
await duckdbServer.start()

// Get handlers bound to this instance
const handlers = duckdbServer.getNativeHandlers()

// Use in your application
const result = await handlers.query_duckdb({
  sql: 'SELECT * FROM users',
  limit: 100,
})
```

**Use case:** Advanced integration scenarios where you need full control over the server lifecycle.

### Quick Integration Example

For most integrations, library mode is the simplest approach:

```typescript
// In your existing MCP server (e.g., deposium_MCPs)
import { nativeToolHandlers, nativeToolDefinitions } from '@seed-ship/duckdb-mcp-native/lib'

// That's it! Tools are now available
console.log('Available DuckDB tools:', Object.keys(nativeToolHandlers))
// Output: ['query_duckdb', 'list_tables', 'describe_table', 'load_csv', 'load_parquet', 'export_data']
```

### Federation Example

```typescript
import { getDuckDBMcpNativeService } from '@seed-ship/duckdb-mcp-native'

const service = getDuckDBMcpNativeService()

// Attach external MCP server
await service.attachMCP('stdio://weather-server', 'weather')

// Create virtual table
await service.createVirtualTable('weather', 'weather://current', 'weather_data')

// Query across local and remote
const results = await service.queryHybrid(
  'SELECT * FROM sales JOIN weather_data ON sales.date = weather_data.date'
)
```

### DuckLake Example (Advanced)

DuckLake provides ACID transactions and time travel capabilities on top of Parquet files:

```typescript
// Attach a DuckLake catalog
await handlers['ducklake.attach']({
  catalogName: 'analytics',
  catalogLocation: 's3://data-lake/analytics',
  format: 'DELTA',
  enableTimeTravel: true,
  retentionDays: 30,
  compressionType: 'ZSTD',
})

// List table snapshots
const snapshots = await handlers['ducklake.snapshots']({
  catalogName: 'analytics',
  tableName: 'sales',
  action: 'list',
})

// Time travel query - query data as it was yesterday
const historicalData = await handlers['ducklake.time_travel']({
  catalogName: 'analytics',
  tableName: 'sales',
  query: 'SELECT SUM(revenue) as total FROM sales',
  timestamp: '2025-01-20T00:00:00Z',
  limit: 100,
})

// Clone a table at specific version
await handlers['ducklake.snapshots']({
  catalogName: 'analytics',
  tableName: 'sales',
  action: 'clone',
  version: 42,
  targetTableName: 'sales_backup_v42',
})

// Rollback to previous version
await handlers['ducklake.snapshots']({
  catalogName: 'analytics',
  tableName: 'sales',
  action: 'rollback',
  version: 41,
})
```

**DuckLake Features:**
- **ACID Transactions**: Ensures data consistency across operations
- **Time Travel**: Query historical data at any point in time
- **Snapshots**: Version control for your data tables
- **Multi-tenant Isolation**: Space-aware catalogs for tenant separation
- **Format Support**: Delta Lake and Apache Iceberg formats
- **Migration Utilities**: Convert existing Parquet/CSV files to DuckLake

## Architecture

```
src/
├── duckdb/          # DuckDB service
├── server/          # MCP server implementation
├── client/          # MCP client for federation
├── federation/      # Federation components
│   ├── ResourceRegistry.ts
│   ├── ConnectionPool.ts
│   └── QueryRouter.ts
└── protocol/        # Transport implementations
```

## Development

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for:

- Testing guide
- Troubleshooting
- Port management
- Debug logging

## Security Modes

- **development**: All queries allowed (default)
- **production**: Blocks DROP/TRUNCATE, enforces limits

Set via: `MCP_SECURITY_MODE=production`

## Scripts

```bash
npm run dev:server      # Start MCP server
npm run inspector       # MCP Inspector UI
npm test               # Run tests
npm run lint:fix       # Fix linting
npm run build          # Compile TypeScript
npm run port:clean     # Clear stuck ports
```

## Requirements

- Node.js 18+
- TypeScript 5+

## License

MIT
