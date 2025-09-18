# DuckDB MCP Native

[![npm version](https://badge.fury.io/js/@seed-ship%2Fduckdb-mcp-native.svg)](https://www.npmjs.com/package/@seed-ship/duckdb-mcp-native)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Native TypeScript implementation of DuckDB MCP (Model Context Protocol) server with federation capabilities.

## Status

**⚠️ Alpha - Not production ready** (15% test coverage)

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

## Usage

### As MCP Server

```bash
# Configure in .env
DUCKDB_MEMORY=4GB
DUCKDB_THREADS=4
MCP_SECURITY_MODE=development

# Start server
npm run dev:server
```

### As Library

```typescript
import { getDuckDBService } from '@seed-ship/duckdb-mcp-native'

const duckdb = await getDuckDBService()
const result = await duckdb.executeQuery('SELECT * FROM table')
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
