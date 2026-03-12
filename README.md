# DuckDB MCP Native

[![npm version](https://badge.fury.io/js/@seed-ship%2Fduckdb-mcp-native.svg)](https://www.npmjs.com/package/@seed-ship/duckdb-mcp-native)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Native TypeScript implementation of DuckDB MCP (Model Context Protocol) server with federation, graph algorithms, and human-in-the-loop security.

**v1.1.0** — DuckDB 1.5.0 + DuckPGQ aec2e25 — 469 tests, 0 failures

## Features

- **32+ MCP Tools**: SQL queries, schema inspection, CSV/Parquet loading, federation, graph algorithms, process mining, data helpers
- **8 Graph Algorithm Tools**: PageRank, eigenvector, community detection, modularity, weighted paths, temporal analysis, period comparison, multi-format export
- **HITL Security**: Production mode asks user confirmation before destructive SQL via MCP elicitation API
- **Federation**: Distributed queries across multiple MCP servers with `mcp://` URIs
- **Virtual Filesystem**: Direct SQL access via `mcp://` URIs with auto-format detection
- **Transports**: stdio, WebSocket, TCP (HTTP client-side)
- **Process Mining**: 3 tools for workflow analysis from Parquet files
- **DuckLake**: ACID transactions and time travel on Parquet files
- **DuckPGQ**: SQL:2023 property graph queries + native CSR algorithms (PageRank, WCC, clustering)
- **Geospatial Graphs**: GEOMETRY + CRS vertex tables work with DuckPGQ graph algorithms
- **MCP SDK 1.26.0**: Pinned, with elicitation API and connect() guard

## Installation

### As MCP Server (Claude Desktop / Claude Code)

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

With S3/MinIO:

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

Config file locations:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### As NPM Package

```bash
npm install @seed-ship/duckdb-mcp-native
```

### For Development

```bash
git clone https://github.com/theseedship/duckdb_mcp_node
cd duckdb_mcp_node
npm install
npm run dev:server    # Start MCP server
npm run inspector     # Test with Inspector UI
npm test              # Run tests
```

## MCP Tools

### Database Operations

| Tool             | Description                             |
| ---------------- | --------------------------------------- |
| `query_duckdb`   | Execute SQL queries with optional LIMIT |
| `list_tables`    | List tables in a schema                 |
| `describe_table` | Get table structure (columns, types)    |
| `load_csv`       | Load CSV files into DuckDB              |
| `load_parquet`   | Load Parquet files into DuckDB          |

### Federation

| Tool                    | Description                    |
| ----------------------- | ------------------------------ |
| `attach_mcp`            | Connect to external MCP server |
| `detach_mcp`            | Disconnect server              |
| `list_attached_servers` | Show connections               |
| `list_mcp_resources`    | List remote resources          |
| `create_virtual_table`  | Create table from MCP resource |
| `drop_virtual_table`    | Remove virtual table           |
| `list_virtual_tables`   | Show virtual tables            |
| `refresh_virtual_table` | Update table data              |
| `query_hybrid`          | Query across local/remote data |

### DuckLake (ACID + Time Travel)

| Tool                   | Description                                |
| ---------------------- | ------------------------------------------ |
| `ducklake.attach`      | Attach or create DuckLake catalog          |
| `ducklake.snapshots`   | List, view, clone, or rollback snapshots   |
| `ducklake.time_travel` | Query historical data at any point in time |

### MotherDuck Cloud

> MotherDuck supports DuckDB 1.4.0–1.4.4. DuckDB 1.5.0 support is expected within weeks (as of March 2026). These tools will activate once MotherDuck supports DuckDB v1.5.x.

| Tool                         | Description                 |
| ---------------------------- | --------------------------- |
| `motherduck.attach`          | Connect to MotherDuck cloud |
| `motherduck.detach`          | Disconnect                  |
| `motherduck.status`          | Check connection and usage  |
| `motherduck.list_databases`  | List cloud databases        |
| `motherduck.create_database` | Create cloud database       |
| `motherduck.query`           | Execute cloud queries       |
| `motherduck.share_table`     | Share local table to cloud  |
| `motherduck.import_table`    | Import cloud table locally  |

---

## Graph Algorithm Tools

8 MCP tools for graph analysis using iterative SQL with temp tables (no recursive CTEs — DuckPGQ workaround).

### Tools

| Tool                     | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `graph.pagerank`         | PageRank centrality with configurable damping/iterations       |
| `graph.eigenvector`      | Eigenvector centrality via power iteration                     |
| `graph.community_detect` | Label propagation community detection                          |
| `graph.modularity`       | Modularity score Q for community quality                       |
| `graph.weighted_path`    | Weighted paths: strongest, cheapest, or combined               |
| `graph.temporal_filter`  | Filter graph by time period, return stats                      |
| `graph.compare_periods`  | Compare two periods (NEW/REMOVED/STRENGTHENED/WEAKENED/STABLE) |
| `graph.export`           | Export as JSON, CSV (Gephi), D3, GraphML, or Parquet           |

### Usage

All tools share a common base schema:

```typescript
import { graphToolHandlers } from '@seed-ship/duckdb-mcp-native/graph'

const result = await graphToolHandlers['graph.pagerank'](
  {
    node_table: 'vars',
    edge_table: 'drives',
    node_id_column: 'var_id',
    source_column: 'from_var',
    target_column: 'to_var',
    weight_column: 'confidence',
    iterations: 20,
    damping: 0.85,
    top_n: 10,
  },
  duckdb
)
// result.nodes = [{ node_id: 4, rank: 0.21 }, ...]
```

### Temporal Analysis

```typescript
// Compare graph evolution across time periods
const changes = await graphToolHandlers['graph.compare_periods'](
  {
    node_table: 'vars',
    edge_table: 'drives',
    source_column: 'from_var',
    target_column: 'to_var',
    weight_column: 'confidence',
    period_column: 'period',
    period_a: '1993-2023',
    period_b: '2020-2023',
  },
  duckdb
)
// changes.summary = { new_edges: 3, removed_edges: 5, strengthened: 2, ... }
```

---

## DuckPGQ Property Graph Support

**SQL:2023 Property Graph queries — with automatic DuckPGQ installation from community repository.**

### Configuration

```bash
# Required for DuckPGQ
ENABLE_DUCKPGQ=true
ALLOW_UNSIGNED_EXTENSIONS=true
DUCKPGQ_SOURCE=community  # Default, no custom URL needed
```

### Compatibility Matrix

| DuckDB Version      | DuckPGQ Version | Fixed Paths | Bounded {n,m} | ANY SHORTEST | Kleene (alone) | Status               |
| ------------------- | --------------- | ----------- | ------------- | ------------ | -------------- | -------------------- |
| 1.0.0 - 1.2.2       | Stable          | ✅          | ✅            | ✅           | ✅             | **Production Ready** |
| 1.4.1               | 7705c5c         | ✅          | ✅            | ✅           | ❌             | Functional           |
| **1.5.0** (current) | **aec2e25**     | **✅**      | **✅**        | **✅**       | **❌**         | **Functional**       |

### What Works (Validated 2026-03-12 — aec2e25 on DuckDB 1.5.0)

✅ **Native CSR Algorithms (NEW in 1.5.0 validation):**

- `pagerank(graph, vertices, edges)` — native PageRank table function
- `weakly_connected_component(graph, vertices, edges)` — WCC table function
- `local_clustering_coefficient(graph, vertices, edges)` — clustering table function
- `summarize_property_graph('graph_name')` — graph statistics
- `vertices(p)` / `edges(p)` / `path_length(p)` — path extraction functions

✅ **GEOMETRY + CRS Integration (NEW):**

- Property graphs with `GEOMETRY` vertex columns
- Spatial functions (`ST_Distance`, `ST_AsText`) in `GRAPH_TABLE COLUMNS`
- `GEOMETRY('OGC:CRS84')` CRS-typed vertex columns
- PageRank/WCC/clustering on GEOMETRY vertex tables

✅ **Graph Query Features:**

- Property graph creation (VERTEX/EDGE TABLES)
- Pattern matching with `GRAPH_TABLE`
- Fixed-length paths (1-hop, 2-hop, N-hop)
- **ANY SHORTEST** path queries with `->*` syntax
- **Bounded quantifiers** `{n,m}` with `->{n,m}` syntax
- WHERE on edges in 1-hop patterns
- CTE wrapping GRAPH_TABLE (no segfault, #276/#294 fixed)
- Edge variable required: `[e:Label]`

❌ **Not Yet Available:**

- `ALL SHORTEST` — "Not implemented yet"
- `CHEAPEST` path matching — not in parser
- Standalone Kleene `->*`/`->+` — blocked (safety: infinite results on cycles)
- Anonymous edges `[:Label]` — requires variable binding `[e:Label]`
- Edge properties in bounded quantifiers `{n,m}` — edge variable not accessible
- Onager extension — not built for DuckDB 1.5.0 yet

**Full capability report**: [`docs/duckpgq/CAPABILITY_REPORT_1.5.md`](docs/duckpgq/CAPABILITY_REPORT_1.5.md)

### Example Queries

```sql
-- Create property graph from existing tables
CREATE PROPERTY GRAPH social_network
  VERTEX TABLES (Person)
  EDGE TABLES (
    Knows
      SOURCE KEY (from_id) REFERENCES Person (id)
      DESTINATION KEY (to_id) REFERENCES Person (id)
  );

-- Direct connections (1-hop) - edge variable required
FROM GRAPH_TABLE (social_network
  MATCH (p1:Person)-[k:Knows]->(p2:Person)
  COLUMNS (p1.name AS person, p2.name AS friend)
);

-- Friends of friends (fixed 2-hop)
FROM GRAPH_TABLE (social_network
  MATCH (p1:Person)-[k1:Knows]->(p2:Person)-[k2:Knows]->(p3:Person)
  WHERE p1.id != p3.id
  COLUMNS (p1.name AS person, p3.name AS friend_of_friend)
);

-- ANY SHORTEST path query
FROM GRAPH_TABLE (social_network
  MATCH p = ANY SHORTEST (start:Person WHERE start.id = 1)-[k:Knows]->*(end:Person WHERE end.id = 10)
  COLUMNS (start.name AS from_person, end.name AS to_person, path_length(p) AS hops)
);

-- Bounded quantifiers (1 to 3 hops)
FROM GRAPH_TABLE (social_network
  MATCH (p1:Person)-[k:Knows]->{1,3}(p2:Person)
  COLUMNS (p1.name AS person, p2.name AS connection)
);
```

**1.5.0 capabilities**: [`docs/duckpgq/CAPABILITY_REPORT_1.5.md`](docs/duckpgq/CAPABILITY_REPORT_1.5.md) | **Migration**: [`docs/duckpgq/MIGRATE_DUCKDB_1.5.md`](docs/duckpgq/MIGRATE_DUCKDB_1.5.md)

---

## Process Mining Tools

Three specialized tools for analyzing workflow processes stored in Parquet files.

| Tool               | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| `process.describe` | List and filter process summaries with confidence scores      |
| `process.similar`  | Find similar processes using vector embeddings (FLOAT[384])   |
| `process.compose`  | Merge multiple processes into unified workflow with QA checks |

### Embeddings & Similarity Search

- Validates embedding dimensions (configurable via `PROCESS_EMBEDDING_DIM`, defaults to 384)
- Automatic fallback to TypeScript L2 distance when DuckDB VSS is unavailable
- Results include `distance_source` field (`duckdb_vss` or `typescript_l2`) for observability

```typescript
const results = await handlers['process.similar']({
  signature_emb: [0.1, 0.2, ...], // 384-dimensional embedding
  k: 5,
  parquet_url: 's3://bucket/signatures.parquet',
})
// { matches: [{ doc_id: 'doc1', distance: 0.45, distance_source: 'duckdb_vss' }] }
```

### Process Composition

- Step normalization (lowercase + trim, handles "Login" vs "login")
- Conflict resolution via median order when multiple processes share a step
- Automatic edge remapping after step deduplication
- QA checks: detects orphan steps, cycles, and duplicate edges

```typescript
const composed = await handlers['process.compose']({
  doc_ids: ['doc1', 'doc2', 'doc3'],
  steps_url: 's3://bucket/steps.parquet',
  edges_url: 's3://bucket/edges.parquet',
})
// {
//   success: true,
//   steps: [...],           // Deduplicated and normalized
//   edges: [...],           // Remapped edges
//   merged_count: 5,
//   qa: { orphan_steps: [], cycles: [], duplicate_edges: [], warnings: [] }
// }
```

### Configuration

```bash
PROCESS_SUMMARY_URL=s3://bucket/process_summary.parquet
PROCESS_STEPS_URL=s3://bucket/process_steps.parquet
PROCESS_EDGES_URL=s3://bucket/process_edges.parquet
PROCESS_SIGNATURE_URL=s3://bucket/process_signatures.parquet
PROCESS_EMBEDDING_DIM=384  # Match your embedding model (e.g., 1024 for text-embedding-3-large)
```

---

## Three Usage Modes

### Mode 1: Standalone Server

```bash
DUCKDB_MEMORY=4GB DUCKDB_THREADS=4 npm run dev:server
# Or: npx @seed-ship/duckdb-mcp-native
```

### Mode 2: Library Mode

Import tool handlers directly into your existing MCP server:

```typescript
import { nativeToolHandlers, nativeToolDefinitions } from '@seed-ship/duckdb-mcp-native/lib'

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...yourTools, ...nativeToolDefinitions],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  if (name in nativeToolHandlers) {
    return await nativeToolHandlers[name](args)
  }
})
```

### Mode 3: Embedded Server

```typescript
import { DuckDBMCPServer } from '@seed-ship/duckdb-mcp-native/server'

const server = new DuckDBMCPServer({
  embeddedMode: true,
  duckdbService: yourDuckDBInstance, // Optional
})
await server.start()
const handlers = server.getNativeHandlers()
```

---

## Virtual Filesystem

Query MCP resources directly in SQL with zero configuration:

```sql
-- Direct access with mcp:// URIs
SELECT * FROM 'mcp://weather-server/forecast.csv';

-- Join across servers
SELECT g.title, j.priority
FROM 'mcp://github/issues.json' g
JOIN 'mcp://jira/tickets.json' j ON g.id = j.github_id;

-- Glob patterns
SELECT COUNT(*) FROM 'mcp://*/logs/2024-*.csv' WHERE level = 'ERROR';
```

Features: auto-format detection (CSV, JSON, Parquet, Arrow, Excel), intelligent caching, glob patterns.

---

## Federation

```typescript
// Attach servers
await handlers['attach_mcp']({
  connectionString: 'stdio://github-mcp-server',
  alias: 'github',
})

// Federated query
const result = await handlers['federate_query']({
  sql: `
    SELECT g.title, s.message
    FROM 'mcp://github/issues.json' g
    JOIN 'mcp://slack/messages.json' s ON g.id = s.issue_id
  `,
})
```

---

## DuckLake (ACID + Time Travel)

```typescript
// Attach catalog
await handlers['ducklake.attach']({
  catalogName: 'analytics',
  catalogLocation: 's3://data-lake/analytics',
  format: 'DELTA',
  enableTimeTravel: true,
})

// Time travel
const historical = await handlers['ducklake.time_travel']({
  catalogName: 'analytics',
  tableName: 'sales',
  query: 'SELECT SUM(revenue) FROM sales',
  timestamp: '2025-01-20T00:00:00Z',
})

// Snapshot management
await handlers['ducklake.snapshots']({
  catalogName: 'analytics',
  tableName: 'sales',
  action: 'rollback',
  version: 41,
})
```

---

## Security

### Modes

- **development** (default): All queries allowed
- **production**: Destructive SQL triggers HITL elicitation

Set via `MCP_SECURITY_MODE=production`

### HITL Elicitation

In production mode, destructive operations (DROP, DELETE, ALTER, TRUNCATE, INSERT, UPDATE, GRANT, REVOKE) trigger a confirmation prompt via the MCP SDK's elicitation API:

| Scenario                                   | Behavior                     |
| ------------------------------------------ | ---------------------------- |
| Client supports elicitation, user confirms | Query executes               |
| Client supports elicitation, user declines | Query blocked                |
| Client does not support elicitation        | Query blocked (safe default) |
| Elicitation times out or errors            | Query blocked                |

Configure timeout: `MCP_ELICIT_TIMEOUT=30000` (ms, default 30s)

---

## Architecture

```
src/
  duckdb/          # DuckDB service with pooling
  server/          # MCP server (32+ tools, HITL security)
  client/          # MCP client for federation
  federation/      # ResourceRegistry, ConnectionPool, QueryRouter
  filesystem/      # Virtual Filesystem (mcp:// URIs)
  protocol/        # Transport implementations (stdio, WS, TCP, HTTP)
  tools/           # Graph, process, data helper, DuckLake, MotherDuck tools
  context/         # Multi-tenant space isolation
  monitoring/      # Performance metrics
```

## Configuration

| Variable                    | Default          | Description                            |
| --------------------------- | ---------------- | -------------------------------------- |
| `DUCKDB_MEMORY`             | `4GB`            | DuckDB memory limit                    |
| `DUCKDB_THREADS`            | `4`              | DuckDB thread count                    |
| `MCP_SECURITY_MODE`         | `development`    | `development` / `production`           |
| `MCP_ELICIT_TIMEOUT`        | `30000`          | HITL elicitation timeout (ms)          |
| `MCP_MAX_QUERY_SIZE`        | `1000000`        | Max SQL query size (chars)             |
| `MCP_CACHE_DIR`             | `/tmp/mcp-cache` | VFS cache directory                    |
| `MCP_CACHE_TTL`             | `300000`         | VFS cache TTL (ms)                     |
| `ENABLE_DUCKPGQ`            | `false`          | Enable DuckPGQ extension               |
| `ALLOW_UNSIGNED_EXTENSIONS` | `false`          | Required for DuckPGQ                   |
| `PROCESS_EMBEDDING_DIM`     | `384`            | Embedding dimension for process mining |

## Scripts

```bash
npm run dev:server        # Start MCP server
npm run inspector         # MCP Inspector UI
npm test                  # Run tests
npm run test:watch        # TDD mode
npm run check:all         # Typecheck + lint + format + tests
npm run lint:fix          # Auto-fix lint issues
npm run format            # Format code
npm run port:clean        # Fix port issues
npm run inspector:reset   # Reset stuck Inspector
```

## Documentation

| Document                                               | Description                           |
| ------------------------------------------------------ | ------------------------------------- |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md)               | Detailed changelog                    |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)           | Development setup guide               |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)         | System architecture                   |
| [`docs/TRANSPORTS.md`](docs/TRANSPORTS.md)             | Transport protocols + HITL flow       |
| [`docs/FEDERATION_GUIDE.md`](docs/FEDERATION_GUIDE.md) | Federation documentation              |
| [`docs/duckpgq/`](docs/duckpgq/)                       | DuckPGQ findings and failure analysis |
| [`docs/roadmap/`](docs/roadmap/)                       | Roadmap and planning                  |

## Requirements

- Node.js 20+
- TypeScript 5+

## License

MIT
