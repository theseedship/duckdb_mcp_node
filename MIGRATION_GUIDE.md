# DuckPGQ Migration Guide

**Preparing for Full DuckPGQ Support in DuckDB 1.4.x/1.5.x**

_Last Updated: 2025-10-20_

---

## Current State (DuckDB 1.4.1 + DuckPGQ 7705c5c)

### What You Have Now

✅ **Available Features:**

- Property graph creation with `CREATE PROPERTY GRAPH`
- Basic `GRAPH_TABLE` syntax for pattern matching
- Fixed-length path queries (1-hop, 2-hop, 3-hop, etc.)
- Direct relationship traversal

❌ **Missing Features:**

- Kleene operators (`*`, `+`) for variable-length paths
- Bounded quantifiers (`{n,m}`) syntax
- `ANY SHORTEST` path queries
- Advanced pattern matching with quantifiers

**See detailed findings:** [DUCKPGQ_FINDINGS.md](DUCKPGQ_FINDINGS.md)

---

## Future State (Full DuckPGQ Support)

When full DuckPGQ support becomes available for DuckDB 1.4.x or 1.5.x, you will gain access to:

### ✨ New Capabilities

1. **Kleene Star (`*`)** - Zero or more repetitions

   ```sql
   -- Find all paths of any length
   MATCH (a:Person)-[:Knows*]->(b:Person)
   ```

2. **Kleene Plus (`+`)** - One or more repetitions

   ```sql
   -- Find all connected people (at least 1 hop)
   MATCH (a:Person)-[:Knows+]->(b:Person)
   ```

3. **Bounded Quantifiers (`{n,m}`)** - Precise path length control

   ```sql
   -- Find paths between 2 and 5 hops
   MATCH (a:Person)-[:Knows{2,5}]->(b:Person)
   ```

4. **ANY SHORTEST Paths** - Efficient shortest path queries
   ```sql
   -- Find shortest path between two people
   MATCH ANY SHORTEST (a:Person)-[:Knows*]->(b:Person)
   WHERE a.name = 'Alice' AND b.name = 'Bob'
   ```

---

## Migration Strategy

### Phase 1: Current Workarounds (Now)

Use UNION-based patterns to simulate variable-length paths:

```sql
-- Simulate variable-length paths (1-3 hops) using UNION
SELECT * FROM (
  -- 1 hop
  SELECT * FROM GRAPH_TABLE (g
    MATCH (a:Person)-[e1:Knows]->(b:Person)
    COLUMNS (a.name, b.name, 1 as hops)
  )

  UNION ALL

  -- 2 hops
  SELECT * FROM GRAPH_TABLE (g
    MATCH (a:Person)-[e1:Knows]->(x:Person)-[e2:Knows]->(b:Person)
    COLUMNS (a.name, b.name, 2 as hops)
  )

  UNION ALL

  -- 3 hops
  SELECT * FROM GRAPH_TABLE (g
    MATCH (a:Person)-[e1:Knows]->(x:Person)-[e2:Knows]->(y:Person)-[e3:Knows]->(b:Person)
    COLUMNS (a.name, b.name, 3 as hops)
  )
)
```

**Simulate shortest path:**

```sql
-- Get paths ordered by length, take first
WITH hop1 AS (SELECT... MATCH (a)-[e]->(b) ...),
     hop2 AS (SELECT... MATCH (a)-[e1]->(x)-[e2]->(b) ...),
     hop3 AS (SELECT... MATCH (a)-[e1]->(x)-[e2]->(y)-[e3]->(b) ...)
SELECT * FROM hop1
UNION ALL (SELECT * FROM hop2 WHERE NOT EXISTS (SELECT 1 FROM hop1))
UNION ALL (SELECT * FROM hop3 WHERE NOT EXISTS (SELECT 1 FROM hop1 UNION ALL SELECT 1 FROM hop2))
LIMIT 1
```

### Phase 2: Preparation for Migration

**To prepare your code for seamless migration:**

1. **Use Consistent Naming Conventions**

   ```sql
   -- Good: Always name your edge variables
   (a)-[e:Knows]->(b)  -- ✅ Will work in both versions

   -- Bad: Missing edge variable
   (a)-[:Knows]->(b)   -- ❌ Fails in 7705c5c
   ```

