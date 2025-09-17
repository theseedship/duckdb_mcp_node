# Parquet Virtual Table Bug Fix

## Problem Description

When creating virtual tables from Parquet resources via MCP, the tables were incorrectly created with only `type` and `path` columns instead of the actual Parquet data.

## Root Cause

The bug occurred in the data flow between `MCPClient`, `VirtualTable`, and `ResourceMapper`:

```typescript
// Problematic flow:
1. MCPClient.readResource() receives binary Parquet data
2. Saves to temp file: /tmp/mcp_parquet_xxx.parquet
3. Returns object: { type: 'parquet', path: '/tmp/...' }
4. This object gets cached
5. VirtualTable passes object to ResourceMapper
6. ResourceMapper.detectResourceType() stringifies the object
7. String starts with "{" → detected as JSON
8. Creates table with columns: type, path (NOT the actual data!)
```

## Solution Implemented

### 1. ResourceMapper Enhancement

Added special handling for Parquet file reference objects:

```typescript
// In mapResource()
if (data && typeof data === 'object' && data.type === 'parquet' && data.path) {
  // This is a Parquet file reference, not JSON data
  return this.handleParquetFileReference(resourceUri, tableName, data.path, serverAlias)
}
```

### 2. New Handler Method

Created `handleParquetFileReference()` to properly load Parquet files:

```typescript
private async handleParquetFileReference(
  resourceUri: string,
  tableName: string,
  filePath: string,
  serverAlias?: string
): Promise<MappedResource> {
  // Create table from Parquet file
  await this.duckdb.executeQuery(`
    CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} AS
    SELECT * FROM read_parquet(${escapeFilePath(filePath)})
  `)

  // Clean up temp file after loading
  await fs.unlink(filePath).catch(() => {})

  // Return proper metadata
}
```

### 3. Cache Fix

Prevented caching of temp file references:

```typescript
// In MCPClient.readResource()
if (this.config.cacheEnabled) {
  // Don't cache Parquet file references as the temp file will be deleted
  if (!(data && typeof data === 'object' && data.type === 'parquet' && data.path)) {
    this.resourceCache.set(cacheKey, { data, timestamp: Date.now() })
  }
}
```

## Impact

### Before Fix

- Virtual tables from Parquet sources contained only metadata
- Queries failed with "column not found" errors
- Cached references pointed to deleted temp files

### After Fix

- Virtual tables contain actual Parquet data
- All columns properly accessible via SQL
- No invalid cache entries for temp files
- Temp files cleaned up after loading

## Testing

To verify the fix:

```typescript
// 1. Attach an MCP server with Parquet resources
await service.attachMCP('stdio://data-server', 'data')

// 2. Create virtual table from Parquet resource
await service.createVirtualTable('data', 'parquet://sales.parquet', 'sales_table')

// 3. Query should work with actual data
const results = await service.query('SELECT * FROM sales_table')
// Results should contain actual sales data, not { type, path }
```

## Related Issues

- Fixes issue described in `/docs/issues-5.md`
- Aligns Node.js implementation with C++ and Python versions
- Enables proper Parquet support as advertised in README

## Future Improvements

1. Consider streaming Parquet data instead of temp files
2. Add support for Parquet metadata inspection
3. Implement partial Parquet file reading for large files
4. Add Parquet-specific options (compression, row groups)
