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

```bash
# Install from npm
npm install @seed-ship/duckdb-mcp-native

# Or for development
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

## MCP Tools (14 Available)

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