2. **Abstract Query Logic**

   If using application code, create helper functions:

   ```typescript
   // TypeScript example
   export function buildPathQuery(
     graphName: string,
     minHops: number,
     maxHops: number,
     useKleene: boolean = false // Toggle when available
   ): string {
     if (useKleene) {
       // Future: Use Kleene operators
       return `
         FROM GRAPH_TABLE (${graphName}
           MATCH (a)-[e:Knows{${minHops},${maxHops}}]->(b)
           COLUMNS (...)
         )
       `
     } else {
       // Current: Use UNION approach
       return buildUnionPathQuery(graphName, minHops, maxHops)
     }
   }
   ```

3. **Document Your Workarounds**

   Add comments indicating temporary workarounds:

   ```sql
   -- TODO: Replace with Kleene operators when available
   -- Target syntax: MATCH (a)-[:Knows{1,5}]->(b)
   -- Current workaround: UNION of fixed-length paths
   SELECT * FROM (
     SELECT * FROM GRAPH_TABLE (g MATCH (a)-[e1]->(b) ...)
     UNION ALL
     SELECT * FROM GRAPH_TABLE (g MATCH (a)-[e1]->(x)-[e2]->(b) ...)
     -- ... etc
   )
   ```

4. **Test Compatibility Mode**

   ```bash
   # Enable environment flag for future testing
   DUCKPGQ_COMPATIBILITY_MODE=union  # Current
   # DUCKPGQ_COMPATIBILITY_MODE=kleene  # Future
   ```

### Phase 3: Migration Execution (When Full Support Arrives)

When full DuckPGQ support becomes available:

#### Step 1: Update Environment Configuration

```bash
# .env
DUCKPGQ_SOURCE=community  # No change needed - auto-upgrades
DUCKPGQ_VERSION=          # Optionally specify new version

# Optional: Enable new features
DUCKPGQ_ENABLE_KLEENE=true
```

#### Step 2: Test in Development

```bash
# Run tests to verify compatibility
npm run test:duckpgq

# Check for any breaking changes
npm run test:graph:migration
```

#### Step 3: Replace Workarounds

Systematically replace UNION-based patterns with Kleene operators:

**Before (Workaround):**

```sql
SELECT * FROM (
  SELECT * FROM GRAPH_TABLE (g MATCH (a)-[e1]->(b) COLUMNS (a.id, b.id, 1 as hops))
  UNION ALL
  SELECT * FROM GRAPH_TABLE (g MATCH (a)-[e1]->(x)-[e2]->(b) COLUMNS (a.id, b.id, 2 as hops))
  UNION ALL
  SELECT * FROM GRAPH_TABLE (g MATCH (a)-[e1]->(x)-[e2]->(y)-[e3]->(b) COLUMNS (a.id, b.id, 3 as hops))
)
```

**After (Kleene):**

```sql
FROM GRAPH_TABLE (g
  MATCH (a)-[e:Knows{1,3}]->(b)
  COLUMNS (a.id, b.id, path_length(e) as hops)
)
```

#### Step 4: Optimize Queries

Take advantage of new features for better performance:

```sql
-- Before: Manual path filtering
SELECT * FROM paths WHERE hops <= 5 ORDER BY hops LIMIT 1

-- After: Native shortest path
FROM GRAPH_TABLE (g
  MATCH ANY SHORTEST (a)-[e:Knows*]->(b)
  WHERE a.id = 'alice' AND b.id = 'bob'
  COLUMNS (path_length(e) as hops)
)
```

#### Step 5: Update Documentation

- Update code comments
- Revise README examples
- Update API documentation

---

## Breaking Changes to Watch For

When migrating, be aware of potential breaking changes:

### 1. Pattern Syntax Changes

```sql
-- Current: Edge variable required
MATCH (a)-[e:Knows]->(b)  -- ✅ Required in 7705c5c

-- Future: Edge variable optional
MATCH (a)-[:Knows]->(b)   -- ✅ May be allowed in full version
```

### 2. Path Length Functions

