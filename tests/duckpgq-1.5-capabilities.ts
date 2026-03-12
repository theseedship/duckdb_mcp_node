/**
 * DuckPGQ 1.5.0 Capability Tests (aec2e25)
 * Tests CSR functions, GEOMETRY integration, CRS, path functions, and syntax evolution
 * Run: npx tsx tests/duckpgq-1.5-capabilities.ts
 *
 * Results documented in docs/duckpgq/CAPABILITY_REPORT_1.5.md
 */
import { DuckDBInstance } from '@duckdb/node-api';

interface TestResult {
  id: string;
  name: string;
  status: '✅' | '❌' | '⚠️';
  detail?: string;
}

const results: TestResult[] = [];

async function run() {
  const instance = await DuckDBInstance.create(':memory:', {
    allow_unsigned_extensions: 'true',
  });
  const conn = await instance.connect();

  const vr = await conn.run('SELECT version() as v');
  const vrows = await vr.getRows();
  console.log(`DuckDB version: ${vrows[0][0]}`);

  // Load extensions
  await conn.run('INSTALL duckpgq FROM community');
  await conn.run('LOAD duckpgq');

  const extR = await conn.run(
    "SELECT extension_version FROM duckdb_extensions() WHERE extension_name = 'duckpgq'"
  );
  const extRows = await extR.getRows();
  console.log(`DuckPGQ version: ${extRows[0][0]}`);

  await conn.run('INSTALL spatial');
  await conn.run('LOAD spatial');
  console.log('Extensions loaded\n');

  // === Setup base graph for T4 + T7 ===
  await conn.run('CREATE TABLE nodes(id INTEGER, name VARCHAR)');
  await conn.run("INSERT INTO nodes VALUES (1,'A'),(2,'B'),(3,'C'),(4,'D'),(5,'E')");
  await conn.run('CREATE TABLE edges(src INTEGER, dst INTEGER, weight DOUBLE)');
  await conn.run(
    'INSERT INTO edges VALUES (1,2,0.8),(2,3,0.7),(3,1,0.9),(1,4,0.6),(4,5,0.5),(5,3,0.4)'
  );
  await conn.run(`
    CREATE PROPERTY GRAPH test_graph
    VERTEX TABLES (nodes)
    EDGE TABLES (edges SOURCE KEY (src) REFERENCES nodes(id)
                      DESTINATION KEY (dst) REFERENCES nodes(id))
  `);

  // =============================================
  // T4 — CSR Table Functions (CRITIQUE)
  // =============================================
  console.log('=== T4: CSR Functions (CRITIQUE) ===\n');

  // T4.1: PageRank (table function)
  await test(conn, 'T4.1', 'pagerank', async () => {
    const r = await conn.run('SELECT * FROM pagerank(test_graph, nodes, edges)');
    return await r.getRows();
  });

  // T4.2: Weakly Connected Components (table function)
  await test(conn, 'T4.2', 'WCC', async () => {
    const r = await conn.run(
      'SELECT * FROM weakly_connected_component(test_graph, nodes, edges)'
    );
    return await r.getRows();
  });

  // T4.3: Local Clustering Coefficient (table function)
  await test(conn, 'T4.3', 'clustering', async () => {
    const r = await conn.run(
      'SELECT * FROM local_clustering_coefficient(test_graph, nodes, edges)'
    );
    return await r.getRows();
  });

  // T4.4: Shortest path — via ANY SHORTEST MATCH (user-facing API)
  // Note: shortestpath() is a CSR-internal scalar, not meant for direct use
  await test(conn, 'T4.4', 'shortest path', async () => {
    const r = await conn.run(`SELECT * FROM GRAPH_TABLE(test_graph
      MATCH p = ANY SHORTEST (a:nodes WHERE a.name='A')-[e:edges]->*(b:nodes)
      COLUMNS(a.name AS src, b.name AS dst, path_length(p) AS hops)
    )`);
    return await r.getRows();
  });

  // T4.5: ALL SHORTEST (not yet implemented)
  await test(conn, 'T4.5', 'ALL SHORTEST', async () => {
    const r = await conn.run(`SELECT * FROM GRAPH_TABLE(test_graph
      MATCH p = ALL SHORTEST (a:nodes WHERE a.name='A')-[e:edges]->*(b:nodes WHERE b.name='E')
      COLUMNS(a.name AS src, b.name AS dst, path_length(p) AS hops)
    )`);
    return await r.getRows();
  });

  // T4.6: Path extraction — vertices() and edges()
  await test(conn, 'T4.6', 'path extract', async () => {
    const r = await conn.run(`SELECT * FROM GRAPH_TABLE(test_graph
      MATCH p = ANY SHORTEST (a:nodes WHERE a.name='A')-[e:edges]->*(b:nodes WHERE b.name='E')
      COLUMNS(a.name AS src, b.name AS dst,
              path_length(p) AS hops, vertices(p) AS vtx, edges(p) AS edg)
    )`);
    return await r.getRows();
  });

  // T4.7: summarize_property_graph
  await test(conn, 'T4.7', 'summarize graph', async () => {
    const r = await conn.run("SELECT * FROM summarize_property_graph('test_graph')");
    return await r.getRows();
  });

  // =============================================
  // T5 — GEOMETRY Integration (HAUTE)
  // =============================================
  console.log('\n=== T5: GEOMETRY Integration (HAUTE) ===\n');

  // T5.1: Property graph with GEOMETRY vertex table
  await test(conn, 'T5.1', 'GEOMETRY vertex', async () => {
    await conn.run('CREATE TABLE geo_nodes(id INTEGER, name VARCHAR, geom GEOMETRY)');
    await conn.run(`INSERT INTO geo_nodes VALUES
      (1, 'Montpellier', ST_Point(3.87, 43.61)),
      (2, 'Marseille', ST_Point(5.37, 43.30)),
      (3, 'Nairobi', ST_Point(36.82, -1.29))`);
    await conn.run(
      'CREATE TABLE geo_edges(src INTEGER, dst INTEGER, support DOUBLE)'
    );
    await conn.run(
      'INSERT INTO geo_edges VALUES (1,2,0.72),(1,3,0.45),(2,3,0.38)'
    );
    await conn.run(`CREATE PROPERTY GRAPH geo_graph
      VERTEX TABLES (geo_nodes)
      EDGE TABLES (geo_edges SOURCE KEY (src) REFERENCES geo_nodes(id)
                            DESTINATION KEY (dst) REFERENCES geo_nodes(id))`);
    return ['property graph with GEOMETRY created'];
  });

  // T5.2: GRAPH_TABLE with ST_Distance on GEOMETRY columns
  await test(conn, 'T5.2', 'ST_Distance', async () => {
    const r = await conn.run(`SELECT * FROM GRAPH_TABLE(geo_graph
      MATCH (a:geo_nodes)-[e:geo_edges]->(b:geo_nodes)
      COLUMNS(a.name, b.name, e.support,
              ST_Distance(a.geom, b.geom) AS dist_degrees)
    )`);
    return await r.getRows();
  });

  // T5.3: PageRank on GEOMETRY vertex table
  await test(conn, 'T5.3', 'pagerank+GEO', async () => {
    const r = await conn.run(
      'SELECT * FROM pagerank(geo_graph, geo_nodes, geo_edges)'
    );
    return await r.getRows();
  });

  // =============================================
  // T6 — CRS Integration (MOYENNE)
  // =============================================
  console.log('\n=== T6: CRS Integration (MOYENNE) ===\n');

  // T6.1: CRS cast — use ST_AsText to avoid node-api GEOMETRY serialization issue
  await test(conn, 'T6.1', 'CRS basique', async () => {
    const r = await conn.run(
      "SELECT ST_AsText(ST_Point(3.87, 43.61)::GEOMETRY('OGC:CRS84')) AS pt"
    );
    return await r.getRows();
  });

  // T6.2: CRS vertex table + GRAPH_TABLE
  await test(conn, 'T6.2', 'CRS vertex', async () => {
    await conn.run(`CREATE TABLE crs_nodes(id INTEGER, name VARCHAR,
                     geom GEOMETRY('OGC:CRS84'))`);
    await conn.run(`INSERT INTO crs_nodes VALUES
      (1, 'Montpellier', ST_Point(3.87, 43.61)::GEOMETRY('OGC:CRS84')),
      (2, 'Marseille', ST_Point(5.37, 43.30)::GEOMETRY('OGC:CRS84'))`);
    await conn.run('CREATE TABLE crs_edges(src INTEGER, dst INTEGER)');
    await conn.run('INSERT INTO crs_edges VALUES (1,2)');
    await conn.run(`CREATE PROPERTY GRAPH crs_graph
      VERTEX TABLES (crs_nodes)
      EDGE TABLES (crs_edges SOURCE KEY (src) REFERENCES crs_nodes(id)
                            DESTINATION KEY (dst) REFERENCES crs_nodes(id))`);
    const r = await conn.run(`SELECT * FROM GRAPH_TABLE(crs_graph
      MATCH (a:crs_nodes)-[e:crs_edges]->(b:crs_nodes)
      COLUMNS(a.name, b.name, ST_AsText(a.geom) AS geom_wkt)
    )`);
    return await r.getRows();
  });

  // =============================================
  // T7 — Syntax Evolution (BASSE)
  // =============================================
  console.log('\n=== T7: Syntax Evolution (BASSE) ===\n');

  // T7.1: ANY SHORTEST ->*
  await test(conn, 'T7.1', '->* syntax', async () => {
    const r = await conn.run(`SELECT * FROM GRAPH_TABLE(test_graph
      MATCH p = ANY SHORTEST (a:nodes WHERE a.name='A')-[e:edges]->*(b:nodes WHERE b.name='E')
      COLUMNS(a.name AS start_node, b.name AS end_node, path_length(p) AS hops)
    )`);
    return await r.getRows();
  });

  // T7.2: Bounded quantifiers {1,3}
  await test(conn, 'T7.2', 'bounded', async () => {
    const r = await conn.run(`SELECT * FROM GRAPH_TABLE(test_graph
      MATCH (a:nodes)-[e:edges]->{1,3}(b:nodes)
      COLUMNS(a.name, b.name)
    )`);
    return await r.getRows();
  });

  // T7.3: WHERE on edges in 1-hop (works) vs bounded (fails)
  await test(conn, 'T7.3a', 'WHERE 1-hop', async () => {
    const r = await conn.run(`SELECT * FROM GRAPH_TABLE(test_graph
      MATCH (a:nodes)-[e:edges WHERE e.weight > 0.5]->(b:nodes)
      COLUMNS(a.name, b.name, e.weight)
    )`);
    return await r.getRows();
  });

  await test(conn, 'T7.3b', 'WHERE bounded', async () => {
    const r = await conn.run(`SELECT * FROM GRAPH_TABLE(test_graph
      MATCH (a:nodes)-[e:edges WHERE e.weight > 0.5]->{1,3}(b:nodes)
      COLUMNS(a.name, b.name, e.weight)
    )`);
    return await r.getRows();
  });

  // T7.4: MATCH+CTE interaction (was segfault #276/#294)
  await test(conn, 'T7.4', 'MATCH+CTE', async () => {
    const r = await conn.run(`WITH graph_results AS (
      SELECT * FROM GRAPH_TABLE(test_graph
        MATCH (a:nodes)-[e:edges]->(b:nodes)
        COLUMNS(a.name AS src, b.name AS dst, e.weight)
      )
    )
    SELECT src, dst, weight FROM graph_results WHERE weight > 0.6`);
    return await r.getRows();
  });

  // T7.5: Onager coexistence
  await test(conn, 'T7.5', 'Onager', async () => {
    await conn.run('INSTALL onager FROM community');
    await conn.run('LOAD onager');
    const r = await conn.run(
      'SELECT * FROM onager_ctr_pagerank((SELECT src, dst FROM edges))'
    );
    return await r.getRows();
  });

  // T7.6: Standalone Kleene * (expected: still blocked)
  await test(conn, 'T7.6', 'Kleene * alone', async () => {
    const r = await conn.run(`SELECT * FROM GRAPH_TABLE(test_graph
      MATCH (a:nodes WHERE a.name = 'A')-[e:edges]->*(b:nodes)
      COLUMNS(a.name, b.name)
    )`);
    return await r.getRows();
  });

  // T7.7: Anonymous edge (expected: still fails)
  await test(conn, 'T7.7', 'anon edge', async () => {
    const r = await conn.run(`SELECT * FROM GRAPH_TABLE(test_graph
      MATCH (a:nodes)-[:edges]->(b:nodes)
      COLUMNS(a.name, b.name)
    )`);
    return await r.getRows();
  });

  // =============================================
  // Summary
  // =============================================
  console.log('\n========================================');
  console.log('            RESULTS SUMMARY');
  console.log('========================================\n');

  for (const r of results) {
    const detail = r.detail ? ` ${r.detail}` : '';
    console.log(`${r.id.padEnd(6)} ${r.name.padEnd(18)} ${r.status}${detail}`);
  }

  const passed = results.filter((r) => r.status === '✅').length;
  const failed = results.filter((r) => r.status === '❌').length;
  const warn = results.filter((r) => r.status === '⚠️').length;
  console.log(
    `\nTotal: ${passed} ✅  ${failed} ❌  ${warn} ⚠️  (${results.length} tests)`
  );
}

