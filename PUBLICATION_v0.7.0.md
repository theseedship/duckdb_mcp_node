# Publication Guide - duckdb_mcp_node v0.7.0

## 📦 Release Summary

**Version**: 0.7.0
**Date**: 2025-10-19
**Status**: Ready for publication
**Package**: `@seed-ship/duckdb-mcp-native`

### 🎯 Key Features

- **DuckPGQ Property Graph Support** (infrastructure ready)
- SQL:2023 standard compliance
- Graceful degradation for DuckDB v1.4.x
- Comprehensive documentation and examples

### ⚠️ Important Notes

- DuckPGQ binaries for DuckDB v1.4.x are **not yet available** (in development)
- Package is **production-ready** - gracefully handles missing extension
- Graph features will **auto-enable** when binaries are published
- All non-graph queries work perfectly

---

## 🚀 Publication Steps

### Step 1: Verify Build

```bash
cd /home/nico/code_source/tss/duckdb_mcp_node

# Check version
grep '"version"' package.json
# Should show: "version": "0.7.0"

# Verify dist/ directory exists
ls -la dist/

# Check git status
git status
# Should be clean on main branch

# Verify tag
git tag -l "v0.7.0"
# Should show v0.7.0
```

### Step 2: Run Final Tests

```bash
# Type check
npm run typecheck

# Run tests (if available)
npm test

# Build
npm run build
```

### Step 3: Publish to npm

```bash
# Login to npm (if not already logged in)
npm login

# Publish (dry run first to check)
npm publish --dry-run

# If everything looks good, publish for real
npm publish --access public
```

### Step 4: Verify Publication

```bash
# Check npm registry
npm view @seed-ship/duckdb-mcp-native version
# Should show: 0.7.0

# Install and test
npm install -g @seed-ship/duckdb-mcp-native
npx @seed-ship/duckdb-mcp-native --version
```

### Step 5: Push to GitHub

```bash
# Push commits
git push origin main

# Push tags
git push origin v0.7.0

# Create GitHub Release (optional)
# Go to: https://github.com/theseedship/duckdb_mcp_node/releases/new
# Tag: v0.7.0
# Title: v0.7.0 - DuckPGQ Property Graph Support
# Copy CHANGELOG content for description
```

---

## 📝 Release Notes (for GitHub Release)

````markdown
# v0.7.0 - DuckPGQ Property Graph Support

## 🎯 Features

- **DuckPGQ Extension Support**: Automatic loading of DuckDB Property Graph Query extension
  - SQL:2023 Property Graphs standard compliance
  - Kleene operators (`*`, `+`), bounded quantifiers (`{n,m}`)
  - `ANY SHORTEST` path queries for optimal traversal
  - Full `GRAPH_TABLE` syntax support

## ⚠️ Compatibility

- ✅ **DuckDB v1.0.0 - v1.2.2**: Full DuckPGQ support
- 🚧 **DuckDB v1.4.x**: Binaries in development (infrastructure ready)
- 📍 Track progress: [cwida/duckpgq-extension](https://github.com/cwida/duckpgq-extension)

## 🔧 Configuration

New environment variables:

- `ALLOW_UNSIGNED_EXTENSIONS=true` - Enable community extensions
- `ENABLE_DUCKPGQ=false` - Suppress DuckPGQ load attempt

## 📚 Documentation

- Comprehensive README section with compatibility matrix
- Example SQL queries for Property Graphs
- Migration guide and best practices

## 🛠️ Technical

- Improved error handling (HTTP 404 detection)
- Graceful degradation - continues without graph features
- Non-blocking initialization
- Tested: Service works correctly without DuckPGQ

## 📦 Installation

```bash
npm install @seed-ship/duckdb-mcp-native@0.7.0
```
````

See [CHANGELOG](docs/CHANGELOG.md) for full details.

```

---

## 🔍 Post-Publication Checklist

- [ ] npm package published successfully
- [ ] Version visible on npmjs.com
- [ ] GitHub commits pushed
- [ ] Tag pushed to GitHub
- [ ] GitHub Release created
- [ ] Update dependent packages (deposium_MCPs)
- [ ] Announce in Discord/community channels
- [ ] Monitor for installation issues

---

## 🐛 Troubleshooting

### Issue: "extension unavailable" message during install

**Expected behavior** - this is normal until DuckPGQ v1.4.x binaries are published.

**User action**: None required, or set `ENABLE_DUCKPGQ=false` to suppress.

### Issue: "graph queries fail"

**Expected behavior** - graph queries will work once DuckPGQ binaries are available.

**Workaround**:
1. Downgrade to DuckDB v1.2.2 for immediate graph support, OR
2. Wait for DuckPGQ v1.4.x release

---

## 📞 Support

- **Issues**: https://github.com/theseedship/duckdb_mcp_node/issues
- **Documentation**: https://github.com/theseedship/duckdb_mcp_node#readme
- **DuckPGQ Status**: https://github.com/cwida/duckpgq-extension

---

Generated: 2025-10-19
Prepared by: Claude Code Assistant
```
