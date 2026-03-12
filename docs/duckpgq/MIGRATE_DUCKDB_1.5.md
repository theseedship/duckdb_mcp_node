# Migration Plan: DuckDB 1.5.0 + DuckPGQ

**Created**: 2026-03-12
**DuckDB 1.5.0 "Variegata"**: Released 2026-03-09
**Current**: `@duckdb/node-api@1.4.1-r.5` (DuckDB 1.4.1)
**Target**: `@duckdb/node-api@1.5.0-r.1` (DuckDB 1.5.0)

---

## Context

DuckDB 1.5.0 was released on March 9, 2026. The `@duckdb/node-api` package already has a compatible release (`1.5.0-r.1`). The DuckPGQ extension repository merged v1.5.0 compatibility refs on Feb 27, 2026, but community extension binary availability for 1.5.0 is **unconfirmed**.

### What We're Upgrading

| Component               | Current               | Target            | npm Available? |
| ----------------------- | --------------------- | ----------------- | -------------- |
| `@duckdb/node-api`      | `1.4.1-r.5`           | `1.5.0-r.1`       | ✅ Yes         |
| `@duckdb/node-bindings` | (transitive)          | `1.5.0-r.1`       | ✅ Yes         |
| DuckPGQ extension       | `7705c5c` (community) | v1.5.0-compatible | ⚠️ TBD         |

### Risk Assessment

| Area                        | Risk       | Notes                                                            |
| --------------------------- | ---------- | ---------------------------------------------------------------- |
| Node API breaking changes   | **Medium** | Skipping 1.4.2→1.4.4 patch releases — API may have changed       |
| DuckPGQ community binary    | **High**   | May not be published yet for 1.5.0                               |
| Graph tools (iterative SQL) | **Low**    | Don't use DuckPGQ — pure SQL with temp tables                    |
| Test suite (469 tests)      | **Medium** | Need full pass on 1.5.0                                          |
| DuckDB SQL syntax           | **Low**    | 1.5.0 is additive (VARIANT type, new functions), no SQL removals |

---

## DuckDB 1.5.0 Notable Changes

### Relevant to This Project

- **`read_duckdb` function**: Read/glob DuckDB database files — useful for federation
- **`ALTER DATABASE RENAME TO`**: Database management improvement
- **`ATTACH` with recovery mode and `NO_WAL`**: Better attach reliability
- **Parallel destruction of row groups**: Performance for cleanup operations
- **Concurrent insertions during checkpointing**: Less blocking
- **Buffer-managed query results**: Lower memory usage for large results
- **Roaring boolean compression**: Better compression for boolean columns
- **VARIANT type**: Flexible schema support (future use for graph properties)

### Not Directly Relevant But Noteworthy

