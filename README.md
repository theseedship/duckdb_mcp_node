# DuckDB MCP Native

[![npm version](https://badge.fury.io/js/@seed-ship%2Fduckdb-mcp-native.svg)](https://www.npmjs.com/package/@seed-ship/duckdb-mcp-native)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Native TypeScript implementation of DuckDB MCP (Model Context Protocol) server with federation capabilities.

## Status

**🚀 Release Candidate** (v0.6.8-rc.2)

### ✅ Production-Ready Features

- **Core**: Native TypeScript, no C++ dependencies
- **Transports**: stdio ✅ | WebSocket ✅ | TCP ✅ | HTTP ⚠️
- **Federation**: Distributed queries across multiple MCP servers ✨
- **Tools**: 26 MCP tools including new `federate_query`
- **Virtual Tables**: JSON/CSV/Parquet with auto-refresh
- **Virtual Filesystem**: Direct SQL access via mcp:// URIs
- **Monitoring**: Built-in performance metrics and slow query detection
- **Security**: Enhanced SQL injection prevention, server authentication, path traversal protection

### 🚧 In Progress

- HTTP transport initialization issues
- MotherDuck cloud integration (waiting for DuckDB v1.4.0 support)
- Test coverage improvement (current: ~75%, target: 80%)

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
        "MCP_SECURITY_MODE": "development",
        "MCP_CACHE_DIR": "/tmp/mcp-cache",
        "MCP_CACHE_TTL": "300000",
        "MCP_CACHE_SIZE": "104857600"
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

## MCP Tools (25 Available)

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

### MotherDuck Cloud Operations

**⚠️ Note**: MotherDuck integration requires DuckDB v1.3.2. Currently using v1.4.0 which MotherDuck doesn't support yet. These tools will become functional once MotherDuck adds support for DuckDB v1.4.0 stable.

- `motherduck.attach` - Connect to MotherDuck cloud with token
- `motherduck.detach` - Disconnect from MotherDuck
- `motherduck.status` - Check connection status and usage
- `motherduck.list_databases` - List available cloud databases
- `motherduck.create_database` - Create new cloud database
- `motherduck.query` - Execute queries on MotherDuck cloud
- `motherduck.share_table` - Share local tables to cloud
- `motherduck.import_table` - Import cloud tables to local

## 📊 DuckPGQ Property Graph Support (v0.7.0)

**🚧 Status**: Infrastructure ready, awaiting DuckPGQ binaries for DuckDB v1.4.x

This version adds automatic loading of the **DuckPGQ extension** for SQL:2023 Property Graph queries when available.

### Current Compatibility

- ✅ **DuckDB v1.0.0 - v1.2.2**: DuckPGQ fully supported
- 🚧 **DuckDB v1.4.0+**: DuckPGQ binaries in development (as of 2025-10-19)

**What this means:**

- The extension will automatically load when binaries become available for DuckDB 1.4.x
- Database continues to work normally for non-graph queries
- Set `ENABLE_DUCKPGQ=false` to suppress the info message

### Features (when available)

- **Kleene operators** (`*`, `+`) for path pattern matching
- **Bounded quantifiers** (`{n,m}`) for precise path lengths
- **`ANY SHORTEST` paths** for optimal graph traversal
- **`GRAPH_TABLE` syntax** per SQL:2023 standard

### Configuration

```bash
# Enable unsigned extensions (required for community extensions)
ALLOW_UNSIGNED_EXTENSIONS=true

# Optional: Disable DuckPGQ load attempt
ENABLE_DUCKPGQ=false  # Set to suppress info messages
```

### Example Usage (when binaries available)

```sql
-- Create property graph
CREATE PROPERTY GRAPH social_network
VERTEX TABLES (users)
EDGE TABLES (
  friendships
  SOURCE KEY (user_id) REFERENCES users (id)
  DESTINATION KEY (friend_id) REFERENCES users (id)
);

-- Find paths with Kleene operators
FROM GRAPH_TABLE (social_network
  MATCH (a:users WHERE a.id = 'alice')
        -[e:friendships]->*{1,3}
        (b:users WHERE b.city = 'Paris')
  COLUMNS (a.name, b.name, path_length(e) as hops)
) SELECT *;
```

**Tracking**: Follow [cwida/duckpgq-extension](https://github.com/cwida/duckpgq-extension) for release updates.

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

### Federation Example (v0.6.5) ✨

Federation enables distributed queries across multiple MCP servers using the `mcp://` protocol:

```sql
-- Query GitHub issues directly
SELECT * FROM 'mcp://github/issues.json' WHERE status = 'open'

-- Join local users with remote GitHub data
SELECT u.name, COUNT(g.id) as issue_count
FROM local_users u
JOIN 'mcp://github/issues.json' g ON u.github_username = g.assignee
GROUP BY u.name

-- Aggregate across multiple sources
WITH all_issues AS (
  SELECT 'github' as source, * FROM 'mcp://github/issues.json'
  UNION ALL
  SELECT 'jira' as source, * FROM 'mcp://jira/tickets.json'
)
SELECT source, COUNT(*) as total_issues FROM all_issues GROUP BY source
```

#### Using Federation Tool

```typescript
// Use the new federate_query tool
const result = await handlers['federate_query']({
  sql: `
    SELECT
      g.title as issue,
      s.message as last_commit
    FROM 'mcp://github/issues.json' g
    JOIN 'mcp://slack/messages.json' s ON g.id = s.issue_id
  `,
  explain: false, // Set to true to see query plan
})

// Automatic server registration with attach_mcp
await handlers['attach_mcp']({
  connectionString: 'stdio://github-mcp-server',
  alias: 'github',
})
// Server is now automatically registered with federation!
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

### MotherDuck Cloud Example

MotherDuck enables hybrid execution with cloud storage and compute:

```typescript
// Connect to MotherDuck cloud
await handlers['motherduck.attach']({
  token: process.env.MOTHERDUCK_TOKEN,
  database: 'production',
  endpoint: 'app.motherduck.com', // Optional, defaults to main endpoint
})

// List cloud databases
const databases = await handlers['motherduck.list_databases']()

// Share local table to cloud
await handlers['motherduck.share_table']({
  localTable: 'local_sales',
  cloudTable: 'cloud_sales', // Optional, uses local name if not specified
})

// Query cloud data
const cloudResults = await handlers['motherduck.query']({
  sql: 'SELECT * FROM cloud_sales WHERE region = "US"',
  limit: 1000,
})

// Import cloud table to local
await handlers['motherduck.import_table']({
  cloudTable: 'cloud_analytics',
  localTable: 'local_analytics',
})

// Check connection status
const status = await handlers['motherduck.status']()
console.log(`Connected: ${status.connected}, Storage: ${status.bytesUsed}/${status.bytesLimit}`)

// Disconnect when done
await handlers['motherduck.detach']()
```

**MotherDuck Features:**

- **Hybrid Execution**: Seamlessly query local and cloud data
- **Cloud Storage**: Persistent storage in MotherDuck cloud
- **Collaborative**: Share tables across team members
- **Zero-Copy Cloning**: Efficient table copies in cloud
- **Automatic Scaling**: Cloud compute scales with workload

## 🚀 Virtual Filesystem (v0.6.0)

Query MCP resources directly in SQL with zero configuration:

### Environment Variables

- `MCP_CACHE_DIR`: Directory for caching MCP resources (default: `/tmp/mcp-cache`)
- `MCP_CACHE_TTL`: Cache time-to-live in milliseconds (default: `300000` - 5 minutes)
- `MCP_CACHE_SIZE`: Maximum cache size in bytes (default: `104857600` - 100MB)

### Before (Complex)

```sql
-- Required 3 steps:
CALL attach_mcp('stdio://weather-server', 'weather');
CALL create_virtual_table('weather_data', 'weather://forecast');
SELECT * FROM weather_data;
```

### Now (Simple)

```sql
-- Direct access with mcp:// URIs:
SELECT * FROM 'mcp://weather-server/forecast.csv';
```

### Features

- **Zero Setup**: No manual connection or table creation needed
- **Auto-Detection**: Automatically detects CSV, JSON, Parquet, Arrow, Excel formats
- **Glob Patterns**: Query multiple resources with wildcards
- **Caching**: Intelligent local caching for performance
- **Federation**: Join data across multiple MCP servers

### Examples

```sql
-- Query specific resource
SELECT * FROM 'mcp://github-server/issues.json'
WHERE status = 'open';

-- Join across servers
SELECT g.title, j.priority
FROM 'mcp://github/issues.json' g
JOIN 'mcp://jira/tickets.json' j ON g.id = j.github_id;

-- Glob patterns for multiple files
SELECT COUNT(*) as error_count
FROM 'mcp://*/logs/2024-*.csv'
WHERE level = 'ERROR';

-- Automatic format detection
SELECT * FROM 'mcp://data/users.parquet';  -- Parquet
SELECT * FROM 'mcp://api/response.json';    -- JSON
SELECT * FROM 'mcp://reports/sales.csv';    -- CSV
```

### Configuration

Enable Virtual Filesystem in your DuckDB service:

```typescript
const duckdb = new DuckDBService({
  virtualFilesystem: {
    enabled: true,
    config: {
      cacheDir: '/tmp/mcp-cache',
      defaultTTL: 300000, // 5 minutes
    },
  },
})

// Use VFS-aware query execution
const results = await duckdb.executeQueryWithVFS("SELECT * FROM 'mcp://server/data.csv'")
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
├── filesystem/      # Virtual Filesystem (v0.6.0)
│   ├── VirtualFilesystem.ts
│   ├── URIParser.ts
│   ├── CacheManager.ts
│   ├── FormatDetector.ts
│   └── QueryPreprocessor.ts
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

### Development Scripts

```bash
npm run dev:server      # Start MCP server
npm run inspector       # MCP Inspector UI
npm test               # Run tests
npm run lint:fix       # Fix linting
npm run build          # Compile TypeScript
```

### Port Management

```bash
# Inspector specific
npm run inspector:clean   # Kill Inspector processes on ports 6274/6277
npm run inspector:restart # Clean ports and restart Inspector
npm run inspector:reset   # Force kill and restart (alternative method)

# General port management
npm run port:clean       # Clear stuck ports (5432, 3000, 8080)
npm run port:status     # Check port usage status
npm run port:kill-all   # Force kill all managed ports
```

### Common Issues & Solutions

#### Inspector Port Blocked

If you see `❌ Proxy Server PORT IS IN USE at port 6277 ❌`:

```bash
# Quick fix - clean and restart
npm run inspector:restart

# Alternative if the above doesn't work
npm run inspector:reset

# Manual cleanup if needed
npm run inspector:clean
npm run inspector
```

## Requirements

- Node.js 18+
- TypeScript 5+

## License

MIT
