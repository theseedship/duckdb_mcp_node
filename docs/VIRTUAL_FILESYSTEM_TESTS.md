# Virtual Filesystem Testing Guide

## 🚀 Quick Start

The Virtual Filesystem (v0.6.0) enables direct SQL access to MCP resources using `mcp://` URIs. This guide provides test queries to verify the implementation.

## 📋 Prerequisites

1. Start the MCP Inspector:

```bash
npm run inspector
```

2. Open browser at: http://localhost:6274/

3. Navigate to the "Tools" tab

4. Use the `query_duckdb` tool for all queries below

## 🧪 Test Queries

### Level 1: Basic DuckDB Functionality

#### Test 1.1 - Create and Query Table

```sql
CREATE TABLE demo (id INT, name VARCHAR);
INSERT INTO demo VALUES (1, 'Test Virtual FS');
SELECT * FROM demo
```

**Expected:** Returns 1 row with id=1, name='Test Virtual FS'
**Note:** Semicolons at the end are optional - they're automatically handled

#### Test 1.2 - Export to CSV

```sql
COPY (SELECT 1 as id, 'Alice' as name UNION ALL SELECT 2, 'Bob')
TO '/tmp/test.csv' (FORMAT CSV, HEADER)
```

**Expected:** Success message showing "Count: 2", file created at /tmp/test.csv

#### Test 1.3 - Read CSV File

```sql
SELECT * FROM read_csv_auto('/tmp/test.csv')
```

**Expected:** Returns 2 rows (Alice and Bob)
**Important:** Don't use semicolon at the end for SELECT statements with table functions

#### Test 1.4 - Read JSON Data

```sql
SELECT * FROM read_json_auto('[{"x": 1, "y": "a"}, {"x": 2, "y": "b"}]')
```

**Expected:** Returns 2 rows with x and y columns
**Important:** Don't use semicolon at the end for SELECT statements with table functions

### Level 2: Virtual Filesystem Syntax

#### Test 2.1 - Verify VFS Syntax Recognition

```sql
-- This tests that the mcp:// syntax is recognized
SELECT 'Virtual FS Ready!' as status,
       'mcp://server/file.csv syntax supported' as info;
```

**Expected:** Returns status message confirming syntax support

#### Test 2.2 - Test MCP URI (will fail without external server)

```sql
-- This will fail unless you have an MCP server configured
-- The error confirms VFS is trying to resolve the URI
SELECT * FROM 'mcp://weather-server/data.csv';
```

**Expected:** Error "Resource not found" or similar (this is normal without external server)

### Level 3: Format Detection

#### Test 3.1 - Create Multiple Format Files

```sql
-- Create CSV
COPY (SELECT 1 as id, 'csv_test' as format)
TO '/tmp/test_format.csv' (FORMAT CSV, HEADER)
```

Then:

```sql
-- Create JSON
COPY (SELECT 2 as id, 'json_test' as format)
TO '/tmp/test_format.json' (FORMAT JSON)
```

Then:

```sql
-- Create Parquet
COPY (SELECT 3 as id, 'parquet_test' as format)
TO '/tmp/test_format.parquet' (FORMAT PARQUET)
```

**Expected:** Three files created successfully (run each query separately)

#### Test 3.2 - Read Different Formats

```sql
-- Read each format
SELECT 'CSV' as source, * FROM read_csv_auto('/tmp/test_format.csv')
UNION ALL
SELECT 'JSON', * FROM read_json_auto('/tmp/test_format.json')
UNION ALL
SELECT 'Parquet', * FROM read_parquet('/tmp/test_format.parquet')
```

**Expected:** 3 rows showing data from each format
**Note:** No semicolon needed at the end

### Level 4: Advanced Virtual Filesystem (Requires External MCP Server)

These tests require an external MCP server to be configured and running.

#### Test 4.1 - Attach MCP Server

```sql
-- First, use the attach_mcp tool (not query_duckdb)
-- Tool: attach_mcp
-- Parameters:
--   uri: "stdio://path-to-your-server"
--   alias: "myserver"
```

#### Test 4.2 - Query MCP Resource

```sql
-- After attaching, query the resource
SELECT * FROM 'mcp://myserver/resource.csv';
```

#### Test 4.3 - Join Local and Remote Data

```sql
-- Join local table with MCP resource
SELECT l.*, r.*
FROM demo l
JOIN 'mcp://myserver/resource.csv' r ON l.id = r.id;
```

#### Test 4.4 - Glob Pattern Query

```sql
-- Query multiple resources with pattern
SELECT * FROM 'mcp://myserver/logs/*.csv'
WHERE date >= '2024-01-01';
```

## 🎯 Success Criteria

### ✅ Virtual Filesystem is Working if:

1. **Level 1 tests pass:** Basic DuckDB operations work
2. **Level 2.1 passes:** VFS syntax is recognized
3. **Level 2.2 fails with "Resource not found":** VFS is trying to resolve URIs
4. **Level 3 tests pass:** Format detection works

### ⚠️ Common Issues

| Issue                           | Solution                                                |
| ------------------------------- | ------------------------------------------------------- |
| "Database not initialized"      | Restart Inspector: `npm run inspector`                  |
| "Permission denied" on /tmp     | Use different path or check permissions                 |
| "Resource not found" for mcp:// | Normal without external MCP server                      |
| "Invalid URI"                   | Check URI format: `mcp://server/path`                   |
| "syntax error at or near LIMIT" | Don't use `;` at the end of SELECT with table functions |

### 🔧 Known Issues & Fixes

#### Semicolon Handling (Fixed in latest version)

- **Issue:** Queries ending with `;` could cause syntax errors when using table functions
- **Cause:** The tool automatically adds `LIMIT 1000` to SELECT queries, resulting in `; LIMIT 1000`
- **Fix Applied:** The tool now strips trailing semicolons before adding LIMIT
- **Best Practice:** Omit semicolons at the end of SELECT statements with `read_*` functions

## 📊 Diagnostic Queries

#### Check DuckDB Version

```sql
SELECT version();
```

#### List All Tables

```sql
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'main';
```

#### Check Available Extensions

```sql
SELECT * FROM duckdb_extensions();
```

#### Clean Up Test Data

```sql
DROP TABLE IF EXISTS demo;
-- Remove test files manually: rm /tmp/test*.{csv,json,parquet}
```

## 🔗 Next Steps

1. **Configure External MCP Servers:** Set up weather-server, github-server, etc.
2. **Test Federation:** Use `attach_mcp` to connect multiple servers
3. **Create Virtual Tables:** Map MCP resources to persistent tables
4. **Test Caching:** Verify TTL and LRU eviction with repeated queries
5. **Performance Testing:** Compare direct file access vs mcp:// URIs

## 📚 Related Documentation

- [Virtual Filesystem Architecture](./architecture/virtual-filesystem.md)
- [MCP Federation Guide](./federation/README.md)
- [DuckDB MCP Tools Reference](../README.md#mcp-tools-25-available)

---

**Note:** The Virtual Filesystem is designed to work with external MCP servers. Without configured servers, only the syntax validation tests will fully succeed. This is expected behavior.