// BigInt-safe row stringifier
function safeStringify(row: any[]): string {
  return row
    .map((v) => {
      if (typeof v === 'bigint') return `${v}n`;
      if (v === null || v === undefined) return 'null';
      if (Array.isArray(v)) return `[${v.map((x) => String(x)).join(',')}]`;
      return String(v);
    })
    .join(', ');
}

async function test(
  conn: any,
  id: string,
  name: string,
  fn: () => Promise<any[]>
): Promise<void> {
  try {
    const rows = await fn();
    results.push({
      id,
      name,
      status: '✅',
      detail: `(${(rows as any[]).length} rows)`,
    });
    console.log(`${id} ${name}: ✅ (${(rows as any[]).length} rows)`);
    if (Array.isArray(rows)) {
      for (const row of rows.slice(0, 3)) {
        if (Array.isArray(row)) {
          console.log(`    ${safeStringify(row)}`);
        } else {
          console.log(`    ${String(row)}`);
        }
      }
      if (rows.length > 3)
        console.log(`    ... and ${rows.length - 3} more`);
    }
  } catch (e: any) {
    const msg = e.message?.substring(0, 150) || 'Unknown error';
    results.push({ id, name, status: '❌', detail: msg });
    console.log(`${id} ${name}: ❌ ${msg}`);
  }
}

run().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
