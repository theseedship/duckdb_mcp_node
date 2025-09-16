# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a native Node.js/TypeScript port of the DuckDB MCP (Model Context Protocol) extension, originally written in C++. The project implements a bidirectional MCP server/client that exposes DuckDB functionality through the Model Context Protocol.

## Key Commands

### Development

```bash
# Start MCP server for testing
npm run dev:server

# Test with MCP Inspector (interactive debugging)
npm run inspector

# Run a single test file
npm test -- src/duckdb/service.test.ts

# Run tests in watch mode for TDD
npm run test:watch
```

### Quality Checks (run before committing)

```bash
# Run all checks (required for CI to pass)
npm run check:all

# Fix linting issues automatically
npm run lint:fix

# Fix formatting issues
npm run format
```

### Build & Release

```bash
# Build for production
npm run build

# Create a new release (follows semantic versioning)
npm run release        # patch release
npm run release:minor  # minor release
npm run release:major  # major release
```

## Architecture & Core Concepts

### MCP Protocol Implementation

The project implements the full JSON-RPC 2.0 protocol for MCP in `src/protocol/`:

- **types.ts**: Zod schemas for type-safe message validation
- **messages.ts**: MessageFormatter handles request/response correlation, MessageRouter dispatches to handlers
- **transport.ts**: Abstract Transport class with StdioTransport implementation (TCP/WebSocket stubs ready)

### DuckDB Service Layer

`src/duckdb/service.ts` wraps the @duckdb/node-api with:

- Connection pooling (singleton pattern)
- S3/MinIO configuration for cloud storage
- Helper methods for common operations (readParquet, readCSV, createTableFromJSON)
- Type-safe query execution with generics

### MCP Server

`src/server/mcp-server.ts` exposes 5 core tools:

- `query_duckdb`: Execute arbitrary SQL with security validation
- `list_tables`, `describe_table`: Schema introspection
- `load_csv`, `load_parquet`: Data ingestion from files/S3

The server implements both resource listing (exposing tables as MCP resources) and tool execution patterns.

### Security Model

Two modes configured via `MCP_SECURITY_MODE`:

- **development**: Permissive, all queries allowed
- **production**: Validates queries against dangerous patterns (DROP, TRUNCATE, etc.), enforces size limits

## Migration Context

This project is Phase 1 of migrating from the C++ duckdb_mcp extension. The migration plan in `docs/migrate-mcp.md` outlines:

- Phase 1 ✅: Core protocol and server implementation
- Phase 2: MCP client for consuming external resources
- Phase 3: Virtual filesystem for `mcp://` URIs
- Phase 4: Integration with deposium_MCPs infrastructure

Key differences from C++ version:

- Uses @modelcontextprotocol/sdk instead of custom JSON-RPC
- Leverages Node.js async patterns vs C++ threading
- Currently stdio-only transport (C++ has TCP/WebSocket)

## Testing Strategy

### Unit Tests

- Test files co-located with source (\*.test.ts)
- Focus on DuckDBService query execution and error handling
- Mock MCP protocol interactions

### Integration Testing

```bash
# Test with real MCP client
npm run example:client

# Manual testing with inspector
npm run inspector
```

## Common Development Patterns

### Adding a New MCP Tool

1. Add tool definition in `setupHandlers()` ListToolsRequestSchema handler
2. Add case in CallToolRequestSchema switch statement
3. Implement tool logic using `this.duckdb` service
4. Return standardized response format with success/error

### Extending DuckDB Functionality

1. Add method to DuckDBService class
2. Follow existing patterns (executeQuery for raw SQL, type-safe wrappers for specific operations)
3. Handle errors with try/catch and meaningful messages
4. Add corresponding test in service.test.ts

### Error Handling

- Use McpError with appropriate ErrorCode for MCP errors
- Log errors to console.error for debugging (filtered in production)
- Return structured error responses in tool outputs

## Environment Configuration

Required `.env` variables:

- `DUCKDB_MEMORY`: Memory allocation (default: 4GB)
- `DUCKDB_THREADS`: Thread count (default: 4)
- `MCP_SECURITY_MODE`: development/production
- `MINIO_*`: Optional S3-compatible storage credentials

## Code Quality Standards

### TypeScript

- Strict mode enabled
- Prefer explicit types over `any` (warnings configured)
- Use Zod for runtime validation of external data

### Commits

- Follow conventional commits (enforced by commitlint)
- Pre-commit hooks run lint-staged (ESLint + Prettier)
- Commits without "feat:", "fix:", etc. will be rejected

### Testing

- Target 80% coverage (configured in jest.config.js)
- Tests required for new features
- Use describe/it blocks for organization
