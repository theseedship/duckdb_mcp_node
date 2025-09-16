#!/usr/bin/env tsx

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { spawn } from 'child_process'

/**
 * Example script to test the DuckDB MCP Server
 */
async function testDuckDBServer() {
  console.log('🚀 Testing DuckDB MCP Server...\n')

  // Start the server process
  const serverProcess = spawn('tsx', ['src/server/mcp-server.ts'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      MCP_MODE: 'stdio',
      MCP_SECURITY_MODE: 'development',
    },
  })

  // Create MCP client
  const client = new Client(
    {
      name: 'duckdb-test-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  )

  // Connect to server via stdio
  const transport = new StdioClientTransport({
    command: 'tsx',
    args: ['src/server/mcp-server.ts'],
    env: {
      ...process.env,
      MCP_MODE: 'stdio',
      MCP_SECURITY_MODE: 'development',
    },
  })

  try {
    await client.connect(transport)
    console.log('✅ Connected to DuckDB MCP Server\n')

    // Test 1: List available tools
    console.log('📋 Test 1: Listing available tools')
    const tools = await client.listTools()
    console.log(`Found ${tools.tools.length} tools:`)
    tools.tools.forEach(tool => {
      console.log(`  - ${tool.name}: ${tool.description}`)
    })
    console.log()

    // Test 2: Create a test table
    console.log('📊 Test 2: Creating test table')
    const createTableResult = await client.callTool('query_duckdb', {
      sql: `
        CREATE TABLE test_data (
          id INTEGER,
          name VARCHAR,
          value DOUBLE,
          created_date DATE
        )
      `,
    })
    console.log('Table created:', JSON.parse(createTableResult.content[0].text).success)
    console.log()

    // Test 3: Insert test data
    console.log('📝 Test 3: Inserting test data')
    const insertResult = await client.callTool('query_duckdb', {
      sql: `
        INSERT INTO test_data VALUES 
          (1, 'Alice', 100.5, '2024-01-01'),
          (2, 'Bob', 200.75, '2024-01-02'),
          (3, 'Charlie', 150.25, '2024-01-03'),
          (4, 'Diana', 300.0, '2024-01-04'),
          (5, 'Eve', 250.5, '2024-01-05')
      `,
    })
    console.log('Data inserted:', JSON.parse(insertResult.content[0].text).success)
    console.log()

    // Test 4: Query the data
    console.log('🔍 Test 4: Querying data')
    const queryResult = await client.callTool('query_duckdb', {
      sql: 'SELECT * FROM test_data WHERE value > 150 ORDER BY value DESC',
    })
    const queryData = JSON.parse(queryResult.content[0].text)
    console.log(`Query returned ${queryData.rowCount} rows:`)
    console.table(queryData.data)
    console.log()

    // Test 5: Aggregate query
    console.log('📈 Test 5: Aggregate query')
    const aggregateResult = await client.callTool('query_duckdb', {
      sql: `
        SELECT 
          COUNT(*) as total_records,
          AVG(value) as avg_value,
          MIN(value) as min_value,
          MAX(value) as max_value,
          SUM(value) as total_value
        FROM test_data
      `,
    })
    const aggregateData = JSON.parse(aggregateResult.content[0].text)
    console.log('Aggregate results:')
    console.table(aggregateData.data[0])
    console.log()

    // Test 6: List tables
    console.log('📋 Test 6: Listing tables')
    const listTablesResult = await client.callTool('list_tables', {
      schema: 'main',
    })
    const tablesData = JSON.parse(listTablesResult.content[0].text)
    console.log(`Found ${tablesData.tables.length} table(s):`)
    tablesData.tables.forEach((table: any) => {
      console.log(`  - ${table.table_name} (${table.table_type})`)
    })
    console.log()

    // Test 7: Describe table
    console.log('📄 Test 7: Describing table')
    const describeResult = await client.callTool('describe_table', {
      table_name: 'test_data',
    })
    const describeData = JSON.parse(describeResult.content[0].text)
    console.log(`Table: ${describeData.table}`)
    console.log(`Row count: ${describeData.rowCount}`)
    console.log('Columns:')
    console.table(describeData.columns)
    console.log()

    // Test 8: List resources
    console.log('📚 Test 8: Listing resources')
    const resources = await client.listResources()
    console.log(`Found ${resources.resources.length} resource(s):`)
    resources.resources.forEach(resource => {
      console.log(`  - ${resource.name}: ${resource.uri}`)
    })
    console.log()

    // Test 9: Read resource
    if (resources.resources.length > 0) {
      console.log('📖 Test 9: Reading resource')
      const resourceData = await client.readResource(resources.resources[0].uri)
      const data = JSON.parse(resourceData.contents[0].text)
      console.log(`Resource data (${data.length} rows):`)
      console.table(data.slice(0, 3))
      console.log()
    }

    console.log('✅ All tests completed successfully!')

  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  } finally {
    // Clean up
    await client.close()
    serverProcess.kill()
  }
}

// Run tests
testDuckDBServer().catch(console.error)