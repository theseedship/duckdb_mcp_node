# DuckPGQ Integration Guide

Complete guide for integrating and using DuckPGQ Property Graph extension with DuckDB MCP Native.

## Table of Contents

- [Overview](#overview)
- [Compatibility Matrix](#compatibility-matrix)
- [Configuration](#configuration)
- [Installation Sources](#installation-sources)
- [Known Issues](#known-issues)
- [Usage Examples](#usage-examples)
- [Migration Guide](#migration-guide)
- [Troubleshooting](#troubleshooting)

---

## Overview

**DuckPGQ** is a DuckDB extension that adds support for **SQL:2023 Property Graph** queries, enabling powerful graph analytics directly within DuckDB.

### Key Features (Validated 2025-10-20)

- ✅ **SQL:2023 Standard Compliance** - Uses official Property Graph syntax
- ✅ **ANY SHORTEST Paths** - Efficient shortest path algorithms (works in 7705c5c)
- ✅ **Bounded Quantifiers** - Control repetition with `->{n,m}` syntax (works in 7705c5c)
- ⚠️ **Kleene Operators** - Pattern matching with `->*` and `->+` (only with ANY SHORTEST in 7705c5c)
- ✅ **GRAPH_TABLE Syntax** - Advanced pattern matching and traversal

**Note**: Feature availability varies by version. See [Compatibility Matrix](#compatibility-matrix) for details.

### Project Links

- **Official Repository**: [cwida/duckpgq-extension](https://github.com/cwida/duckpgq-extension)
- **DuckDB Community Page**: [duckdb.org/community_extensions/extensions/duckpgq](https://duckdb.org/community_extensions/extensions/duckpgq)
- **Known Issues**: See [Issue #276](https://github.com/cwida/duckpgq-extension/issues/276) for DuckDB 1.4.x status

---

## Compatibility Matrix

| DuckDB Version      | DuckPGQ Version | Fixed Paths | ANY SHORTEST | Bounded {n,m} | Standalone Kleene | Status               |
| ------------------- | --------------- | ----------- | ------------ | ------------- | ----------------- | -------------------- |
| 1.0.0 - 1.2.2       | Stable          | ✅          | ✅           | ✅            | ✅                | **Fully Supported**  |
| 1.3.x               | Partial         | ✅          | ⚠️           | ⚠️            | ⚠️                | **Limited**          |
| **1.4.x** (current) | **7705c5c**     | **✅**      | **✅**       | **✅**        | **❌**            | **Functional**       |
| 1.5.x+              | TBD             | ?           | ?            | ?             | ?                 | Planned              |

**Current Package**: This project uses `@duckdb/node-api ^1.4.1-r.4` (DuckDB 1.4.1)

### Version-Specific Notes

#### DuckDB 1.4.x (Current) - Validated 2025-10-20

- **Status**: DuckPGQ 7705c5c IS available from community repository ✅
- **Installation**: Automatic with `ALLOW_UNSIGNED_EXTENSIONS=true`
- **Features Available**:
  - ✅ Fixed-length paths (1-hop, 2-hop, N-hop)
  - ✅ ANY SHORTEST path queries (with `->*` syntax)
  - ✅ Bounded quantifiers (with `->{n,m}` syntax)
  - ❌ Standalone Kleene operators without ANY SHORTEST
- **Testing**: Run `npm run test:duckpgq:syntax` to validate your setup
- **See**: [DUCKPGQ_FINDINGS.md](../DUCKPGQ_FINDINGS.md) for comprehensive test results

---

## Configuration

### Environment Variables

Add to your `.env` file:

```bash
# Enable/disable DuckPGQ loading
ENABLE_DUCKPGQ=true

# Installation source (community/edge/custom)
DUCKPGQ_SOURCE=community

# Custom repository URL (required if source=custom)
DUCKPGQ_CUSTOM_REPO=https://github.com/user/duckpgq-build/releases/download/v1.4.0/duckpgq.duckdb_extension.gz

# Specific version (optional)
DUCKPGQ_VERSION=

# Strict mode (fail if load unsuccessful)
DUCKPGQ_STRICT_MODE=false

# Required for community extensions
ALLOW_UNSIGNED_EXTENSIONS=true
```

### Configuration Parameters

| Variable                    | Type    | Default     | Description                                           |
| --------------------------- | ------- | ----------- | ----------------------------------------------------- |
| `ENABLE_DUCKPGQ`            | boolean | `true`      | Master switch for DuckPGQ loading                     |
| `DUCKPGQ_SOURCE`            | string  | `community` | Installation source: `community`, `edge`, or `custom` |
| `DUCKPGQ_CUSTOM_REPO`       | string  | -           | URL for custom builds (required if `source=custom`)   |
| `DUCKPGQ_VERSION`           | string  | latest      | Specific version to install                           |
| `DUCKPGQ_STRICT_MODE`       | boolean | `false`     | If `true`, throw error on load failure                |
| `ALLOW_UNSIGNED_EXTENSIONS` | boolean | `false`     | Required for all community extensions                 |

---

## Installation Sources

### 1. Community Source (Recommended for Production)

**Best for**: Production environments, stable releases

```bash
DUCKPGQ_SOURCE=community
```

- Uses official DuckDB community extension repository
- Automatically updated by DuckDB maintainers
- Stable, tested releases
- **Current limitation**: Awaiting DuckDB 1.4.x binaries

**Behavior with DuckDB 1.4.x**:

- Will log info message about unavailability
- Continues without graph features (graceful degradation)
- Auto-enables when official binaries are published

### 2. Edge Source (For Testing)

**Best for**: Early adopters, testing upcoming features

```bash
DUCKPGQ_SOURCE=edge
```

- Accesses pre-release builds (if available via community repo)
- May include experimental features
- Less stable than community releases
- Currently falls back to `community` source

**Note**: For DuckDB 1.4.x, edge builds may not be available via this source. Use `custom` instead.

### 3. Custom Source (For Specific Builds)

**Best for**: Development, testing specific versions, DuckDB 1.4.x compatibility

```bash
DUCKPGQ_SOURCE=custom
DUCKPGQ_CUSTOM_REPO=https://example.com/duckpgq-v1.4.0-compatible.duckdb_extension.gz
```

- Points to a specific extension binary URL
- Full control over version and build
- Useful for:
  - Testing DuckDB 1.4.x compatible builds
  - Internal forks and customizations
  - Specific bug fixes or features

**Requirements**:

- Must be a direct download URL to `.duckdb_extension` or `.duckdb_extension.gz`
- Must match your DuckDB version and platform
- Server must support HTTPS downloads

**Finding Custom Builds**:

1. Check [DuckPGQ Releases](https://github.com/cwida/duckpgq-extension/releases)
2. Look for builds matching your DuckDB version and platform
3. Use direct download URL in `DUCKPGQ_CUSTOM_REPO`

---

## Known Issues

### Issue #276: DuckDB 1.4.x Compatibility

**Status**: 🚧 In Development
**Link**: [cwida/duckpgq-extension#276](https://github.com/cwida/duckpgq-extension/issues/276)

**Description**:
Official DuckPGQ binaries for DuckDB 1.4.x are not yet available in the community repository.

**Impact**:

- Using `DUCKPGQ_SOURCE=community` with DuckDB 1.4.x will fail gracefully
- Graph queries will not work until compatible binaries are available
- All non-graph database operations work normally

**Workarounds**:

**Option 1: Wait for Official Release** (Recommended for Production)

```bash
ENABLE_DUCKPGQ=true
DUCKPGQ_SOURCE=community
# Will auto-enable when binaries are published
```

**Option 2: Use Custom Build** (For Development/Testing)

```bash
DUCKPGQ_SOURCE=custom
DUCKPGQ_CUSTOM_REPO=<URL_TO_COMPATIBLE_BUILD>
```

**Option 3: Downgrade DuckDB** (Not Recommended)

```bash
# In package.json, change:
"@duckdb/node-api": "1.2.2"
# Then use DUCKPGQ_SOURCE=community
```

**Option 4: Disable DuckPGQ** (Suppress Info Messages)

```bash
ENABLE_DUCKPGQ=false
```

---

## Usage Examples

### Basic Property Graph Creation

```sql
-- Create tables for graph data
CREATE TABLE Person (
  id INTEGER PRIMARY KEY,
  name VARCHAR,
  age INTEGER
);

CREATE TABLE Knows (
  from_id INTEGER,
  to_id INTEGER,
  since DATE
);

-- Insert sample data
INSERT INTO Person VALUES (1, 'Alice', 30), (2, 'Bob', 35), (3, 'Carol', 28);
INSERT INTO Knows VALUES (1, 2, '2020-01-01'), (2, 3, '2021-06-15');

-- Create property graph (7705c5c syntax)
CREATE PROPERTY GRAPH social_network
  VERTEX TABLES (Person)
  EDGE TABLES (
    Knows
      SOURCE KEY (from_id) REFERENCES Person (id)
      DESTINATION KEY (to_id) REFERENCES Person (id)
  );
```

### Graph Queries (7705c5c Validated Syntax)

**Find Friends of Friends (Fixed 2-hop)**:

```sql
-- ✅ Works in 7705c5c - note edge variables required
FROM GRAPH_TABLE (social_network
  MATCH (p1:Person)-[e1:Knows]->(p2:Person)-[e2:Knows]->(p3:Person)
  COLUMNS (p1.name AS person, p3.name AS friend_of_friend)
);
```

**Shortest Path (ANY SHORTEST)**:

```sql
-- ✅ Works in 7705c5c! Note: ->* AFTER arrow, WITH path variable
FROM GRAPH_TABLE (social_network
  MATCH p = ANY SHORTEST (p1:Person WHERE p1.name = 'Alice')-[e:Knows]->*(p2:Person WHERE p2.name = 'Carol')
  COLUMNS (p1.name AS start, p2.name AS end, path_length(p) AS hops)
);
```

**Variable-Length Paths (Bounded Quantifiers)**:

```sql
-- ✅ Works in 7705c5c! Note: ->{n,m} AFTER arrow
FROM GRAPH_TABLE (social_network
  MATCH (p1:Person WHERE p1.name = 'Alice')-[e:Knows]->{1,3}(p2:Person)
  COLUMNS (p1.name AS from, p2.name AS to)
);
```

### Advanced Patterns

**Kleene Operators (Limited Support in 7705c5c)**:

```sql
-- ✅ Works WITH ANY SHORTEST:
FROM GRAPH_TABLE (social_network
  MATCH p = ANY SHORTEST (p1:Person)-[e:Knows]->*(p2:Person)
  WHERE p1.name = 'Alice'
  COLUMNS (p1.name AS start, p2.name AS reachable, path_length(p) AS hops)
);

-- ❌ Does NOT work standalone (without ANY SHORTEST):
-- FROM GRAPH_TABLE (social_network
--   MATCH (p1:Person)-[e:Knows]->+(p2:Person)  -- Error: ALL unbounded not possible
-- )

-- ✅ Workaround: Use bounded quantifiers instead
FROM GRAPH_TABLE (social_network
  MATCH (p1:Person)-[e:Knows]->{1,10}(p2:Person)  -- Max 10 hops
  WHERE p1.name = 'Alice'
  COLUMNS (p1.name AS start, p2.name AS reachable)
);
```

---

## Migration Guide

### From Edge to Stable (When Available)

When official DuckDB 1.4.x binaries are published:

1. **Update Configuration**:

   ```bash
   # Change from:
   DUCKPGQ_SOURCE=custom
   DUCKPGQ_CUSTOM_REPO=https://...

   # To:
   DUCKPGQ_SOURCE=community
   # Remove DUCKPGQ_CUSTOM_REPO
   ```

2. **Test Graph Queries**:

   ```bash
   npm run test:duckpgq
   ```

3. **Verify Extension Loading**:
   Check logs for:

   ```
   DuckPGQ extension loaded successfully from DuckDB community repository
   ```

4. **Run Full Test Suite**:
   ```bash
   npm run test
   ```

### From DuckDB 1.2.x to 1.4.x

If you're upgrading from DuckDB 1.2.x (where DuckPGQ worked):

1. **Backup Graph Data**:

   ```sql
   COPY (SELECT * FROM your_graph_data) TO 'backup.parquet';
   ```

2. **Update Package**:

   ```bash
   npm install @duckdb/node-api@^1.4.1-r.4
   ```

3. **Configure Custom Source** (until official release):

   ```bash
   DUCKPGQ_SOURCE=custom
   DUCKPGQ_CUSTOM_REPO=<compatible_build_url>
   ```

4. **Test Migration**:
   ```bash
   npm run inspector
   # Test graph queries in Inspector UI
   ```

---

## Troubleshooting

### Error: "HTTP 404" or "Extension not found"

**Cause**: DuckPGQ binaries not available for your DuckDB version.

**Solution**:

1. Check compatibility matrix above
2. For DuckDB 1.4.x, use `DUCKPGQ_SOURCE=custom` with compatible build
3. Or set `ENABLE_DUCKPGQ=false` to suppress message

### Error: "DUCKPGQ_SOURCE=custom requires DUCKPGQ_CUSTOM_REPO"

**Cause**: Missing custom repository URL.

**Solution**:

```bash
DUCKPGQ_CUSTOM_REPO=https://your-build-url/duckpgq.duckdb_extension.gz
```

### Graph Queries Fail After Successful Load

**Cause**: Possible version mismatch or incomplete installation.

**Solution**:

1. Check extension loaded successfully in logs
2. Verify graph created correctly: `SHOW PROPERTY GRAPHS;`
3. Test with simple query first
4. Check [Issue #276](https://github.com/cwida/duckpgq-extension/issues/276) for known bugs

### Strict Mode Halts Initialization

**Cause**: `DUCKPGQ_STRICT_MODE=true` and extension load failed.

**Solution**:

- **Production**: Use `DUCKPGQ_STRICT_MODE=false` for graceful degradation
- **Development**: Fix extension loading issue or use compatible build

### Performance Issues with Large Graphs

**Recommendations**:

1. Use appropriate indexes on vertex/edge tables
2. Limit path depth with bounded quantifiers `{n,m}`
3. Use `ANY SHORTEST` for single path instead of all paths
4. Consider partitioning large graphs

---

## Testing DuckPGQ Installation

Use the provided test script:

```bash
npm run test:duckpgq
```

This will:

- ✅ Detect configured DuckPGQ source
- ✅ Verify extension loading
- ✅ Execute sample graph queries
- ✅ Report version and capabilities

**Manual Testing**:

```bash
npm run inspector
```

Then in Inspector UI:

```sql
-- Check if DuckPGQ is loaded
SELECT * FROM duckdb_extensions() WHERE extension_name = 'duckpgq';

-- Create test graph
CREATE TABLE test_nodes (id INTEGER PRIMARY KEY);
INSERT INTO test_nodes VALUES (1), (2), (3);

CREATE PROPERTY GRAPH test_graph
  VERTEX TABLES (test_nodes);

SHOW PROPERTY GRAPHS;
```

---

## Additional Resources

- **DuckDB Documentation**: [duckdb.org/docs](https://duckdb.org/docs)
- **SQL:2023 Property Graphs**: [ISO/IEC 9075-16:2023](https://www.iso.org/standard/76585.html)
- **DuckPGQ Repository**: [github.com/cwida/duckpgq-extension](https://github.com/cwida/duckpgq-extension)
- **Community Extensions**: [duckdb.org/community_extensions](https://duckdb.org/community_extensions)

---

## Contributing

Found an issue or have improvements?

- **This Package**: [github.com/theseedship/duckdb_mcp_node/issues](https://github.com/theseedship/duckdb_mcp_node/issues)
- **DuckPGQ Extension**: [github.com/cwida/duckpgq-extension/issues](https://github.com/cwida/duckpgq-extension/issues)

---

_Last updated: 2025-10-20_
