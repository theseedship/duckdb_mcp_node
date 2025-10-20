# DuckPGQ 7705c5c Quick Reference

**For DuckDB 1.4.x | Last Updated: 2025-10-20**

Quick syntax reference for DuckPGQ property graph queries. For detailed explanations, see [DUCKPGQ_FINDINGS.md](DUCKPGQ_FINDINGS.md) and [DUCKPGQ_FAILURE_ANALYSIS.md](DUCKPGQ_FAILURE_ANALYSIS.md).

---

## ⚡ Quick Start

### Minimal Configuration

```bash
# .env file
ENABLE_DUCKPGQ=true
ALLOW_UNSIGNED_EXTENSIONS=true
```

### Create a Property Graph

```sql
CREATE PROPERTY GRAPH my_graph
  VERTEX TABLES (Nodes)
  EDGE TABLES (
    Edges
      SOURCE KEY (from_id) REFERENCES Nodes (id)
      DESTINATION KEY (to_id) REFERENCES Nodes (id)
  );
```

---

## 📐 Syntax Cheat Sheet

### Path Patterns

| Pattern | SQL:2023 (DuckPGQ) | Cypher/Neo4j | Status |
|---------|-------------------|--------------|--------|
| **1-hop** | `-[e:Label]->` | `-[e:Label]->` | ✅ Works |
| **N-hop (fixed)** | `-[e1]->(b)-[e2]->` | `-[e1]->(b)-[e2]->` | ✅ Works |
| **Bounded** | `-[e:Label]->{n,m}` | `-[e:Label]{n,m}->` | ✅ Works (note position!) |
| **Kleene star** | `->*` with ANY SHORTEST | `*->` or `*` | ⚠️ Only with ANY SHORTEST |
| **Kleene plus** | `->+` with ANY SHORTEST | `+->` or `+` | ⚠️ Only with ANY SHORTEST |

**Critical Differences:**
- **DuckPGQ**: Quantifiers AFTER arrow (`->{n,m}`, `->*`)
- **Cypher**: Quantifiers BEFORE arrow (`{n,m}->`, `*->`)

### Edge Variables (REQUIRED)

```sql
-- ❌ WRONG (not supported yet)
(a:Person)-[:Knows]->(b:Person)

-- ✅ CORRECT (always use edge variable)
(a:Person)-[e:Knows]->(b:Person)
```

**Why?** Internal query translation needs named references (temporary limitation).

### Path Quantifiers

```sql
-- ✅ ANY SHORTEST - Returns single shortest path
MATCH p = ANY SHORTEST (a)-[e]->*(b)

-- ❌ ALL - Blocked for unbounded paths (safety feature)
-- MATCH ALL (a)-[e]->*(b)
-- Error: "ALL unbounded with path mode WALK is not possible"

-- ✅ Bounded quantifiers - Works without ANY SHORTEST
MATCH (a)-[e:Label]->{1,5}(b)
```

---

## ✅ What Works (Validated)

### 1. Direct Connections (1-hop)

```sql
FROM GRAPH_TABLE (my_graph
  MATCH (a:Person)-[e:Knows]->(b:Person)
  COLUMNS (a.name, b.name)
)
```

### 2. Fixed-Length Paths (N-hop)

```sql
-- 2-hop: Friends of friends
FROM GRAPH_TABLE (my_graph
  MATCH (a:Person)-[e1:Knows]->(b:Person)-[e2:Knows]->(c:Person)
  WHERE a.id != c.id
  COLUMNS (a.name, c.name)
)

-- 3-hop
MATCH (a)-[e1]->(b)-[e2]->(c)-[e3]->(d)
```

### 3. Shortest Path (ANY SHORTEST)

```sql
-- Find shortest path between two nodes
FROM GRAPH_TABLE (my_graph
  MATCH p = ANY SHORTEST
    (start:Person WHERE start.id = 1)-[e:Knows]->*(end:Person WHERE end.id = 10)
  COLUMNS (start.name, end.name, path_length(p) AS hops)
)
```

**Key syntax points:**
- `p =` assigns path to variable
- `ANY SHORTEST` before pattern
- `->*` AFTER arrow (not before!)
- Edge variable `[e:Knows]` required

### 4. Bounded Variable-Length Paths

```sql
-- Find all paths between 1-3 hops
FROM GRAPH_TABLE (my_graph
  MATCH (a:Person)-[e:Knows]->{1,3}(b:Person)
  COLUMNS (a.name, b.name)
)

-- Exactly 2 hops (alternative to fixed pattern)
MATCH (a)-[e:Label]->{2,2}(b)
```

**Key syntax points:**
- `->{n,m}` quantifier AFTER arrow
- Works without ANY SHORTEST
- Labels required on edges

---

## ❌ Common Errors & Solutions

### Error: "ALL unbounded with path mode WALK is not possible"

**Cause:** Standalone Kleene operators (`->*`, `->+`) without ANY SHORTEST

```sql
-- ❌ WRONG - Blocked by design (safety feature)
MATCH (a)-[e:Knows]->*(b)

-- ✅ FIX 1: Use ANY SHORTEST
MATCH p = ANY SHORTEST (a)-[e:Knows]->*(b)

-- ✅ FIX 2: Use bounded quantifiers
MATCH (a)-[e:Knows]->{1,10}(b)
```

**Why blocked?** Prevents infinite results on cyclic graphs (system safety).

### Error: "syntax error at or near ':'"

