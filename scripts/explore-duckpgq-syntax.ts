#!/usr/bin/env tsx
/**
 * DuckPGQ Syntax Explorer
 * Try different CREATE PROPERTY GRAPH syntaxes to find what works
 */

import { DuckDBService } from '../src/duckdb/service.js'
import * as dotenv from 'dotenv'

dotenv.config()

async function main() {
  console.log('🔍 Exploring DuckPGQ Syntax\n')

  const duckdb = new DuckDBService({
    memory: '1GB',
    threads: 2,
    allowUnsignedExtensions: true,
  })

  try {
    await duckdb.initialize()
    console.log('✅ DuckDB initialized\n')

    // Check DuckPGQ version/info
    const extensions = await duckdb.executeQuery(
      "SELECT * FROM duckdb_extensions() WHERE extension_name = 'duckpgq'"
    )
    console.log('DuckPGQ Extension Info:', JSON.stringify(extensions, null, 2), '\n')

    // Create test tables
    console.log('Creating test tables...')
    await duckdb.executeQuery(`
      CREATE TABLE nodes (id INTEGER PRIMARY KEY, name VARCHAR);
      INSERT INTO nodes VALUES (1, 'A'), (2, 'B');

      CREATE TABLE edges (src INTEGER, dst INTEGER);
      INSERT INTO edges VALUES (1, 2);
    `)
    console.log('✅ Test tables created\n')

    // Try different syntaxes
    const syntaxVariations = [
      {
        name: 'Syntax 1: Minimal (no column specs)',
        sql: `CREATE PROPERTY GRAPH g1 VERTEX TABLES (nodes) EDGE TABLES (edges);`,
      },
      {
        name: 'Syntax 2: Simple SOURCE/DESTINATION',
        sql: `CREATE PROPERTY GRAPH g2 VERTEX TABLES (nodes) EDGE TABLES (edges SOURCE nodes DESTINATION nodes);`,
      },
      {
        name: 'Syntax 3: FROM/TO syntax',
        sql: `CREATE PROPERTY GRAPH g3 VERTEX TABLES (nodes) EDGE TABLES (edges FROM nodes TO nodes);`,
      },
      {
        name: 'Syntax 4: Explicit columns',
        sql: `CREATE PROPERTY GRAPH g4 VERTEX TABLES (nodes) EDGE TABLES (edges COLUMNS (src, dst));`,
      },
      {
        name: 'Syntax 5: CONNECT syntax',
        sql: `CREATE PROPERTY GRAPH g5 VERTEX TABLES (nodes) EDGE TABLES (edges CONNECT nodes TO nodes);`,
      },
    ]

    for (const variant of syntaxVariations) {
      console.log(`Testing: ${variant.name}`)
      console.log(`SQL: ${variant.sql}`)

      try {
        await duckdb.executeQuery(variant.sql)
        console.log('✅ SUCCESS! This syntax works\n')

        // Try to query it
        try {
          const result = await duckdb.executeQuery(`
            FROM GRAPH_TABLE (${variant.sql.match(/g\d+/)?.[0]}
              MATCH (a:nodes)-[:edges]->(b:nodes)
              COLUMNS (a.name AS from_node, b.name AS to_node)
            )
          `)
          console.log('Query result:', JSON.stringify(result, null, 2))
        } catch (queryError: any) {
          console.log(`Note: Graph created but query failed: ${queryError.message}`)
        }

        console.log()
        break // Found working syntax, stop trying
      } catch (error: any) {
        console.log(`❌ Failed: ${error.message}\n`)
      }
    }

    // Check if any graphs were created
    try {
      const graphs = await duckdb.executeQuery('SHOW PROPERTY GRAPHS')
      console.log('\n📊 Created Property Graphs:', JSON.stringify(graphs, null, 2))
    } catch (error: any) {
      console.log('\n⚠️  Could not list property graphs:', error.message)
    }

    await duckdb.close()
    console.log('\n✅ Exploration complete')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    await duckdb.close()
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
