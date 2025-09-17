#!/usr/bin/env tsx

/**
 * Simple test for DuckDB MCP server
 *
 * Run the server first:
 *   npm run server
 *
 * Then run this test:
 *   tsx examples/test-simple.ts
 */

import { DuckDBService } from '../src/duckdb/service.js'

async function testDuckDB() {
  console.log('🧪 Simple DuckDB Test\n')

  // Initialize DuckDB directly
  const duckdb = new DuckDBService({
    memory: '2GB',
    threads: 4,
  })

  try {
    await duckdb.initialize()
    console.log('✅ DuckDB initialized\n')

    // Test 1: Create a table
    console.log('📊 Test 1: Creating table')
    await duckdb.executeQuery(`
      CREATE TABLE test_table (
        id INTEGER,
        name VARCHAR,
        value DOUBLE
      )
    `)
    console.log('✅ Table created\n')

    // Test 2: Insert data
    console.log('📝 Test 2: Inserting data')
    await duckdb.executeQuery(`
      INSERT INTO test_table VALUES 
        (1, 'Alice', 100.5),
        (2, 'Bob', 200.75),
        (3, 'Charlie', 150.25)
    `)
    console.log('✅ Data inserted\n')

    // Test 3: Query data
    console.log('🔍 Test 3: Querying data')
    const results = await duckdb.executeQuery('SELECT * FROM test_table ORDER BY value DESC')
    console.table(results)
    console.log()

    // Test 4: Get row count
    console.log('📈 Test 4: Getting row count')
    const rowCount = await duckdb.getRowCount('test_table')
    console.log(`Row count: ${rowCount}`)
    console.log()

    // Test 5: Get schema
    console.log('📋 Test 5: Getting schema')
    const schema = await duckdb.getSchema()
    console.log('Tables:', schema.map((t) => t.table_name).join(', '))
    console.log()

    console.log('✅ All tests passed!')

    await duckdb.close()
    console.log('✅ DuckDB closed')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

testDuckDB().catch(console.error)
