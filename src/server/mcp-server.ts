#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { DuckDBService } from '../duckdb/service.js'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

/**
 * DuckDB MCP Server
 * Exposes DuckDB functionality through Model Context Protocol
 */
class DuckDBMCPServer {
  private server: Server
  private duckdb: DuckDBService

  constructor() {
    // Initialize MCP server
    this.server = new Server(
      {
        name: process.env.MCP_SERVER_NAME || 'duckdb-mcp-native',
        version: process.env.MCP_SERVER_VERSION || '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    )

    // Initialize DuckDB service
    this.duckdb = new DuckDBService({
      memory: process.env.DUCKDB_MEMORY || '4GB',
      threads: parseInt(process.env.DUCKDB_THREADS || '4'),
      allowUnsignedExtensions: process.env.ALLOW_UNSIGNED_EXTENSIONS === 'true',
      s3Config: process.env.MINIO_ACCESS_KEY
        ? {
            endpoint: process.env.MINIO_ENDPOINT,
            accessKey: process.env.MINIO_ACCESS_KEY,
            secretKey: process.env.MINIO_SECRET_KEY,
            region: process.env.MINIO_REGION || 'us-east-1',
            useSSL: process.env.MINIO_USE_SSL === 'true',
          }
        : undefined,
    })

    this.setupHandlers()
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'query_duckdb',
            description: 'Execute SQL queries on DuckDB',
            inputSchema: {
              type: 'object',
              properties: {
                sql: {
                  type: 'string',
                  description: 'SQL query to execute',
                },
                limit: {
                  type: 'number',
                  description: 'Optional limit for results (default: 1000)',
                  default: 1000,
                },
              },
              required: ['sql'],
            },
          },
          {
            name: 'list_tables',
            description: 'List all tables in DuckDB',
            inputSchema: {
              type: 'object',
              properties: {
                schema: {
                  type: 'string',
                  description: 'Schema name (default: main)',
                  default: 'main',
                },
              },
            },
          },
          {
            name: 'describe_table',
            description: 'Get schema information for a table',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'Name of the table',
                },
                schema: {
                  type: 'string',
                  description: 'Schema name (default: main)',
                  default: 'main',
                },
              },
              required: ['table_name'],
            },
          },
          {
            name: 'load_csv',
            description: 'Load a CSV file into DuckDB',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to CSV file (local or S3)',
                },
                table_name: {
                  type: 'string',
                  description: 'Name for the created table',
                },
              },
              required: ['path', 'table_name'],
            },
          },
          {
            name: 'load_parquet',
            description: 'Load a Parquet file into DuckDB',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to Parquet file (local or S3)',
                },
                table_name: {
                  type: 'string',
                  description: 'Name for the created table',
                },
              },
              required: ['path', 'table_name'],
            },
          },
        ],
      }
    })

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params

        if (!args) {
          throw new Error(`Missing arguments for tool: ${name}`)
        }

        // Validate security in production mode
        if (process.env.MCP_SECURITY_MODE === 'production' && 'sql' in args) {
          this.validateQuery(args.sql as string)
        }

        switch (name) {
          case 'query_duckdb': {
            const sql = args.sql as string
            const limit = (args.limit as number) || 1000

            // Add LIMIT if not present for safety
            const safeSql = sql.match(/LIMIT\s+\d+/i) ? sql : `${sql} LIMIT ${limit}`

            const startTime = Date.now()
            const results = await this.duckdb.executeQuery(safeSql)
            const executionTime = Date.now() - startTime

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      rowCount: results.length,
                      executionTimeMs: executionTime,
                      data: results,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'list_tables': {
            const schema = (args.schema as string) || 'main'
            const tables = await this.duckdb.executeQuery(`
              SELECT table_name, table_type 
              FROM information_schema.tables 
              WHERE table_schema = '${schema}'
              ORDER BY table_name
            `)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      schema,
                      tables,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'describe_table': {
            const tableName = args.table_name as string
            const schema = (args.schema as string) || 'main'
            const columns = await this.duckdb.getTableColumns(tableName, schema)
            const rowCount = await this.duckdb.getRowCount(tableName)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      table: tableName,
                      schema,
                      rowCount,
                      columns,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'load_csv': {
            const path = args.path as string
            const tableName = args.table_name as string

            await this.duckdb.executeQuery(`
              CREATE OR REPLACE TABLE ${tableName} AS 
              SELECT * FROM read_csv_auto('${path}')
            `)

            const rowCount = await this.duckdb.getRowCount(tableName)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      message: `CSV loaded into table ${tableName}`,
                      rowCount,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'load_parquet': {
            const path = args.path as string
            const tableName = args.table_name as string

            await this.duckdb.executeQuery(`
              CREATE OR REPLACE TABLE ${tableName} AS 
              SELECT * FROM read_parquet('${path}')
            `)

            const rowCount = await this.duckdb.getRowCount(tableName)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      message: `Parquet loaded into table ${tableName}`,
                      rowCount,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
        }
      } catch (error: any) {
        console.error('Tool execution error:', error)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: error.message,
                },
                null,
                2
              ),
            },
          ],
        }
      }
    })

    // List available resources (tables)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const tables = await this.duckdb.getSchema()

        return {
          resources: tables.map((table) => ({
            uri: `duckdb://table/${table.table_name}`,
            name: table.table_name,
            description: `DuckDB table: ${table.table_name} (${table.table_type})`,
            mimeType: 'application/json',
          })),
        }
      } catch (error) {
        console.error('Error listing resources:', error)
        return { resources: [] }
      }
    })

    // Read resource (table data)
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      try {
        const uri = request.params.uri
        const match = uri.match(/^duckdb:\/\/table\/(.+)$/)

        if (!match) {
          throw new McpError(ErrorCode.InvalidRequest, `Invalid resource URI: ${uri}`)
        }

        const tableName = match[1]
        const data = await this.duckdb.executeQuery(`SELECT * FROM ${tableName} LIMIT 1000`)

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        }
      } catch (error: any) {
        console.error('Error reading resource:', error)
        throw new McpError(ErrorCode.InternalError, `Failed to read resource: ${error.message}`)
      }
    })
  }

  /**
   * Validate SQL query for security
   */
  private validateQuery(sql?: string) {
    if (!sql) return

    const dangerousPatterns = [
      /DROP\s+TABLE/i,
      /TRUNCATE/i,
      /DELETE\s+FROM/i,
      /INSERT\s+INTO/i,
      /UPDATE\s+.*\s+SET/i,
      /ALTER\s+TABLE/i,
      /CREATE\s+USER/i,
      /GRANT/i,
      /REVOKE/i,
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(sql)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Query contains potentially dangerous operations'
        )
      }
    }

    // Check query size
    const maxSize = parseInt(process.env.MCP_MAX_QUERY_SIZE || '1000000')
    if (sql.length > maxSize) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Query exceeds maximum size of ${maxSize} characters`
      )
    }
  }

  /**
   * Start the MCP server
   */
  async start() {
    // Initialize DuckDB
    await this.duckdb.initialize()
    console.error('DuckDB initialized')

    // Start MCP server with stdio transport
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    console.error('DuckDB MCP Server started')
  }
}

// Start the server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new DuckDBMCPServer()
  server.start().catch((error) => {
    console.error('Failed to start server:', error)
    process.exit(1)
  })
}

export { DuckDBMCPServer }