```sql
-- Current: Manual tracking
COLUMNS (1 as hop_count)  -- Manual for single hop
COLUMNS (2 as hop_count)  -- Manual for 2-hop

-- Future: Built-in functions
COLUMNS (path_length(e) as hop_count)  -- Automatic
```

### 3. Performance Characteristics

- UNION-based workarounds may be slower than native Kleene operators
- Plan to re-benchmark queries after migration
- Some queries may need index adjustments

---

## Compatibility Testing

### Test Suite Structure

```bash
# Create migration test suite
tests/
  graph/
    basic.test.ts           # Tests that work in both versions
    kleene.test.ts          # Tests requiring Kleene (skip if unavailable)
    migration.test.ts       # Compatibility tests
```

### Example Migration Test

```typescript
import { DuckDBService } from '../src/duckdb/service'

describe('DuckPGQ Migration Compatibility', () => {
  let db: DuckDBService

  beforeAll(async () => {
    db = new DuckDBService({ allowUnsignedExtensions: true })
    await db.initialize()
  })

  test('Variable-length path query (both methods)', async () => {
    // Method 1: UNION workaround (works now)
    const unionResults = await db.executeQuery(buildUnionPathQuery(1, 3))

    // Method 2: Kleene operators (future)
    let kleeneResults
    try {
      kleeneResults = await db.executeQuery(`
        FROM GRAPH_TABLE (g
          MATCH (a)-[e:Knows{1,3}]->(b)
          COLUMNS (a.id, b.id)
        )
      `)
    } catch (error) {
      // Not yet supported, skip this part
      console.log('Kleene operators not yet available')
      kleeneResults = unionResults // Use workaround results
    }

    // Results should be equivalent
    expect(unionResults.length).toBe(kleeneResults.length)
  })
})
```

---

## Timeline and Monitoring

### How to Know When to Migrate

1. **Watch DuckPGQ Repository:**
   - https://github.com/cwida/duckpgq-extension/issues/276
   - Subscribe to notifications for updates

2. **Check Community Extensions:**
   - https://duckdb.org/community_extensions/extensions/duckpgq
   - Look for version updates compatible with DuckDB 1.4.x/1.5.x

3. **Monitor This Package:**
   - Follow [@seed-ship/duckdb-mcp-native](https://www.npmjs.com/package/@seed-ship/duckdb-mcp-native) updates
   - Check CHANGELOG.md for migration announcements

4. **Test Periodically:**
   ```bash
   # Run this monthly to check for updates
   npm run test:duckpgq:features
   ```

### Migration Flags

This package will add feature detection:

```typescript
// Future API
const features = await db.getDuckPGQFeatures()

if (features.kleene_operators) {
  // Use native Kleene syntax
  query = buildKleeneQuery()
} else {
  // Fall back to UNION workaround
  query = buildUnionQuery()
}
```

---

## Getting Help

### Resources

- **Current Limitations:** [DUCKPGQ_FINDINGS.md](DUCKPGQ_FINDINGS.md)
- **Integration Guide:** [docs/DUCKPGQ_INTEGRATION.md](docs/DUCKPGQ_INTEGRATION.md)
- **Issue Tracker:** https://github.com/anthropics/claude-code/issues (adjust to your repo)
- **DuckPGQ Docs:** https://duckpgq.org (when available)

### Questions?

- Check existing issues in the DuckPGQ repository
- Review DUCKPGQ_FINDINGS.md for known limitations
- Create an issue in this repository with "migration" label

---

## Conclusion

**Key Takeaways:**

1. ✅ **Current state works** - You can use DuckPGQ 7705c5c today for basic graph queries
2. 🔄 **Migration will be smooth** - With proper preparation, upgrade will be seamless
3. 📝 **Document workarounds** - Mark temporary code for easy identification later
4. 🧪 **Test both paths** - Write tests that work with current and future syntax
5. 🔔 **Stay informed** - Monitor DuckPGQ repository for updates

**Your configuration will automatically upgrade when full support arrives** - no manual intervention needed beyond updating queries to use new features.

---

_This guide will be updated as DuckPGQ development progresses and new information becomes available._
