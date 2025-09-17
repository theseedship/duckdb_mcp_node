# DuckDB MCP Node.js Architecture

## Overview

This is the **Node.js/TypeScript implementation** of the DuckDB MCP (Model Context Protocol) server, providing feature parity with:

- [C++ duckdb_mcp](https://github.com/teaguesterling/duckdb_mcp) - The original extension
- [Python mcp-server-motherduck](https://github.com/motherduckdb/mcp-server-motherduck) - MotherDuck's implementation

## Current Implementation Status

### ✅ Implemented Features

#### Core MCP Protocol

- JSON-RPC 2.0 message handling
- Request/Response pattern
- Resource listing and reading
- Tool execution framework
- Zod schema validation

#### DuckDB Integration

- Query execution with parameterization
- Table management (create, drop, describe)
- File loading (CSV, Parquet, JSON)
- S3/MinIO integration
- SQL injection prevention

#### MCP Server (14 Working Tools)

1. `query_duckdb` - Execute SQL queries
2. `list_tables` - List database tables
3. `describe_table` - Get table structure
4. `load_csv` - Import CSV files
5. `load_parquet` - Import Parquet files
6. `attach_mcp` - Connect to external MCP servers
7. `detach_mcp` - Disconnect MCP servers
8. `list_attached_servers` - Show connected servers
9. `list_mcp_resources` - List available resources
10. `create_virtual_table` - Map resources to tables
11. `drop_virtual_table` - Remove virtual tables
12. `list_virtual_tables` - Show virtual tables
13. `refresh_virtual_table` - Update table data
14. `query_hybrid` - Query across local/virtual tables

#### MCP Client

- Attach/detach external MCP servers (stdio only)
- Resource discovery and reading
- Virtual table creation from resources
- 5-minute TTL resource caching
- Tool invocation on remote servers

### ✅ Recently Completed (Sept 17, 2025)

#### Transport Layer

- ✅ stdio transport (working)
- ✅ HTTP transport (implemented)
- ✅ WebSocket transport (implemented)
- ✅ TCP transport (implemented)

#### Virtual Filesystem

- ❌ MCPFS (C++ has it, we use direct mapping)
- ⚠️ Parquet virtual tables (bug fixed in Sept 2025)
- ✅ JSON virtual tables (working)
- ✅ CSV virtual tables (working)

### 📊 Feature Comparison

| Feature              | C++ Version   | Python Version  | Node.js Version (This) |
| -------------------- | ------------- | --------------- | ---------------------- |
| **Protocol**         | Full MCP      | Full MCP        | Full MCP               |
| **Virtual Tables**   | MCPFS         | Query-based     | Direct mapping         |
| **Binary Resources** | ✅            | ✅              | ✅ (fixed)             |
| **SQL Execution**    | Native        | Native          | Via duckdb-node-neo    |
| **Cloud Storage**    | S3            | S3 + MotherDuck | S3 only                |
| **Security**         | SQL injection | SaaS mode       | SQL injection          |
| **Transports**       | stdio/TCP     | stdio/HTTP/WS   | stdio/HTTP/WS/TCP      |
| **Caching**          | File-based    | In-memory       | In-memory (5min TTL)   |

## Architecture Components

```
src/
├── duckdb/              # DuckDB Integration Layer
│   ├── service.ts       # Core DuckDB operations
│   └── types.ts         # TypeScript type definitions
│
├── server/              # MCP Server Implementation
│   └── mcp-server.ts    # Main server with 14 tools
│
├── client/              # MCP Client Implementation
│   ├── MCPClient.ts     # External server connections
│   ├── ResourceMapper.ts # Resource → Table mapping
│   └── VirtualTable.ts  # Virtual table management
│
├── service/             # Unified Service Layer
│   └── DuckDBMcpNativeService.ts # Combined server/client API
│
└── utils/               # Utilities
    └── sql-escape.ts    # SQL injection prevention
```

## Key Design Decisions

### 1. Pure TypeScript Implementation

- No C++ bindings or compilation needed
- Uses `duckdb-node-neo` for DuckDB integration
- Easier deployment and maintenance

### 2. Resource Mapping Strategy

Unlike the C++ MCPFS approach, we use direct mapping:

- Resources are fetched and cached in-memory
- Temporary files created only for binary data (Parquet)
- Tables created directly from data, not virtual filesystem

### 3. Security Model

- SQL injection prevention via parameterization
- File path validation and escaping
- No SaaS mode yet (planned from Python version)

### 4. Caching Strategy

- 5-minute TTL for resource data
- Skip caching for temp file references (Parquet fix)
- In-memory cache, not persistent

## Known Limitations

### vs C++ Implementation

- Missing MCPFS virtual filesystem
- No TCP transport
- No persistent cache

### vs Python Implementation

- No MotherDuck cloud integration
- No SaaS security mode
- No read scaling tokens
- No HTTP/WebSocket transports

## Future Roadmap

### Phase 1: Transport Layer (Priority)

- [ ] Implement HTTP transport
- [ ] Implement WebSocket transport
- [ ] Add TCP transport for C++ compatibility

### Phase 2: MotherDuck Features

- [ ] Add MotherDuck cloud connection
- [ ] Implement SaaS security mode
- [ ] Add read scaling tokens

### Phase 3: Advanced Features

- [ ] Virtual filesystem (MCPFS-like)
- [ ] Persistent caching
- [ ] Connection pooling
- [ ] Authentication layer

## Testing Status

- **Unit Tests**: 23 passing, 84 skipped (ESM mocking issues)
- **Integration Tests**: Limited
- **Coverage**: ~7-15% (needs improvement)
- **CI/CD**: Passing with Node 18, 20, 22

## Contributing

When adding features, ensure compatibility with:

1. C++ duckdb_mcp behavior
2. Python mcp-server-motherduck API
3. Existing 14 MCP tools

Priority is feature parity over new features.
