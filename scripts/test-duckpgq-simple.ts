#!/usr/bin/env tsx
/**
 * Simple DuckPGQ test with proper FK constraints
 */

import { DuckDBService } from '../src/duckdb/service.js'
import * as dotenv from 'dotenv'

dotenv.config()

async function main() {
  console.log('🧪 Testing DuckPGQ with FK constraints\n')

  const duckdb = new DuckDBService({
    memory: '1GB',
    threads: 2,
    allowUnsignedExtensions: true,
  })

  try {
    await duckdb.initialize()

    // Create tables WITH foreign key constraints
    console.log('Creating tables with FK constraints...')
    await duckdb.executeQuery(`
      CREATE TABLE Person (
        id INTEGER PRIMARY KEY,
        name VARCHAR
      );
    `)

    await duckdb.executeQuery(`
      CREATE TABLE Knows (
        from_id INTEGER REFERENCES Person(id),
        to_id INTEGER REFERENCES Person(id)
      );
    `)

    await duckdb.executeQuery(`
      INSERT INTO Person VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Carol');
      INSERT INTO Knows VALUES (1, 2), (2, 3), (1, 3);
    `)
    console.log('✅ Tables created with data\n')

    // Try creating property graph
    console.log('Creating property graph...')
    await duckdb.executeQuery(`
      CREATE PROPERTY GRAPH social
        VERTEX TABLES (Person)
        EDGE TABLES (
          Knows
            SOURCE KEY (from_id) REFERENCES Person (id)
            DESTINATION KEY (to_id) REFERENCES Person (id)
        );
    `)
    console.log('✅ Property graph created!\n')

    // Try querying
    console.log('Executing graph query...')
    const result = await duckdb.executeQuery(`
      SELECT *
      FROM GRAPH_TABLE (social
        MATCH (a:Person)-[k:Knows]->(b:Person)
        COLUMNS (a.id AS from_id, a.name AS from_name, b.id AS to_id, b.name AS to_name)
      )
    `)

    console.log('Query results:')
    console.log(JSON.stringify(result, null, 2))
    console.log('\n✅ Graph query successful!')

    await duckdb.close()
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
