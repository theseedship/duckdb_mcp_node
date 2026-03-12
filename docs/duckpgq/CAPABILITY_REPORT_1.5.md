# DuckPGQ Capability Report — DuckDB 1.5.0

**Date**: 2026-03-12
**DuckDB**: v1.5.0 "Variegata"
**DuckPGQ**: aec2e25 (community extension)
**Spatial**: loaded (for GEOMETRY/CRS tests)
**Test script**: `tests/duckpgq-1.5-capabilities.ts`

---

## Results Summary

```
T4.1   pagerank           ✅ (5 rows)
T4.2   WCC                ✅ (5 rows)
T4.3   clustering         ✅ (5 rows)
T4.4   shortest path      ✅ (5 rows) — via ANY SHORTEST ->*
T4.5   ALL SHORTEST       ❌ Not implemented yet
T4.6   path extract       ✅ vertices(p), edges(p), path_length(p) work
T4.7   summarize graph    ✅ summarize_property_graph() works
T5.1   GEOMETRY vertex    ✅ Property graph with GEOMETRY columns
T5.2   ST_Distance        ✅ ST_Distance in GRAPH_TABLE COLUMNS
T5.3   pagerank+GEO       ✅ PageRank on GEOMETRY vertex table
T6.1   CRS basique        ✅ GEOMETRY('OGC:CRS84') works (use ST_AsText)
T6.2   CRS vertex         ✅ CRS vertex table + GRAPH_TABLE
T7.1   ->* syntax         ✅ ANY SHORTEST with path variable
T7.2   bounded            ✅ {1,3} quantifiers
T7.3a  WHERE 1-hop        ✅ Edge filtering in 1-hop patterns
T7.3b  WHERE bounded      ❌ Edge variable not accessible in bounded patterns
T7.4   MATCH+CTE          ✅ CTE wrapping GRAPH_TABLE (no segfault)
T7.5   Onager             ❌ Extension not available for DuckDB 1.5.0 yet
T7.6   Kleene * alone     ❌ Still blocked (safety: infinite results on cyclic graphs)
T7.7   anon edge          ❌ Still requires edge variable binding
```

**Score: 15/20 ✅ (75%)**

---

## T4: CSR Functions — CRITIQUE

### ✅ T4.1: PageRank

```sql
SELECT * FROM pagerank(test_graph, nodes, edges);
-- Returns (id, pagerank_score) for all vertices
-- A=0.256, B=0.137, C=0.268, D=0.178, E=0.160
```

### ✅ T4.2: Weakly Connected Components

```sql
SELECT * FROM weakly_connected_component(test_graph, nodes, edges);
-- Returns (id, component_id) — all 5 nodes in component 4
```

Note: Returns BIGINT for component_id. Node-api serializes as BigInt.

### ✅ T4.3: Local Clustering Coefficient

```sql
SELECT * FROM local_clustering_coefficient(test_graph, nodes, edges);
-- Returns (id, coefficient) — B=1.0 (fully connected neighbors), A=0.33, C=0.33
```

### ✅ T4.4: Shortest Path (via ANY SHORTEST)

The `shortestpath()` function is a **CSR-internal scalar** — not meant for direct user access. The user-facing API is `ANY SHORTEST` in `MATCH` patterns:

```sql
SELECT * FROM GRAPH_TABLE(test_graph
  MATCH p = ANY SHORTEST (a:nodes WHERE a.name='A')-[e:edges]->*(b:nodes)
  COLUMNS(a.name AS src, b.name AS dst, path_length(p) AS hops)
);
-- A→B: 1 hop, A→C: 2 hops, A→D: 1 hop, A→E: 2 hops, A→A: 0 hops
```

### ❌ T4.5: ALL SHORTEST

```
Not implemented Error: ALL SHORTEST has not been implemented yet.
```

Only `ANY SHORTEST` works. `ALL SHORTEST` and `CHEAPEST` are not available.

### ✅ T4.6: Path Extraction Functions

```sql
SELECT * FROM GRAPH_TABLE(test_graph
  MATCH p = ANY SHORTEST (a:nodes WHERE a.name='A')-[e:edges]->*(b:nodes WHERE b.name='E')
  COLUMNS(a.name, b.name, path_length(p) AS hops, vertices(p) AS vtx, edges(p) AS edg)
);
-- A→E: 2 hops, vertices=[0,3,4], edges=[3,4]
```

Available path functions: `path_length(p)`, `vertices(p)`, `edges(p)`.
Not available: `is_trail(p)`, `is_acyclic(p)`.

### ✅ T4.7: summarize_property_graph

```sql
SELECT * FROM summarize_property_graph('test_graph');
-- Returns vertex/edge table stats: node count, edge count, degree distribution
```

Also works: `DESCRIBE PROPERTY GRAPH test_graph`.

### DuckPGQ Function Catalog

| Function                                         | Type   | Available       | Notes                               |
| ------------------------------------------------ | ------ | --------------- | ----------------------------------- |
| `pagerank(graph, vtx, edge)`                     | table  | ✅              | Returns (id, score)                 |
| `weakly_connected_component(graph, vtx, edge)`   | table  | ✅              | Returns (id, component)             |
| `local_clustering_coefficient(graph, vtx, edge)` | table  | ✅              | Returns (id, coefficient)           |
| `shortestpath(...)`                              | scalar | ⚠️ CSR-internal | Use `ANY SHORTEST` in MATCH instead |
| `cheapest_path_length(...)`                      | scalar | ⚠️ CSR-internal | Not user-facing                     |
| `iterativelength(...)`                           | scalar | ⚠️ CSR-internal | Not user-facing                     |
| `summarize_property_graph(name)`                 | table  | ✅              | Graph statistics                    |
| `DESCRIBE PROPERTY GRAPH name`                   | DDL    | ✅              | Schema description                  |

