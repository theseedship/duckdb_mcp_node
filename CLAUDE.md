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

<!-- gitnexus:start -->

# GitNexus MCP

This project is indexed by GitNexus as **duckdb_mcp_node** (1039 symbols, 2830 relationships, 78 execution flows).

GitNexus provides a knowledge graph over this codebase — call chains, blast radius, execution flows, and semantic search.

## Always Start Here

For any task involving code understanding, debugging, impact analysis, or refactoring, you must:

1. **Read `gitnexus://repo/{name}/context`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run `npx gitnexus analyze` in the terminal first.

## Skills

| Task                                         | Read this skill file                               |
| -------------------------------------------- | -------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/refactoring/SKILL.md`     |

## Tools Reference

| Tool             | What it gives you                                                        |
| ---------------- | ------------------------------------------------------------------------ |
| `query`          | Process-grouped code intelligence — execution flows related to a concept |
| `context`        | 360-degree symbol view — categorized refs, processes it participates in  |
| `impact`         | Symbol blast radius — what breaks at depth 1/2/3 with confidence         |
| `detect_changes` | Git-diff impact — what do your current changes affect                    |
| `rename`         | Multi-file coordinated rename with confidence-tagged edits               |
| `cypher`         | Raw graph queries (read `gitnexus://repo/{name}/schema` first)           |
| `list_repos`     | Discover indexed repos                                                   |

## Resources Reference

Lightweight reads (~100-500 tokens) for navigation:

| Resource                                       | Content                                   |
| ---------------------------------------------- | ----------------------------------------- |
| `gitnexus://repo/{name}/context`               | Stats, staleness check                    |
| `gitnexus://repo/{name}/clusters`              | All functional areas with cohesion scores |
| `gitnexus://repo/{name}/cluster/{clusterName}` | Area members                              |
| `gitnexus://repo/{name}/processes`             | All execution flows                       |
| `gitnexus://repo/{name}/process/{processName}` | Step-by-step trace                        |
| `gitnexus://repo/{name}/schema`                | Graph schema for Cypher                   |

## Graph Schema

**Nodes:** File, Function, Class, Interface, Method, Community, Process
**Edges (via CodeRelation.type):** CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS

```cypher
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
RETURN caller.name, caller.filePath
```

<!-- gitnexus:end -->
