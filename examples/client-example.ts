#!/usr/bin/env tsx

import { DuckDBService } from '../src/duckdb/service.js'
import { MCPClient } from '../src/client/MCPClient.js'
import { VirtualTableManager } from '../src/client/VirtualTable.js'
import { ResourceMapper } from '../src/client/ResourceMapper.js'

/**
 * MCP Client Example
 *
 * This example demonstrates how to use the MCP client library directly
 * to connect to external MCP servers and create virtual tables in DuckDB.
 *
 * To run this example:
 * 1. Make sure you have an MCP server to connect to
 * 2. Run: `tsx examples/client-example.ts`
 */

async function runClientExample() {
  console.log('🚀 DuckDB MCP Client Example\n')
  console.log('This example shows how to use the MCP client library directly.\n')

  // Initialize DuckDB service
  const duckdb = new DuckDBService({
    memory: '2GB',
    threads: 4,
  })

  await duckdb.initialize()
  console.log('✅ DuckDB initialized\n')

  // Initialize MCP Client
  const mcpClient = new MCPClient({
    name: 'duckdb-client-example',
    version: '1.0.0',
    cacheEnabled: true,
    cacheTTL: 300, // 5 minutes
  })

  mcpClient.setDuckDBService(duckdb)
  console.log('✅ MCP Client initialized\n')

  // Initialize Virtual Table Manager
  const virtualTables = new VirtualTableManager(duckdb, mcpClient)
  console.log('✅ Virtual Table Manager initialized\n')

  // Initialize Resource Mapper
  const resourceMapper = new ResourceMapper(duckdb)
  console.log('✅ Resource Mapper initialized\n')

  try {
    // Step 1: Create some local tables for testing
    console.log('═══════════════════════════════════════════')
    console.log('📊 Step 1: Creating Local Tables')
    console.log('═══════════════════════════════════════════')

    // Create products table
    await duckdb.executeQuery(`
      CREATE TABLE products (
        id INTEGER,
        name VARCHAR,
        category VARCHAR,
        price DOUBLE,
        stock INTEGER
      )
    `)

    await duckdb.executeQuery(`
      INSERT INTO products VALUES 
        (1, 'Laptop', 'Electronics', 999.99, 15),
        (2, 'Mouse', 'Accessories', 29.99, 100),
        (3, 'Keyboard', 'Accessories', 79.99, 50),
        (4, 'Monitor', 'Electronics', 299.99, 25),
        (5, 'Desk Chair', 'Furniture', 449.99, 10)
    `)

    console.log('✅ Created products table with 5 records')

    // Create orders table
    await duckdb.executeQuery(`
      CREATE TABLE orders (
        id INTEGER,
        product_id INTEGER,
        quantity INTEGER,
        order_date DATE,
        customer VARCHAR
      )
    `)

    await duckdb.executeQuery(`
      INSERT INTO orders VALUES 
        (1, 1, 2, '2024-01-15', 'Alice'),
        (2, 2, 5, '2024-01-16', 'Bob'),
        (3, 3, 3, '2024-01-16', 'Charlie'),
        (4, 4, 1, '2024-01-17', 'Diana'),
        (5, 1, 1, '2024-01-17', 'Eve')
    `)

    console.log('✅ Created orders table with 5 records')
    console.log()

    // Step 2: Demonstrate resource mapping
    console.log('═══════════════════════════════════════════')
    console.log('🗺️ Step 2: Resource Mapping Example')
    console.log('═══════════════════════════════════════════')

    // Example JSON data to map
    const jsonData = [
      { id: 1, region: 'North', sales: 50000, year: 2024 },
      { id: 2, region: 'South', sales: 45000, year: 2024 },
      { id: 3, region: 'East', sales: 60000, year: 2024 },
      { id: 4, region: 'West', sales: 55000, year: 2024 },
    ]

    console.log('Mapping JSON data to table "regional_sales"...')
    const mapped = await resourceMapper.mapResource(
      'example://regional-sales',
      'regional_sales',
      jsonData,
      'application/json'
    )

    console.log(`✅ Mapped resource to table: ${mapped.tableName}`)
    console.log(`   Type: ${mapped.resourceType}`)
    console.log(`   Rows: ${mapped.rowCount}`)
    console.log(`   Columns: ${mapped.columns?.map((c) => c.name).join(', ')}`)
    console.log()

    // Query the mapped table
    const salesData = await duckdb.executeQuery('SELECT * FROM regional_sales ORDER BY sales DESC')
    console.log('Regional sales data:')
    console.table(salesData)
    console.log()

    // Step 3: Virtual Tables (simulated)
    console.log('═══════════════════════════════════════════')
    console.log('🌐 Step 3: Virtual Tables (Simulated)')
    console.log('═══════════════════════════════════════════')

    // Create a simulated virtual table from JSON data
    const virtualData = [
      { supplier_id: 101, name: 'TechSupply Co', country: 'USA', rating: 4.5 },
      { supplier_id: 102, name: 'Global Parts Ltd', country: 'UK', rating: 4.2 },
      { supplier_id: 103, name: 'Asian Electronics', country: 'Japan', rating: 4.8 },
    ]

    // Map this as if it were from an external MCP resource
    console.log('Creating virtual table "suppliers" from simulated MCP resource...')
    await resourceMapper.mapResource(
      'mcp://example/suppliers',
      'suppliers',
      virtualData,
      'application/json'
    )

    const supplierCount = await duckdb.getRowCount('suppliers')
    console.log(`✅ Created virtual table "suppliers" with ${supplierCount} rows`)
    console.log()

    // Step 4: Hybrid Queries
    console.log('═══════════════════════════════════════════')
    console.log('🔄 Step 4: Hybrid Query Example')
    console.log('═══════════════════════════════════════════')
    console.log('Executing query across local and virtual tables...')

    // Join local products with virtual suppliers and regional sales
    const hybridQuery = `
      SELECT 
        p.name as product,
        p.category,
        p.price,
        p.stock,
        r.region,
        r.sales as regional_sales
      FROM products p
      CROSS JOIN regional_sales r
      WHERE p.category = 'Electronics'
      ORDER BY r.sales DESC, p.price DESC
    `

    const hybridResults = await duckdb.executeQuery(hybridQuery)
    console.log('\nHybrid query results (Electronics by region):')
    console.table(hybridResults)
    console.log()

    // Step 5: Advanced Analytics
    console.log('═══════════════════════════════════════════')
    console.log('📈 Step 5: Advanced Analytics')
    console.log('═══════════════════════════════════════════')

    // Aggregation across tables
    const analyticsQuery = `
      WITH order_summary AS (
        SELECT 
          p.category,
          SUM(o.quantity * p.price) as total_revenue,
          COUNT(DISTINCT o.id) as order_count,
          AVG(o.quantity) as avg_quantity
        FROM orders o
        JOIN products p ON o.product_id = p.id
        GROUP BY p.category
      )
      SELECT 
        category,
        ROUND(total_revenue, 2) as revenue,
        order_count,
        ROUND(avg_quantity, 1) as avg_qty
      FROM order_summary
      ORDER BY revenue DESC
    `

    const analyticsResults = await duckdb.executeQuery(analyticsQuery)
    console.log('Revenue by category:')
    console.table(analyticsResults)
    console.log()

    // Step 6: MCP Server Connection (if available)
    console.log('═══════════════════════════════════════════')
    console.log('🔗 Step 6: MCP Server Connection')
    console.log('═══════════════════════════════════════════')

    const serverUrl = process.env.MCP_SERVER_URL
    if (serverUrl) {
      console.log(`Attempting to connect to: ${serverUrl}`)

      try {
        await mcpClient.attachServer(serverUrl, 'external-server', 'stdio')
        const server = mcpClient.getAttachedServer('external-server')

        console.log(`✅ Connected to external MCP server`)
        console.log(`   Resources: ${server?.resources?.length || 0}`)
        console.log(`   Tools: ${server?.tools?.length || 0}`)

        // List available resources
        if (server?.resources && server.resources.length > 0) {
          console.log('\nAvailable resources:')
          server.resources.forEach((r) => {
            console.log(`   • ${r.name}: ${r.uri}`)
          })

          // Create a virtual table from the first resource
          const firstResource = server.resources[0]
          console.log(`\nCreating virtual table from resource: ${firstResource.name}`)

          await virtualTables.createVirtualTable(
            'external_data',
            firstResource.uri,
            'external-server',
            {
              autoRefresh: false,
              lazyLoad: false,
              maxRows: 1000,
            }
          )

          const externalCount = await duckdb.getRowCount('external_data')
          console.log(`✅ Created virtual table "external_data" with ${externalCount} rows`)
        }
      } catch (error) {
        console.log(`⚠️ Could not connect to external server: ${error}`)
      }
    } else {
      console.log('ℹ️ Set MCP_SERVER_URL environment variable to connect to an external MCP server')
      console.log('   Example: MCP_SERVER_URL=stdio://weather-server')
    }
    console.log()

    // Step 7: List all tables
    console.log('═══════════════════════════════════════════')
    console.log('📋 Step 7: Final Table Summary')
    console.log('═══════════════════════════════════════════')

    const schema = await duckdb.getSchema()
    console.log(`Total tables in DuckDB: ${schema.length}`)
    console.log('\nTable details:')

    for (const table of schema) {
      const rowCount = await duckdb.getRowCount(table.table_name)
      console.log(`  • ${table.table_name} (${table.table_type}): ${rowCount} rows`)
    }
    console.log()

    // Cleanup
    console.log('═══════════════════════════════════════════')
    console.log('🧹 Cleanup')
    console.log('═══════════════════════════════════════════')

    // Clear mapped resources
    await resourceMapper.clearAllMappings()
    console.log('✅ Cleared all resource mappings')

    // Disconnect MCP clients
    await mcpClient.disconnectAll()
    console.log('✅ Disconnected all MCP servers')

    // Close DuckDB
    await duckdb.close()
    console.log('✅ Closed DuckDB connection')

    console.log('\n✅ Example completed successfully!')
    console.log('\nKey takeaways:')
    console.log('  1. DuckDB can work with local and virtual tables seamlessly')
    console.log('  2. MCP resources can be mapped to DuckDB tables automatically')
    console.log('  3. Hybrid queries can join data from multiple sources')
    console.log('  4. Virtual tables support lazy loading and auto-refresh')
    console.log('  5. The system is extensible to any MCP-compatible server')
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

// Run the example
runClientExample().catch(console.error)
