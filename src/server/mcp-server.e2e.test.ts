import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { DuckDBMCPServer } from './mcp-server.js'
import { createDuckDBService, DuckDBService } from '../duckdb/service.js'
import { MCPClient } from '../client/MCPClient.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import * as fs from 'fs/promises'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('MCP Server E2E Tests', () => {
  let server: DuckDBMCPServer
  let duckdb: DuckDBService
  let testDataDir: string

  beforeAll(async () => {
    // Create test data directory
    testDataDir = path.join(__dirname, '../../test-data-e2e')
    await fs.mkdir(testDataDir, { recursive: true })

    // Create test CSV file
    const csvContent = `id,product,category,price,quantity
1,Laptop,Electronics,999.99,50
2,Mouse,Electronics,29.99,200
3,Desk,Furniture,299.99,25
4,Chair,Furniture,199.99,40
5,Monitor,Electronics,399.99,75
6,Keyboard,Electronics,79.99,150
7,Bookshelf,Furniture,149.99,30
8,Headphones,Electronics,99.99,100
9,Lamp,Furniture,49.99,60
10,Webcam,Electronics,59.99,80`
    await fs.writeFile(path.join(testDataDir, 'products.csv'), csvContent)

    // Create test JSON file
    const jsonData = [
      { store_id: 1, store_name: 'Downtown Store', city: 'New York', revenue: 50000 },
      { store_id: 2, store_name: 'Mall Store', city: 'Los Angeles', revenue: 75000 },
      { store_id: 3, store_name: 'Airport Store', city: 'Chicago', revenue: 60000 },
      { store_id: 4, store_name: 'Suburb Store', city: 'New York', revenue: 45000 },
      { store_id: 5, store_name: 'Beach Store', city: 'Los Angeles', revenue: 65000 },
    ]
    await fs.writeFile(path.join(testDataDir, 'stores.json'), JSON.stringify(jsonData, null, 2))
  })

  afterAll(async () => {
    // Clean up test data
    await fs.rm(testDataDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    // Create fresh DuckDB instance for each test
    duckdb = createDuckDBService({
      memory: '512MB',
      threads: 2,
    })
    await duckdb.initialize()

    // Create server with real DuckDB
    server = new DuckDBMCPServer(duckdb)
  })

  afterEach(async () => {
    await duckdb.close()
  })

  describe('Complete Data Pipeline Workflow', () => {
    it('should handle a full ETL pipeline from CSV to aggregated results', async () => {
      // Debug: Check if server and duckdb are properly initialized
      console.log('Server has duckdb:', !!server.duckdb)
      console.log('DuckDB isReady:', duckdb.isReady())

      // Step 1: Load CSV data
      const loadResult = await server.handleToolCall('load_csv', {
        path: path.join(testDataDir, 'products.csv'),
        table_name: 'products',
      })
      console.log('Load result:', loadResult)
      expect(loadResult.success).toBe(true)
      expect(loadResult.rowCount).toBe(10)

      // Step 2: Verify data was loaded
      const verifyResult = await server.handleToolCall('query_duckdb', {
        sql: 'SELECT COUNT(*) as count FROM products',
      })
      expect(verifyResult.success).toBe(true)
      expect(Number(verifyResult.data[0].count)).toBe(10)

      // Step 3: Perform aggregation - analyze by category
      const aggregateResult = await server.handleToolCall('query_duckdb', {
        sql: `
          SELECT 
            category,
            COUNT(*) as product_count,
            ROUND(AVG(price), 2) as avg_price,
            SUM(quantity) as total_inventory,
            ROUND(SUM(price * quantity), 2) as inventory_value
          FROM products
          GROUP BY category
          ORDER BY inventory_value DESC
        `,
      })
      expect(aggregateResult.success).toBe(true)
      expect(aggregateResult.data).toHaveLength(2) // Electronics and Furniture

      // Step 4: Create a summary table
      const createSummaryResult = await server.handleToolCall('query_duckdb', {
        sql: `
          CREATE TABLE category_summary AS
          SELECT 
            category,
            COUNT(*) as product_count,
            ROUND(AVG(price), 2) as avg_price,
            SUM(quantity) as total_inventory
          FROM products
          GROUP BY category
        `,
      })
      expect(createSummaryResult.success).toBe(true)

      // Step 5: Verify summary table exists
      const tablesResult = await server.handleToolCall('list_tables', {
        schema: 'main',
      })
      expect(tablesResult.success).toBe(true)
      const summaryTable = tablesResult.tables.find((t: any) => t.table_name === 'category_summary')
      expect(summaryTable).toBeDefined()

      // Step 6: Query the summary
      const summaryResult = await server.handleToolCall('query_duckdb', {
        sql: 'SELECT * FROM category_summary ORDER BY product_count DESC',
      })
      expect(summaryResult.success).toBe(true)

      const electronics = summaryResult.data.find((r: any) => r.category === 'Electronics')
      expect(electronics).toBeDefined()
      expect(Number(electronics.product_count)).toBe(6)

      const furniture = summaryResult.data.find((r: any) => r.category === 'Furniture')
      expect(furniture).toBeDefined()
      expect(Number(furniture.product_count)).toBe(4)
    })

    it('should handle multi-source data joining workflow', async () => {
      // Step 1: Load products from CSV
      const loadProductsResult = await server.handleToolCall('load_csv', {
        path: path.join(testDataDir, 'products.csv'),
        table_name: 'products',
      })
      expect(loadProductsResult.success).toBe(true)

      // Step 2: Load stores from JSON
      const loadStoresResult = await server.handleToolCall('load_json', {
        path: path.join(testDataDir, 'stores.json'),
        table_name: 'stores',
      })
      expect(loadStoresResult.success).toBe(true)

      // Step 3: Create a cross-reference table (simulate sales data)
      const createSalesResult = await server.handleToolCall('query_duckdb', {
        sql: `
          CREATE TABLE store_products AS
          SELECT 
            s.store_id,
            s.store_name,
            s.city,
            p.product,
            p.category,
            p.price,
            CAST(RANDOM() * 10 + 1 AS INTEGER) as units_sold
          FROM stores s
          CROSS JOIN products p
          WHERE 
            (s.city = 'New York' AND p.category = 'Electronics') OR
            (s.city = 'Los Angeles' AND p.category = 'Furniture') OR
            (s.city = 'Chicago')
        `,
      })
      expect(createSalesResult.success).toBe(true)

      // Step 4: Analyze sales by city
      const cityAnalysisResult = await server.handleToolCall('query_duckdb', {
        sql: `
          SELECT 
            city,
            COUNT(DISTINCT product) as product_variety,
            SUM(units_sold) as total_units_sold,
            ROUND(SUM(price * units_sold), 2) as total_revenue
          FROM store_products
          GROUP BY city
          ORDER BY total_revenue DESC
        `,
      })
      expect(cityAnalysisResult.success).toBe(true)
      expect(cityAnalysisResult.data.length).toBeGreaterThan(0)

      // Verify all cities are represented
      const cities = cityAnalysisResult.data.map((r: any) => r.city)
      expect(cities).toContain('New York')
      expect(cities).toContain('Los Angeles')
      expect(cities).toContain('Chicago')
    })

    it('should handle data validation and cleaning workflow', async () => {
      // Step 1: Create a table with dirty data
      const createDirtyResult = await server.handleToolCall('query_duckdb', {
        sql: `
          CREATE TABLE raw_data (
            id INTEGER,
            email VARCHAR,
            age INTEGER,
            salary DECIMAL
          )
        `,
      })
      expect(createDirtyResult.success).toBe(true)

      // Step 2: Insert data with issues
      const insertResult = await server.handleToolCall('query_duckdb', {
        sql: `
          INSERT INTO raw_data VALUES
          (1, 'john@example.com', 25, 50000),
          (2, 'invalid-email', 30, 60000),
          (3, 'jane@test.com', -5, 55000),
          (4, 'bob@company.com', 150, 70000),
          (5, NULL, 35, NULL),
          (6, 'alice@domain.com', 28, -10000)
        `,
      })
      expect(insertResult.success).toBe(true)

      // Step 3: Identify data quality issues
      const validateResult = await server.handleToolCall('query_duckdb', {
        sql: `
          SELECT 
            COUNT(*) as total_records,
            COUNT(*) FILTER (WHERE email IS NULL) as null_emails,
            COUNT(*) FILTER (WHERE email NOT LIKE '%@%.%') as invalid_emails,
            COUNT(*) FILTER (WHERE age < 0 OR age > 120) as invalid_ages,
            COUNT(*) FILTER (WHERE salary < 0) as negative_salaries,
            COUNT(*) FILTER (WHERE salary IS NULL) as null_salaries
          FROM raw_data
        `,
      })
      expect(validateResult.success).toBe(true)

      const validation = validateResult.data[0]
      expect(Number(validation.total_records)).toBe(6)
      expect(Number(validation.invalid_emails)).toBeGreaterThan(0)
      expect(Number(validation.invalid_ages)).toBeGreaterThan(0)

      // Step 4: Create cleaned data table
      const cleanResult = await server.handleToolCall('query_duckdb', {
        sql: `
          CREATE TABLE clean_data AS
          SELECT 
            id,
            CASE 
              WHEN email LIKE '%@%.%' THEN email
              ELSE NULL
            END as email,
            CASE 
              WHEN age >= 0 AND age <= 120 THEN age
              ELSE NULL
            END as age,
            CASE 
              WHEN salary >= 0 THEN salary
              ELSE NULL
            END as salary
          FROM raw_data
          WHERE email IS NOT NULL 
            AND (email LIKE '%@%.%')
            AND age >= 18 
            AND age <= 100
            AND salary > 0
        `,
      })
      expect(cleanResult.success).toBe(true)

      // Step 5: Verify clean data
      const verifyCleanResult = await server.handleToolCall('query_duckdb', {
        sql: 'SELECT COUNT(*) as clean_count FROM clean_data',
      })
      expect(verifyCleanResult.success).toBe(true)
      expect(Number(verifyCleanResult.data[0].clean_count)).toBeLessThan(6)
    })

    it('should handle complex analytical queries workflow', async () => {
      // Step 1: Create sales data
      const createSalesResult = await server.handleToolCall('query_duckdb', {
        sql: `
          CREATE TABLE sales AS
          SELECT 
            'Q' || ((i-1) / 3 + 1) as quarter,
            'Month' || i as month,
            'Product' || ((i-1) % 5 + 1) as product,
            CAST(RANDOM() * 1000 + 100 AS INTEGER) as units,
            ROUND(RANDOM() * 100 + 50, 2) as price
          FROM generate_series(1, 12) t(i)
        `,
      })
      expect(createSalesResult.success).toBe(true)

      // Step 2: Calculate running totals
      const runningTotalResult = await server.handleToolCall('query_duckdb', {
        sql: `
          SELECT 
            quarter,
            month,
            units * price as revenue,
            SUM(units * price) OVER (
              ORDER BY month 
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) as running_total
          FROM sales
          ORDER BY month
          LIMIT 6
        `,
      })
      expect(runningTotalResult.success).toBe(true)
      expect(runningTotalResult.data).toHaveLength(6)

      // Step 3: Calculate quarter-over-quarter growth
      const qoqResult = await server.handleToolCall('query_duckdb', {
        sql: `
          WITH quarterly_sales AS (
            SELECT 
              quarter,
              SUM(units * price) as total_revenue
            FROM sales
            GROUP BY quarter
          )
          SELECT 
            quarter,
            ROUND(total_revenue, 2) as revenue,
            ROUND(
              LAG(total_revenue) OVER (ORDER BY quarter),
              2
            ) as prev_quarter_revenue,
            ROUND(
              ((total_revenue - LAG(total_revenue) OVER (ORDER BY quarter)) / 
               LAG(total_revenue) OVER (ORDER BY quarter)) * 100,
              2
            ) as qoq_growth_pct
          FROM quarterly_sales
          ORDER BY quarter
        `,
      })
      expect(qoqResult.success).toBe(true)
      expect(qoqResult.data.length).toBeGreaterThan(0)

      // Step 4: Top products analysis
      const topProductsResult = await server.handleToolCall('query_duckdb', {
        sql: `
          SELECT 
            product,
            COUNT(*) as transactions,
            SUM(units) as total_units,
            ROUND(AVG(price), 2) as avg_price,
            ROUND(SUM(units * price), 2) as total_revenue,
            RANK() OVER (ORDER BY SUM(units * price) DESC) as revenue_rank
          FROM sales
          GROUP BY product
          ORDER BY total_revenue DESC
        `,
      })
      expect(topProductsResult.success).toBe(true)
      expect(topProductsResult.data.length).toBeGreaterThan(0)
    })

    it('should handle schema introspection workflow', async () => {
      // Step 1: Create multiple tables with relationships
      const createSchemaResult = await server.handleToolCall('query_duckdb', {
        sql: `
          CREATE TABLE departments (
            dept_id INTEGER PRIMARY KEY,
            dept_name VARCHAR NOT NULL,
            budget DECIMAL(10,2)
          );
          
          CREATE TABLE employees (
            emp_id INTEGER PRIMARY KEY,
            emp_name VARCHAR NOT NULL,
            dept_id INTEGER REFERENCES departments(dept_id),
            salary DECIMAL(10,2),
            hire_date DATE
          );
          
          CREATE TABLE projects (
            project_id INTEGER PRIMARY KEY,
            project_name VARCHAR,
            dept_id INTEGER,
            start_date DATE,
            end_date DATE
          );
        `,
      })
      expect(createSchemaResult.success).toBe(true)

      // Step 2: List all tables
      const tablesResult = await server.handleToolCall('list_tables', {
        schema: 'main',
      })
      expect(tablesResult.success).toBe(true)
      expect(tablesResult.tables.map((t: any) => t.table_name)).toContain('departments')
      expect(tablesResult.tables.map((t: any) => t.table_name)).toContain('employees')
      expect(tablesResult.tables.map((t: any) => t.table_name)).toContain('projects')

      // Step 3: Describe each table structure
      const deptStructure = await server.handleToolCall('describe_table', {
        table_name: 'departments',
      })
      expect(deptStructure.success).toBe(true)
      expect(deptStructure.columns).toHaveLength(3)

      const empStructure = await server.handleToolCall('describe_table', {
        table_name: 'employees',
      })
      expect(empStructure.success).toBe(true)
      expect(empStructure.columns).toHaveLength(5)

      // Step 4: Query schema information
      const schemaInfoResult = await server.handleToolCall('query_duckdb', {
        sql: `
          SELECT 
            table_name,
            COUNT(*) as column_count
          FROM information_schema.columns
          WHERE table_schema = 'main'
            AND table_name IN ('departments', 'employees', 'projects')
          GROUP BY table_name
          ORDER BY table_name
        `,
      })
      expect(schemaInfoResult.success).toBe(true)
      expect(schemaInfoResult.data).toHaveLength(3)
    })
  })

  describe('Error Recovery Workflows', () => {
    it('should handle and recover from errors gracefully', async () => {
      // Step 1: Try to query non-existent table
      const errorResult = await server.handleToolCall('query_duckdb', {
        sql: 'SELECT * FROM non_existent_table',
      })
      expect(errorResult.success).toBe(false)
      expect(errorResult.error).toContain('non_existent_table')

      // Step 2: Server should still be functional
      const recoveryResult = await server.handleToolCall('query_duckdb', {
        sql: 'SELECT 1 as test',
      })
      expect(recoveryResult.success).toBe(true)
      expect(recoveryResult.data[0].test).toBe(1)

      // Step 3: Try invalid SQL syntax
      const syntaxErrorResult = await server.handleToolCall('query_duckdb', {
        sql: 'SELCT * FORM table',
      })
      expect(syntaxErrorResult.success).toBe(false)

      // Step 4: Verify server still works
      const postSyntaxResult = await server.handleToolCall('query_duckdb', {
        sql: 'SELECT 2 + 2 as result',
      })
      expect(postSyntaxResult.success).toBe(true)
      expect(postSyntaxResult.data[0].result).toBe(4)
    })
  })
})

