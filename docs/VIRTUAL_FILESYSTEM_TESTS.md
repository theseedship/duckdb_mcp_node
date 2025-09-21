# Virtual Filesystem Testing Guide

## 🚀 Quick Start

The Virtual Filesystem (v0.6.0) enables direct SQL access to MCP resources using `mcp://` URIs. This guide provides test queries to verify the implementation.

## 🎯 Quick Validation Test

Run this single query to validate everything works:

```sql
-- Quick test: Create, export, and read data
CREATE TABLE quick_test AS SELECT 1 as id, 'VFS Test' as name;
COPY quick_test TO '/tmp/quick.csv' (FORMAT CSV, HEADER);
SELECT 'Success!' as status, COUNT(*) as rows FROM read_csv_auto('/tmp/quick.csv')
```

If this returns "Success!" with 1 row, your system is ready!

## 📋 Prerequisites

1. Start the MCP Inspector:

```bash
npm run inspector
```

If port is blocked:

```bash
npm run inspector:clean  # Kill processes on ports 6274/6277
npm run inspector        # Restart
```

2. Open browser at: http://localhost:6274/

3. Navigate to the "Tools" tab

4. Use the `query_duckdb` tool for all queries below

**Important:** Don't use semicolons at the end of SELECT statements with `read_*` functions

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

#### Test 1.4 - Working with JSON Data

First, create a JSON file:

```sql
COPY (SELECT 1 as x, 'a' as y UNION ALL SELECT 2, 'b')
TO '/tmp/test_data.json' (FORMAT JSON, ARRAY true)
```

**Expected:** Success message showing "Count: 2"

Then read the JSON file:

```sql
SELECT * FROM read_json_auto('/tmp/test_data.json')
```

**Expected:** Returns 2 rows with columns x and y

#### Test 1.5 - Complete Format Test Sequence

Create a test table with data:

```sql
CREATE TABLE test_formats (id INT, name VARCHAR, value DOUBLE);
INSERT INTO test_formats VALUES
  (1, 'Alice', 100.5),
  (2, 'Bob', 200.75),
  (3, 'Charlie', 150.25)
```

**Expected:** Table created with 3 rows

Export to all formats:

```sql
COPY test_formats TO '/tmp/test_all.csv' (FORMAT CSV, HEADER)
```

```sql
COPY test_formats TO '/tmp/test_all.parquet' (FORMAT PARQUET)
```

```sql
COPY test_formats TO '/tmp/test_all.json' (FORMAT JSON, ARRAY true)
```

**Expected:** Three files created successfully

Verify all formats work:

```sql
SELECT 'CSV' as format, COUNT(*) as rows FROM read_csv_auto('/tmp/test_all.csv')
UNION ALL
SELECT 'Parquet', COUNT(*) FROM read_parquet('/tmp/test_all.parquet')
UNION ALL
SELECT 'JSON', COUNT(*) FROM read_json_auto('/tmp/test_all.json')
```

**Expected:** 3 rows showing each format with count=3

### Level 2: Virtual Filesystem Syntax Validation

#### Test 2.1 - Verify VFS Module is Loaded

```sql
SELECT 'Virtual FS Ready!' as status,
       version() as duckdb_version,
       current_timestamp as test_time
```

**Expected:** Returns status with DuckDB version (should be 1.4.0-r.1 or higher)

#### Test 2.2 - Test MCP URI Recognition (Expected to fail)

```sql
-- This validates that mcp:// URIs are being processed
-- It should fail with "Resource not found" not "Invalid syntax"
SELECT * FROM 'mcp://test-server/data.csv'
```

**Expected:** Error message like "Resource not found" or "Failed to resolve URI"
**Important:** If you get "syntax error", the VFS is not properly integrated

#### Test 2.3 - Test Different MCP URI Formats

Try these URI patterns (all should fail with resource errors, not syntax errors):

```sql
SELECT 'Testing simple URI' as test, COUNT(*) FROM 'mcp://server/file.json'
```

```sql
SELECT 'Testing path URI' as test, COUNT(*) FROM 'mcp://server/path/to/file.parquet'
```

```sql
SELECT 'Testing glob pattern' as test, COUNT(*) FROM 'mcp://server/*.csv'
```

**Expected:** All should fail with resource/connection errors, NOT syntax errors

### Level 3: Format Detection and File I/O

#### Test 3.1 - Comprehensive Format Testing

Create a master dataset:

```sql
CREATE OR REPLACE TABLE format_test AS
SELECT
  row_number() OVER () as id,
  'User_' || row_number() OVER () as username,
  random() * 1000 as score,
  current_date - (row_number() OVER ()) as date_created
FROM generate_series(1, 10)
```