- GEOMETRY type rework (coordinate reference systems)
- CLI overhaul (we don't use CLI directly)
- AsOf Join improvements
- Encrypted Parquet support

---

## DuckPGQ Status for 1.5.0

### Repository Activity (cwida/duckpgq-extension)

- **2026-02-10**: Commit "Getting ready for v1.5"
- **2026-02-27**: PR #299 merged — branch `v1.5-variegata` into main
- **2026-02-27**: Commits "Update refs to v1.5.0", "Comment out duckdb-next-build"
- **2026-03-02**: Most recent commit ("remove branches")

### Community Extension Binary

**Status: Uncertain**

The DuckPGQ community extension page exists at `duckdb.org/community_extensions/extensions/duckpgq` (6.2k downloads/week, 367 stars). However, the main extensions list filtered for 1.5.0 does not show it yet — the page notes "Community Extensions that support old DuckDB releases are currently not listed."

**Verification needed**: Run `INSTALL duckpgq FROM community; LOAD duckpgq;` on a DuckDB 1.5.0 instance to confirm availability.

### Expected DuckPGQ Improvements in 1.5.0

Based on development activity, potential improvements include:

- Possible standalone Kleene operator support (previously blocked)
- Better error messages for graph queries
- Performance improvements from DuckDB 1.5.0 core changes
- Anonymous edge syntax support (previously required named edge variables)

**These need to be validated** — the DuckPGQ repo has no formal releases or changelogs.

---

## Migration Steps

### Phase 0: Pre-Migration Validation (Before Any Code Changes)

```bash
# 1. Verify @duckdb/node-api 1.5.0-r.1 installs cleanly
npm install @duckdb/node-api@1.5.0-r.1 --dry-run

# 2. Check for breaking changes in node-api
# Review: https://github.com/duckdb/duckdb-node-neo/releases

# 3. Test DuckPGQ binary availability
# Start a quick Node script:
# - Create DuckDB 1.5.0 instance
# - Run: INSTALL duckpgq FROM community; LOAD duckpgq;
# - Report success/failure
```

### Phase 1: DuckDB Core Upgrade

**Files to modify:**

- `package.json`: `"@duckdb/node-api": "1.5.0-r.1"`

**Validation:**

```bash
npm install
npm run build          # TypeScript compiles
npm test               # 469 tests pass
npm run check:all      # Full quality check
```

**Rollback**: `npm install @duckdb/node-api@1.4.1-r.5`

### Phase 2: Node API Compatibility Check

Review `@duckdb/node-api` changelog for breaking changes between 1.4.1-r.5 and 1.5.0-r.1. Key areas to check:

| API Surface                             | Used In                         | Check                                                |
| --------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| `DuckDBInstance.create()`               | `src/duckdb/service.ts:76`      | Constructor signature unchanged?                     |
| `instance.connect()`                    | `src/duckdb/service.ts:77`      | Returns same connection type?                        |
| `connection.run()` / `connection.all()` | Multiple files                  | Query execution API stable?                          |
| Result iteration                        | `src/duckdb/service.ts`         | Row/column access patterns unchanged?                |
| Extension loading (`INSTALL`/`LOAD`)    | `src/duckdb/service.ts:145-283` | Same SQL interface?                                  |
| Config options                          | `src/duckdb/service.ts:67-74`   | `max_memory`, `threads`, `allow_unsigned_extensions` |

### Phase 3: DuckPGQ Extension Validation

**Scenario A: Community binary IS available for 1.5.0**

```bash
# Test with default community source
ENABLE_DUCKPGQ=true DUCKPGQ_SOURCE=community npm run test:duckpgq
npm run test:duckpgq:syntax    # 13 syntax tests
npm run test:duckpgq:failures  # 18 failure analysis tests
```

Validate previously broken features:

```sql
-- Test 1: Standalone Kleene star (previously failed)
FROM GRAPH_TABLE (g MATCH (a:Person)-[e:Knows]->*(b:Person) COLUMNS (a.name, b.name))

-- Test 2: Standalone Kleene plus (previously failed)
FROM GRAPH_TABLE (g MATCH (a:Person)-[e:Knows]->+(b:Person) COLUMNS (a.name, b.name))

-- Test 3: Anonymous edge syntax (previously failed)
FROM GRAPH_TABLE (g MATCH (a:Person)-[:Knows]->(b:Person) COLUMNS (a.name, b.name))

-- Test 4: ALL paths working?
FROM GRAPH_TABLE (g MATCH ALL (a:Person)-[e:Knows]->{1,3}(b:Person) COLUMNS (a.name, b.name))
```

**Scenario B: Community binary NOT yet available for 1.5.0**

Options:

1. **Upgrade DuckDB only, keep DuckPGQ graceful fallback** — graph tools still work (iterative SQL), DuckPGQ SQL features unavailable until binary is published
2. **Wait** — delay entire upgrade until DuckPGQ binary confirmed
3. **Custom build** — build DuckPGQ from source against DuckDB 1.5.0 (advanced)

**Recommended: Option 1** — our graph tools don't depend on DuckPGQ, and `loadDuckPGQ()` already handles graceful fallback.

### Phase 4: Graph Tools Regression Test

Our 8 graph algorithm tools use iterative SQL (no DuckPGQ dependency), but verify they work on DuckDB 1.5.0:

```bash
# Run all graph-related tests
npm test -- --grep "graph"

# Key test files:
# src/tools/graph-centrality.test.ts
# src/tools/graph-community.test.ts
# src/tools/graph-paths.test.ts
# src/tools/graph-temporal.test.ts
# src/tools/graph-export.test.ts
```

### Phase 5: DuckPGQ Feature Matrix Update

After validation, update `docs/DUCKPGQ_INTEGRATION.md` compatibility matrix:

```markdown
| DuckDB Version | DuckPGQ Version | Fixed Paths | ANY SHORTEST | Bounded {n,m} | Standalone Kleene | Status      |
| -------------- | --------------- | ----------- | ------------ | ------------- | ----------------- | ----------- |
| 1.4.x          | 7705c5c         | ✅          | ✅           | ✅            | ❌                | Functional  |
| **1.5.0**      | **TBD**         | **?**       | **?**        | **?**         | **?**             | **Testing** |
```

### Phase 6: Documentation and Release

- Update `package.json` version (1.1.0 for minor DuckDB upgrade)
- Update `CLAUDE.md` with new DuckDB version reference
- Update `docs/DUCKPGQ_INTEGRATION.md` with 1.5.0 results
- Update `docs/duckpgq/MIGRATION_GUIDE.md` with 1.5.0 row
- Add `CHANGELOG.md` entry
- Run `npm run check:all` final validation

---

## Decision Matrix

| Condition                                                          | Action                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| node-api 1.5.0-r.1 + all 469 tests pass + DuckPGQ binary available | Full upgrade, update all docs, release v1.1.0             |
| node-api 1.5.0-r.1 + all tests pass + DuckPGQ binary NOT available | Upgrade DuckDB only, note DuckPGQ pending, release v1.1.0 |
| node-api 1.5.0-r.1 + some tests fail                               | Investigate failures, fix or delay upgrade                |
| node-api 1.5.0-r.1 has breaking API changes                        | Adapt code, extend timeline                               |

---

## Verification Checklist

- [ ] `npm install @duckdb/node-api@1.5.0-r.1` succeeds
- [ ] `npm run build` compiles cleanly
- [ ] `npm test` — all 469 tests pass
- [ ] `npm run check:all` — lint + format + build + tests green
- [ ] DuckPGQ community binary tested on 1.5.0
- [ ] DuckPGQ syntax tests validated (if binary available)
- [ ] DuckPGQ feature matrix updated in docs
- [ ] Graph tools regression tests pass
- [ ] No performance regressions observed
- [ ] Documentation updated
- [ ] Version bumped and changelog updated
- [ ] Published to npm

---

## Timeline Estimate

| Phase                       | Duration | Depends On |
| --------------------------- | -------- | ---------- |
| Phase 0: Pre-validation     | 30 min   | —          |
| Phase 1: Core upgrade       | 1 hr     | Phase 0    |
| Phase 2: API compat check   | 1 hr     | Phase 1    |
| Phase 3: DuckPGQ validation | 1-2 hr   | Phase 1    |
| Phase 4: Graph regression   | 30 min   | Phase 1    |
| Phase 5: Feature matrix     | 30 min   | Phase 3    |
| Phase 6: Docs + release     | 1 hr     | All        |

**Total: ~5-6 hours** (shorter if DuckPGQ binary is available, longer if API changes found)

---

## References

- DuckDB 1.5.0 Release: https://github.com/duckdb/duckdb/releases/tag/v1.5.0
- @duckdb/node-api: https://www.npmjs.com/package/@duckdb/node-api
- DuckPGQ Extension: https://github.com/cwida/duckpgq-extension
- DuckPGQ Community Page: https://duckdb.org/community_extensions/extensions/duckpgq
- DuckDB 1.4.x Issue: https://github.com/cwida/duckpgq-extension/issues/276
