# Publishing @seed-ship/duckdb-mcp-native v0.3.0

## ✅ Completed Steps

1. **Fixed DuckDB initialization conflict** - The package no longer auto-initializes when imported
2. **Added library mode support** - New `/lib` export path for clean integration
3. **Created `getToolHandlersWithService`** - Function to use existing DuckDB instances
4. **Added DuckLake service** - Complete lakehouse functionality with ACID transactions
5. **Updated version to 0.3.0** - Package.json updated
6. **Built and tested** - All TypeScript compiled successfully

## 📦 What's New in v0.3.0

### Breaking Changes

- Auto-initialization removed - library mode imports no longer trigger STDIO mode

### New Features

- **Library Mode**: Import handlers without server initialization
- **External DuckDB Support**: Use existing DuckDB instances via `getToolHandlersWithService`
- **DuckLake Service**: Delta Lake-like functionality for DuckDB
  - ACID transactions
  - Time travel queries
  - Version management
  - Catalog management

### Three Usage Modes

1. **Standalone Server** (existing users unaffected)

```bash
npx @seed-ship/duckdb-mcp-native
```

2. **Library Mode** (NEW - for deposium_MCPs integration)

```typescript
import { nativeToolHandlers, nativeToolDefinitions } from '@seed-ship/duckdb-mcp-native/lib'
```

3. **Embedded Server** (NEW - full control)

```typescript
import { createEmbeddedServer } from '@seed-ship/duckdb-mcp-native/lib'
```

## 🚀 To Publish

```bash
# 1. Login to npm (if not already logged in)
cd /home/nico/code_source/tss/duckdb_mcp_node
npm login

# 2. Publish the package
npm publish --access public

# 3. Verify publication
npm view @seed-ship/duckdb-mcp-native@0.3.0
```

## 📝 After Publishing

Update deposium_MCPs to use the new version:

```bash
cd /home/nico/code_source/tss/deposium_MCPs
npm install @seed-ship/duckdb-mcp-native@0.3.0
```

The integration is already updated in deposium_MCPs to use the new `getToolHandlersWithService` function.

## 🎉 Success!

The package has been successfully prepared for v0.3.0 release with:

- ✅ DuckDB initialization conflict resolved
- ✅ Library mode for clean integration
- ✅ DuckLake service for lakehouse functionality
- ✅ Full backward compatibility for existing users
- ✅ Three flexible usage modes documented