**Expected:** Table with 10 rows of test data

#### Test 3.2 - Export to All Supported Formats

CSV with headers:

```sql
COPY format_test TO '/tmp/vfs_test.csv' (FORMAT CSV, HEADER true, DELIMITER ',')
```

JSON array format:

```sql
COPY format_test TO '/tmp/vfs_test.json' (FORMAT JSON, ARRAY true)
```

Parquet with compression:

```sql
COPY format_test TO '/tmp/vfs_test.parquet' (FORMAT PARQUET, COMPRESSION 'SNAPPY')
```

**Expected:** Three files created, each with "Count: 10" message

#### Test 3.3 - Validate Format Detection

Read and compare all formats:

```sql
WITH csv_data AS (
  SELECT COUNT(*) as cnt, AVG(score) as avg_score
  FROM read_csv_auto('/tmp/vfs_test.csv')
),
json_data AS (
  SELECT COUNT(*) as cnt, AVG(score) as avg_score
  FROM read_json_auto('/tmp/vfs_test.json')
),
parquet_data AS (
  SELECT COUNT(*) as cnt, AVG(score) as avg_score
  FROM read_parquet('/tmp/vfs_test.parquet')
)
SELECT
  'CSV' as format, c.cnt as rows, ROUND(c.avg_score, 2) as avg FROM csv_data c
UNION ALL
SELECT 'JSON', j.cnt, ROUND(j.avg_score, 2) FROM json_data j
UNION ALL
SELECT 'Parquet', p.cnt, ROUND(p.avg_score, 2) FROM parquet_data p
```

**Expected:** All formats show 10 rows with same average score

#### Test 3.4 - Advanced: Join Across Formats

```sql
SELECT
  csv.id,
  csv.username as csv_user,
  json.username as json_user,
  parquet.username as parquet_user,
  CASE
    WHEN csv.username = json.username AND json.username = parquet.username
    THEN 'MATCH'
    ELSE 'MISMATCH'
  END as validation
FROM read_csv_auto('/tmp/vfs_test.csv') csv
JOIN read_json_auto('/tmp/vfs_test.json') json ON csv.id = json.id
JOIN read_parquet('/tmp/vfs_test.parquet') parquet ON csv.id = parquet.id
LIMIT 5
```

**Expected:** 5 rows showing all usernames match across formats

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

### Level 5: Performance and Stress Testing

#### Test 5.1 - Large Dataset Creation

```sql
CREATE OR REPLACE TABLE perf_test AS
SELECT
  row_number() OVER () as id,
  md5(random()::text) as hash,
  random() * 10000 as value,
  NOW() - (random() * interval '365 days') as timestamp
FROM generate_series(1, 100000)
```

**Expected:** Table with 100,000 rows created

#### Test 5.2 - Performance Comparison

Export large dataset:

```sql
COPY perf_test TO '/tmp/perf_test.parquet' (FORMAT PARQUET)
```

Time the read operations:

```sql
-- Measure Parquet read performance
EXPLAIN ANALYZE
SELECT COUNT(*), AVG(value), MIN(timestamp), MAX(timestamp)
FROM read_parquet('/tmp/perf_test.parquet')
```

**Expected:** Query plan with execution time (should be < 1 second for 100k rows)

#### Test 5.3 - Clean Up Large Files

```sql
DROP TABLE IF EXISTS perf_test;
DROP TABLE IF EXISTS format_test;
DROP TABLE IF EXISTS test_formats;
DROP TABLE IF EXISTS demo;
DROP TABLE IF EXISTS test_all;
```

**Expected:** All test tables removed

## 🎯 Success Criteria

### ✅ Virtual Filesystem is Working if:

1. **Level 1 tests pass:** Basic DuckDB operations work
   - Tables create successfully
   - Data exports to CSV/JSON/Parquet
   - Files can be read back

2. **Level 2 tests validate:** VFS module is integrated
   - DuckDB version shows 1.4.0-r.1 or higher
   - mcp:// URIs are recognized (fail with resource errors, not syntax errors)

3. **Level 3 tests succeed:** Format detection works
   - All formats export and import correctly
   - Data integrity maintained across formats
   - Cross-format joins work

4. **Level 4 preparation:** Ready for MCP servers
   - System can parse mcp:// URIs
   - Error messages indicate missing servers (not syntax issues)

5. **Level 5 performance:** System handles scale
   - Large datasets (100k+ rows) process efficiently
   - Parquet compression works

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
