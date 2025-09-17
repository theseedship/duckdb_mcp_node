# Claude Code Guidance

This file provides guidance to Claude Code when working with this repository.

## Project Context

Native TypeScript port of DuckDB MCP extension. Implements bidirectional MCP server/client with federation capabilities.

**Status**: Alpha (15% test coverage). Focus on improving stability and test coverage.

## Key Commands

```bash
# Development
npm run dev:server      # Start MCP server
npm run inspector       # Test with Inspector UI
npm test               # Run tests
npm run test:watch     # TDD mode

# Quality (run before committing)
npm run check:all      # Required for CI
npm run lint:fix       # Auto-fix issues
npm run format         # Format code

# Debugging
npm run port:clean     # Fix port issues (common)
npm run inspector:reset # Reset stuck Inspector
```

## Architecture

### Core Components

- `src/server/mcp-server.ts` - MCP server with 14 tools
- `src/duckdb/service.ts` - DuckDB wrapper with pooling
- `src/protocol/` - Transport implementations
- `src/federation/` - ResourceRegistry, ConnectionPool, QueryRouter
- `src/client/` - MCP client for external servers

### Transport Status

- ✅ stdio, WebSocket, TCP
- ⚠️ HTTP (initialization issues)

### Security Modes

- `development` - Permissive (default)
- `production` - Blocks dangerous SQL, enforces limits

## Development Patterns

### Adding MCP Tool

1. Define in `setupHandlers()` ListToolsRequestSchema
2. Add case in CallToolRequestSchema switch
3. Use `this.duckdb` service for implementation
4. Return structured response with success/error

### Error Handling

```typescript
try {
  // Implementation
} catch (error) {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  }
}
```

### Testing

- Co-locate tests with source (`*.test.ts`)
- Use `describe`/`it` blocks
- Mock external dependencies
- Target 80% coverage

## Common Issues

### Port blocked

```bash
npm run port:clean  # Fixes 80% of connection issues
```

### Protocol version

Must use `2025-03-26` in all servers

### TypeScript types

```typescript
// Use:
ReturnType<typeof setTimeout>
// Not: NodeJS.Timeout
```

## Code Standards

- TypeScript strict mode
- Conventional commits (feat:, fix:, etc.)
- ESLint + Prettier on pre-commit
- Zod for runtime validation

## Environment

Required `.env`:

```env
DUCKDB_MEMORY=4GB
DUCKDB_THREADS=4
MCP_SECURITY_MODE=development
# Optional: MINIO_* for S3 storage
```

## Migration Notes

Phase 1 ✅: Core protocol and server
Phase 2 🚧: Federation and virtual tables
Phase 3 📋: Virtual filesystem (mcp:// URIs)
Phase 4 📋: Integration with deposium_MCPs

Differences from C++ version:

- Uses @modelcontextprotocol/sdk
- Node.js async patterns
- stdio + partial transport support