---

## T5: GEOMETRY Integration — HAUTE

### ✅ T5.1: GEOMETRY in Vertex Tables

Property graphs with `GEOMETRY` vertex columns work out of the box. No special configuration needed.

### ✅ T5.2: Spatial Functions in GRAPH_TABLE

`ST_Distance()`, `ST_AsText()`, and other spatial functions work inside `GRAPH_TABLE ... COLUMNS(...)`:

```sql
SELECT * FROM GRAPH_TABLE(geo_graph
  MATCH (a:geo_nodes)-[e:geo_edges]->(b:geo_nodes)
  COLUMNS(a.name, b.name, ST_Distance(a.geom, b.geom) AS dist)
);
-- Montpellier→Marseille: 1.53°, Montpellier→Nairobi: 55.69°
```

### ✅ T5.3: PageRank on GEOMETRY Vertex Tables

CSR table functions (pagerank, WCC, clustering) work on vertex tables that contain GEOMETRY columns. The GEOMETRY column is ignored by the algorithm — only the id/edge structure matters.

---

## T6: CRS Integration — MOYENNE

### ✅ T6.1: CRS Casting

`GEOMETRY('OGC:CRS84')` works in DuckDB 1.5.0:

```sql
SELECT ST_AsText(ST_Point(3.87, 43.61)::GEOMETRY('OGC:CRS84')) AS pt;
-- POINT (3.87 43.61)
```

**Node-api caveat**: Direct GEOMETRY retrieval fails with "Unexpected type id: 0". Always wrap with `ST_AsText()` or `ST_AsWKB()` when fetching GEOMETRY values through the Node.js API.

### ✅ T6.2: CRS Vertex Tables in GRAPH_TABLE

Property graphs with `GEOMETRY('OGC:CRS84')` vertex columns work. Use `ST_AsText(a.geom)` in COLUMNS to retrieve the geometry.

---

## T7: Syntax Evolution — BASSE

### ✅ T7.1: ANY SHORTEST `->*` Syntax

Works with path variable binding. Returns BigInt for `path_length(p)`.

### ✅ T7.2: Bounded Quantifiers `{1,3}`

Works for vertex-only COLUMNS. Edge properties not accessible in bounded patterns (see T7.3b).

### ✅/❌ T7.3: WHERE on Edges

| Context                       | Status | Notes                                        |
| ----------------------------- | ------ | -------------------------------------------- |
| 1-hop pattern                 | ✅     | `[e:edges WHERE e.weight > 0.5]` works       |
| WHERE clause                  | ✅     | `WHERE e.weight > 0.5` after MATCH works     |
| Bounded `{n,m}`               | ❌     | Edge variable `e` not bound in bounded scope |
| e.weight in COLUMNS (bounded) | ❌     | Same — `e` not accessible                    |

**Workaround for bounded**: Filter post-hoc after GRAPH_TABLE for edge weight access in bounded patterns is not possible. Use 1-hop patterns with explicit hops or `ANY SHORTEST` instead.

### ✅ T7.4: MATCH + CTE Interaction

CTE wrapping a GRAPH_TABLE query works without segfault. This was a known issue in earlier versions (#276, #294).

### ❌ T7.5: Onager Extension

Not available for DuckDB 1.5.0 (HTTP 404). Community extension not yet built for this version.

### ❌ T7.6: Standalone Kleene `->*` / `->+`

Still blocked by design: "ALL unbounded with path mode WALK is not possible as this could lead to infinite results."

Workaround: Use `ANY SHORTEST ... ->*` or bounded quantifiers `{1,N}`.

### ❌ T7.7: Anonymous Edges

Still requires edge variable binding: `[e:Label]` not `[:Label]`.

---

## Impact on Project Roadmap

### What This Enables (New vs v1.0.x)

1. **Native CSR algorithms** — `pagerank()`, `weakly_connected_component()`, `local_clustering_coefficient()` are now available as DuckPGQ table functions. Our iterative SQL implementations in `graph-*.ts` could optionally delegate to these when DuckPGQ is loaded.

2. **Geospatial graph analysis** — GEOMETRY + DuckPGQ coexistence means we can build spatial graph tools (e.g., "find communities by geographic proximity").

3. **CRS-aware graphs** — Vertex tables with coordinate reference systems work through GRAPH_TABLE.

4. **Path extraction** — `vertices(p)` and `edges(p)` provide structured path data for visualization.

5. **Graph summarization** — `summarize_property_graph()` gives graph statistics without manual queries.

### What's Still Missing

1. **ALL SHORTEST** — only ANY SHORTEST available
2. **CHEAPEST path** — not in parser, `cheapest_path_length()` is CSR-internal only
3. **Edge properties in bounded quantifiers** — can't filter/access edge weight in `{n,m}` patterns
4. **Standalone Kleene** — still blocked, use ANY SHORTEST or bounds
5. **Anonymous edges** — still need explicit variable binding
6. **Onager** — not available for DuckDB 1.5.0

### Recommended Next Steps

1. **Optional DuckPGQ delegation**: When DuckPGQ is loaded, `graph.pagerank` could use `pagerank(graph, vtx, edge)` instead of iterative SQL — simpler and likely faster.

2. **New tool: `graph.shortest_path`**: Wrap `ANY SHORTEST` pattern matching with `vertices(p)` / `edges(p)` extraction.

3. **Geospatial graph tools**: Combine GEOMETRY vertex tables with graph algorithms for location-aware analysis.

4. **Keep iterative SQL fallback**: Graph tools should still work without DuckPGQ (graceful degradation).