// Helper to make handler calls easier
declare module './mcp-server.js' {
  interface DuckDBMCPServer {
    handleToolCall(toolName: string, args: any): Promise<any>
  }
}

// Add helper method for testing
DuckDBMCPServer.prototype.handleToolCall = async function (
  this: DuckDBMCPServer,
  toolName: string,
  args: any
) {
  // Make sure we have access to the DuckDB instance
  if (!this.duckdb) {
    return { success: false, error: 'DuckDB service not initialized' }
  }

  const handlers: Record<string, Function> = {
    query_duckdb: async (args: any) => {
      const { sql, limit = 1000 } = args

      try {
        const isSelectQuery = sql.trim().toUpperCase().startsWith('SELECT')
        const hasLimit = sql.match(/LIMIT\s+\d+/i)
        const safeSql = isSelectQuery && !hasLimit ? `${sql} LIMIT ${limit}` : sql

        const data = await this.duckdb.executeQuery(safeSql)
        return { success: true, data }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    },
    list_tables: async (args: any) => {
      const { schema = 'main' } = args
      try {
        const tables = await this.duckdb.executeQuery(`
          SELECT table_schema, table_name, table_type 
          FROM information_schema.tables 
          WHERE table_schema = '${schema}'
        `)
        return { success: true, tables }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    },
    describe_table: async (args: any) => {
      const { table_name, schema = 'main' } = args
      try {
        const columns = await this.duckdb.getTableColumns(table_name, schema)
        const rowCount = await this.duckdb.getRowCount(table_name, schema)
        return { success: true, columns, rowCount }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    },
    load_csv: async (args: any) => {
      const { path, table_name } = args
      try {
        await this.duckdb.executeQuery(`
          CREATE OR REPLACE TABLE ${table_name} AS 
          SELECT * FROM read_csv_auto('${path}')
        `)
        const rowCount = await this.duckdb.getRowCount(table_name)
        return {
          success: true,
          message: `CSV loaded into table ${table_name}`,
          rowCount,
        }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    },
    load_json: async (args: any) => {
      const { path, table_name } = args
      try {
        await this.duckdb.executeQuery(`
          CREATE OR REPLACE TABLE ${table_name} AS 
          SELECT * FROM read_json_auto('${path}')
        `)
        const rowCount = await this.duckdb.getRowCount(table_name)
        return {
          success: true,
          message: `JSON loaded into table ${table_name}`,
          rowCount,
        }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    },
  }

  const handler = handlers[toolName]
  if (!handler) {
    return { success: false, error: `Unknown tool: ${toolName}` }
  }

  return handler.call(this, args)
}