**Cause:** Missing edge variable name

```sql
-- ❌ WRONG - Anonymous edges not supported yet
MATCH (a:Person)-[:Knows]->(b:Person)

-- ✅ FIX: Add edge variable
MATCH (a:Person)-[e:Knows]->(b:Person)
```

**Status:** Roadmap item (will be supported in future).

### Error: "All patterns must bind to a label"

**Cause:** Missing label on edge or node

```sql
-- ❌ WRONG - Label required
MATCH (a)-[e]->{2,3}(b)

-- ✅ FIX: Add labels
MATCH (a:Person)-[e:Knows]->{2,3}(b:Person)
```

**Status:** Label inference exists internally but not exposed yet.

### Error: "syntax error at or near '{'"

**Cause:** Quantifier in wrong position (Cypher syntax instead of SQL:2023)

```sql
-- ❌ WRONG - Cypher syntax (quantifier before arrow)
MATCH (a)-[e:Knows]{1,3}->(b)

-- ✅ FIX: SQL:2023 syntax (quantifier after arrow)
MATCH (a)-[e:Knows]->{1,3}(b)
```

**Migration tip:** Search-replace `{n,m}->` with `->{n,m}` and `*->` with `->*`

---

## 🛡️ Safety Features vs Roadmap Items

### Safety Features (Intentional Blocks)

**ALL unbounded paths** - Blocked by design
- **Affected**: Standalone `->*`, `->+` without ANY SHORTEST
- **Why**: Prevents infinite results on cyclic graphs
- **Solution**: Use ANY SHORTEST or bounded quantifiers

### Roadmap Items (Future Support)

**Anonymous edge syntax** - Temporary limitation
- **Current**: `-[e:Label]->` (variable required)
- **Future**: `-[:Label]->` will work
- **Why**: Internal query translation needs named references

**Label inference** - Implemented but disabled
- **Status**: Logic exists, not exposed in API
- **Future**: `(p:Person)-[]->(p2:Person)` will auto-infer edge type

**Path modes** - Not implemented
- **Planned**: TRAIL, ACYCLIC, SIMPLE
- **Current**: WALK (default, allows cycles)
- **Impact**: May enable ALL unbounded when implemented

---

## 📋 Syntax Comparison: SQL:2023 vs Cypher

| Feature | SQL:2023 (DuckPGQ) | Cypher/Neo4j |
|---------|-------------------|--------------|
| **Bounded quantifier** | `-[e:Label]->{2,5}` | `-[e:Label]{2,5}->` or `-[e:Label]*2..5` |
| **Kleene star** | `-[e:Label]->*` | `-[e:Label]*->` or `-[e:Label]*` |
| **Kleene plus** | `-[e:Label]->+` | `-[e:Label]+->` or `-[e:Label]+` |
| **Shortest path** | `ANY SHORTEST (a)-[e]->*(b)` | `shortestPath((a)-[e*]->(b))` |
| **Anonymous edges** | Not yet (`-[:Label]->`) | `(a)-[:Label]->(b)` |
| **Path variable** | `p = (a)-[e]->(b)` | `p = (a)-[e]->(b)` |

**Key Takeaway:** DuckPGQ strictly follows SQL:2023 (quantifiers AFTER arrow).

---

## 🧪 Testing & Validation

### Test Your Configuration

```bash
# Validate working features (13 tests)
npm run test:duckpgq:syntax

# Understand design decisions (18 tests)
npm run test:duckpgq:failures
```

### Quick Validation Query

```sql
-- Test 1: Basic connectivity
FROM GRAPH_TABLE (my_graph
  MATCH (a)-[e]->(b)
  COLUMNS (count(*) AS edge_count)
)

-- Test 2: ANY SHORTEST
FROM GRAPH_TABLE (my_graph
  MATCH p = ANY SHORTEST (a)-[e]->*(b)
  WHERE element_id(a) != element_id(b)
  COLUMNS (path_length(p) AS max_hops)
)

-- Test 3: Bounded quantifiers
FROM GRAPH_TABLE (my_graph
  MATCH (a)-[e]->{1,2}(b)
  COLUMNS (count(*) AS path_count)
)
```

---

## 📚 Further Reading

| Document | Purpose |
|----------|---------|
| [DUCKPGQ_FINDINGS.md](DUCKPGQ_FINDINGS.md) | What works - comprehensive test results |
| [DUCKPGQ_FAILURE_ANALYSIS.md](DUCKPGQ_FAILURE_ANALYSIS.md) | Why it works - 18 test cases + developer insights |
| [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) | How to migrate - detailed examples |
| [docs/DUCKPGQ_INTEGRATION.md](docs/DUCKPGQ_INTEGRATION.md) | Full integration guide |

---

## 💡 Pro Tips

1. **Always use edge variables**: `-[e:Label]->` not `-[:Label]->`
2. **Always specify labels**: Avoid binder errors
3. **Quantifiers go AFTER arrow**: `->{n,m}` not `{n,m}->`
4. **Use ANY SHORTEST for unbounded**: Not standalone `->*`
5. **Cypher migration**: Search-replace `*->` → `->*`, `{n,m}->` → `->{n,m}`

---

**Version**: DuckPGQ 7705c5c on DuckDB 1.4.1-r.4
**Last Updated**: 2025-10-20 with developer insights
**Test Status**: ✅ 13 syntax tests passing | 📘 18 design decisions documented
