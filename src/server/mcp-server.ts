#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { DuckDBService } from '../duckdb/service.js'
import { MCPClient } from '../client/MCPClient.js'
import { VirtualTableManager } from '../client/VirtualTable.js'
import { escapeIdentifier, escapeString, escapeFilePath } from '../utils/sql-escape.js'
import { nativeToolHandlers, nativeToolDefinitions } from '../tools/native-tools.js'
import { createDuckLakeToolHandlers } from '../tools/ducklake-tools.js'
import {
  createMotherDuckHandlers,
  getMotherDuckToolDefinitions,
} from '../tools/motherduck-tools.js'
import { SpaceContext, SpaceContextFactory } from '../context/SpaceContext.js'
import { logger } from '../utils/logger.js'
import { getMetricsCollector } from '../monitoring/MetricsCollector.js'
import { FederationManager } from '../federation/index.js'
import dotenv from 'dotenv'

// Load environment variables
// Use quiet mode to prevent stdout pollution
dotenv.config({ quiet: true } as any)

/**
 * DuckDB MCP Server
 * Exposes DuckDB functionality through Model Context Protocol
 */
class DuckDBMCPServer {
  private server: Server
  private duckdb: DuckDBService
  private mcpClient: MCPClient
  private virtualTables: VirtualTableManager
  private federation: FederationManager
  private spaceFactory?: SpaceContextFactory
  private currentSpace?: SpaceContext
  private embeddedMode: boolean = false
  private ducklakeHandlers: ReturnType<typeof createDuckLakeToolHandlers>
  private motherduckHandlers: ReturnType<typeof createMotherDuckHandlers>

  constructor(config?: {
    embeddedMode?: boolean
    duckdbService?: DuckDBService
    spaceFactory?: SpaceContextFactory
  }) {
    this.embeddedMode = config?.embeddedMode || false
    this.spaceFactory = config?.spaceFactory

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
          prompts: {},
        },
      }
    )

    // Use provided DuckDB service or create new one
    this.duckdb =
      config?.duckdbService ||
      new DuckDBService({
        memory: process.env.DUCKDB_MEMORY || '4GB',
        threads: parseInt(process.env.DUCKDB_THREADS || '4'),
        allowUnsignedExtensions: process.env.ALLOW_UNSIGNED_EXTENSIONS === 'true',
        s3Config: process.env.MINIO_ACCESS_KEY
          ? {
              // Endpoint will be automatically selected based on context
              // Leave undefined to let the service choose between public/private
              endpoint: undefined,
              accessKey: process.env.MINIO_ACCESS_KEY,
              secretKey: process.env.MINIO_SECRET_KEY,
              region: process.env.MINIO_REGION || 'us-east-1',
              useSSL: process.env.MINIO_USE_SSL === 'true',
            }
          : undefined,
        // Enable Virtual Filesystem for mcp:// URI support
        virtualFilesystem: {
          enabled: true,
          config: {
            cacheConfig: {
              cacheDir: process.env.MCP_CACHE_DIR || '/tmp/mcp-cache',
              defaultTTL: parseInt(process.env.MCP_CACHE_TTL || '300000'), // 5 minutes default
              maxSize: parseInt(process.env.MCP_CACHE_SIZE || '104857600'), // 100MB default
            },
            autoConnect: false, // Disable auto-connection to prevent error spam for non-existent servers
            autoDiscovery: false, // Will be enabled when MCP servers are attached
          },
        },
      })

    // Initialize MCP client for virtual tables
    this.mcpClient = new MCPClient({
      name: process.env.MCP_SERVER_NAME || 'duckdb-mcp-native',
      version: process.env.MCP_SERVER_VERSION || '0.1.0',
      cacheEnabled: process.env.MCP_CACHE_ENABLED !== 'false',
      cacheTTL: parseInt(process.env.MCP_CACHE_TTL || '300'),
    })
    this.mcpClient.setDuckDBService(this.duckdb)

    // Initialize virtual table manager
    this.virtualTables = new VirtualTableManager(this.duckdb, this.mcpClient)

    // Initialize federation manager for distributed queries
    this.federation = new FederationManager({
      duckdb: this.duckdb,
      enableCache: true,
      cacheTTL: 300000, // 5 minutes
    })

    // Initialize DuckLake handlers
    this.ducklakeHandlers = createDuckLakeToolHandlers(this.duckdb, this.spaceFactory)

    // Initialize MotherDuck handlers
    this.motherduckHandlers = createMotherDuckHandlers(this.duckdb)

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
          {
            name: 'attach_mcp',
            description: 'Attach an external MCP server',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'MCP server URL (e.g., stdio://command?args=arg1,arg2)',
                },
                alias: {
                  type: 'string',
                  description: 'Unique alias for the server',
                },
                transport: {
                  type: 'string',
                  enum: ['stdio', 'http', 'websocket'],
                  description: 'Transport type (default: stdio)',
                  default: 'stdio',
                },
              },
              required: ['url', 'alias'],
            },
          },
          {
            name: 'detach_mcp',
            description: 'Detach an MCP server',
            inputSchema: {
              type: 'object',
              properties: {
                alias: {
                  type: 'string',
                  description: 'Alias of the server to detach',
                },
              },
              required: ['alias'],
            },
          },
          {
            name: 'list_attached_servers',
            description: 'List all attached MCP servers',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'list_mcp_resources',
            description: 'List resources from attached MCP servers',
            inputSchema: {
              type: 'object',
              properties: {
                server_alias: {
                  type: 'string',
                  description: 'Optional server alias to filter resources',
                },
              },
            },
          },
          {
            name: 'create_virtual_table',
            description: 'Create a virtual table from an MCP resource',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'Name for the virtual table',
                },
                resource_uri: {
                  type: 'string',
                  description: 'MCP resource URI',
                },
                server_alias: {
                  type: 'string',
                  description: 'Server alias (optional if using mcp:// URI)',
                },
                auto_refresh: {
                  type: 'boolean',
                  description: 'Enable auto-refresh (default: false)',
                  default: false,
                },
                refresh_interval: {
                  type: 'number',
                  description: 'Refresh interval in ms (default: 60000)',
                  default: 60000,
                },
                lazy_load: {
                  type: 'boolean',
                  description: 'Load data on first access (default: false)',
                  default: false,
                },
                max_rows: {
                  type: 'number',
                  description: 'Maximum rows to load',
                },
              },
              required: ['table_name', 'resource_uri'],
            },
          },
          {
            name: 'drop_virtual_table',
            description: 'Drop a virtual table',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'Name of the virtual table to drop',
                },
              },
              required: ['table_name'],
            },
          },
          {
            name: 'list_virtual_tables',
            description: 'List all virtual tables',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'refresh_virtual_table',
            description: 'Refresh a virtual table with latest data',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'Name of the virtual table to refresh',
                },
              },
              required: ['table_name'],
            },
          },
          {
            name: 'query_hybrid',
            description: 'Execute a hybrid query across local and virtual tables',
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
            name: 'federate_query',
            description: 'Execute federated queries across multiple MCP servers using mcp:// URIs',
            inputSchema: {
              type: 'object',
              properties: {
                sql: {
                  type: 'string',
                  description:
                    'SQL query with mcp:// URIs, e.g. SELECT * FROM "mcp://github/data.json" JOIN local.users',
                },
                explain: {
                  type: 'boolean',
                  description: 'Return query plan instead of executing (default: false)',
                  default: false,
                },
              },
              required: ['sql'],
            },
          },
          {
            name: 'ducklake.attach',
            description:
              'Attach or create a DuckLake catalog for ACID transactions and time travel',
            inputSchema: {
              type: 'object',
              properties: {
                spaceId: {
                  type: 'string',
                  description: 'Space ID to attach DuckLake to (optional)',
                },
                catalogName: {
                  type: 'string',
                  description: 'Name for the DuckLake catalog',
                },
                catalogLocation: {
                  type: 'string',
                  description: 'S3/MinIO path for catalog data',
                },
                format: {
                  type: 'string',
                  enum: ['DELTA', 'ICEBERG'],
                  description: 'Table format to use (default: DELTA)',
                  default: 'DELTA',
                },
                enableTimeTravel: {
                  type: 'boolean',
                  description: 'Enable time travel queries (default: true)',
                  default: true,
                },
                retentionDays: {
                  type: 'number',
                  description: 'Days to retain old versions (default: 30)',
                  default: 30,
                },
                compressionType: {
                  type: 'string',
                  enum: ['ZSTD', 'SNAPPY', 'LZ4', 'GZIP', 'NONE'],
                  description: 'Compression for Parquet files (default: ZSTD)',
                  default: 'ZSTD',
                },
              },
              required: ['catalogName', 'catalogLocation'],
            },
          },
          {
            name: 'ducklake.snapshots',
            description: 'List, view, clone or rollback table snapshots with version control',
            inputSchema: {
              type: 'object',
              properties: {
                spaceId: {
                  type: 'string',
                  description: 'Space ID for multi-tenant isolation (optional)',
                },
                catalogName: {
                  type: 'string',
                  description: 'DuckLake catalog name',
                },
                tableName: {
                  type: 'string',
                  description: 'Table to get snapshots for',
                },
                action: {
                  type: 'string',
                  enum: ['list', 'details', 'clone', 'rollback'],
                  description: 'Action to perform (default: list)',
                  default: 'list',
                },
                version: {
                  type: ['number', 'string'],
                  description: 'Version number or timestamp for details/clone/rollback',
                },
                targetTableName: {
                  type: 'string',
                  description: 'Target table name for clone operation',
                },
              },
              required: ['catalogName', 'tableName'],
            },
          },
          {
            name: 'ducklake.time_travel',
            description: 'Execute queries on historical data at a specific point in time',
            inputSchema: {
              type: 'object',
              properties: {
                spaceId: {
                  type: 'string',
                  description: 'Space ID for multi-tenant isolation (optional)',
                },
                catalogName: {
                  type: 'string',
                  description: 'DuckLake catalog name',
                },
                tableName: {
                  type: 'string',
                  description: 'Table to query',
                },
                query: {
                  type: 'string',
                  description: 'SQL query to execute',
                },
                timestamp: {
                  type: ['number', 'string'],
                  description: 'Version number or ISO timestamp to query at',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum rows to return (default: 100)',
                  default: 100,
                },
              },
              required: ['catalogName', 'tableName', 'query', 'timestamp'],
            },
          },
          // MotherDuck tools
          ...getMotherDuckToolDefinitions(),
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

            // Remove trailing semicolon if present
            const cleanSql = sql.trim().replace(/;\s*$/, '')

            // Only add LIMIT to SELECT queries for safety
            const isSelectQuery = cleanSql.toUpperCase().startsWith('SELECT')
            const hasLimit = cleanSql.match(/LIMIT\s+\d+/i)
            const safeSql = isSelectQuery && !hasLimit ? `${cleanSql} LIMIT ${limit}` : cleanSql

            const startTime = Date.now()
            // Use VFS-aware query execution to support mcp:// URIs
            const results = await this.duckdb.executeQueryWithVFS(safeSql)
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
              WHERE table_schema = ${escapeString(schema)}
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
            const rowCount = await this.duckdb.getRowCount(tableName, schema)

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
              CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} AS 
              SELECT * FROM read_csv_auto(${escapeFilePath(path)})
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
              CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} AS 
              SELECT * FROM read_parquet(${escapeFilePath(path)})
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

          case 'attach_mcp': {
            const url = args.url as string
            const alias = args.alias as string
            const transport = (args.transport as 'stdio' | 'http' | 'websocket') || 'stdio'

            // Attach to MCP client for virtual tables
            await this.mcpClient.attachServer(url, alias, transport)
            const server = this.mcpClient.getAttachedServer(alias)

            // Also register with federation for distributed queries
            await this.federation.registerServer(alias, url, {
              transport,
              resources: server?.resources?.length || 0,
              tools: server?.tools?.length || 0,
            })

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      message: `Attached MCP server '${alias}' (registered for federation)`,
                      resources: server?.resources?.length || 0,
                      tools: server?.tools?.length || 0,
                      federationEnabled: true,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'detach_mcp': {
            const alias = args.alias as string
            await this.mcpClient.detachServer(alias)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      message: `Detached MCP server '${alias}'`,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'list_attached_servers': {
            const servers = this.mcpClient.listAttachedServers()

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      servers: servers.map((s) => ({
                        alias: s.alias,
                        url: s.url,
                        transport: s.transport,
                        resources: s.resources?.length || 0,
                        tools: s.tools?.length || 0,
                        lastRefresh: s.lastRefresh,
                      })),
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'list_mcp_resources': {
            const serverAlias = args.server_alias as string | undefined
            const resources = await this.mcpClient.listResources(serverAlias)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      resources,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'create_virtual_table': {
            const tableName = args.table_name as string
            const resourceUri = args.resource_uri as string
            const serverAlias = args.server_alias as string | undefined
            const config = {
              autoRefresh: args.auto_refresh as boolean,
              refreshInterval: args.refresh_interval as number,
              lazyLoad: args.lazy_load as boolean,
              maxRows: args.max_rows as number | undefined,
            }

            const virtualTable = await this.virtualTables.createVirtualTable(
              tableName,
              resourceUri,
              serverAlias,
              config
            )

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      message: `Created virtual table '${tableName}'`,
                      rowCount: virtualTable.metadata.rowCount || 0,
                      columns: virtualTable.metadata.columns,
                      config: virtualTable.config,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'drop_virtual_table': {
            const tableName = args.table_name as string
            await this.virtualTables.dropVirtualTable(tableName)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      message: `Dropped virtual table '${tableName}'`,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'list_virtual_tables': {
            const tables = this.virtualTables.listVirtualTables()

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      tables: tables.map((t) => ({
                        name: t.name,
                        resourceUri: t.resourceUri,
                        serverAlias: t.serverAlias,
                        rowCount: t.metadata.rowCount,
                        config: t.config,
                        lastRefresh: t.metadata.lastRefresh,
                      })),
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'refresh_virtual_table': {
            const tableName = args.table_name as string
            await this.virtualTables.refreshVirtualTable(tableName)
            const table = this.virtualTables.getVirtualTable(tableName)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      message: `Refreshed virtual table '${tableName}'`,
                      rowCount: table?.metadata.rowCount || 0,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }

          case 'query_hybrid': {
            const sql = args.sql as string
            const limit = (args.limit as number) || 1000

            // Only add LIMIT to SELECT queries for safety
            const isSelectQuery = sql.trim().toUpperCase().startsWith('SELECT')
            const hasLimit = sql.match(/LIMIT\s+\d+/i)
            const safeSql = isSelectQuery && !hasLimit ? `${sql} LIMIT ${limit}` : sql

            const startTime = Date.now()
            const results = await this.virtualTables.executeHybridQuery(safeSql)
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

          case 'federate_query': {
            const sql = args.sql as string
            const explain = (args.explain as boolean) || false

            try {
              // Track metrics
              const startTime = Date.now()

              // If explain mode, return query plan
              if (explain) {
                const plan = this.federation.analyzeQuery(sql)
                const explanation = this.federation.explainQuery(sql)

                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        {
                          success: true,
                          queryPlan: plan,
                          explanation: explanation,
                        },
                        null,
                        2
                      ),
                    },
                  ],
                }
              }

              // Execute federated query
              const result = await this.federation.federateQuery(sql)
              const executionTime = Date.now() - startTime

              // Record metrics
              const metricsCollector = getMetricsCollector()
              metricsCollector.recordQuery(
                sql,
                executionTime,
                result.data?.length || 0,
                'federation'
              )

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      {
                        success: true,
                        rowCount: result.data?.length || 0,
                        executionTimeMs: executionTime,
                        data: result.data,
                        metadata: result.metadata,
                      },
                      null,
                      2
                    ),
                  },
                ],
              }
            } catch (error) {
              logger.error('Federation query failed:', error)
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      {
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error',
                      },
                      null,
                      2
                    ),
                  },
                ],
              }
            }
          }

          case 'ducklake.attach': {
            const result = await this.ducklakeHandlers['ducklake.attach'](args)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          case 'ducklake.snapshots': {
            const result = await this.ducklakeHandlers['ducklake.snapshots'](args)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          case 'ducklake.time_travel': {
            const result = await this.ducklakeHandlers['ducklake.time_travel'](args)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          // MotherDuck tools
          case 'motherduck.attach': {
            const result = await this.motherduckHandlers['motherduck.attach'](args)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          case 'motherduck.detach': {
            const result = await this.motherduckHandlers['motherduck.detach']()
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          case 'motherduck.status': {
            const result = await this.motherduckHandlers['motherduck.status']()
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          case 'motherduck.list_databases': {
            const result = await this.motherduckHandlers['motherduck.list_databases']()
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          case 'motherduck.create_database': {
            const result = await this.motherduckHandlers['motherduck.create_database'](args)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          case 'motherduck.query': {
            const result = await this.motherduckHandlers['motherduck.query'](args)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          case 'motherduck.share_table': {
            const result = await this.motherduckHandlers['motherduck.share_table'](args)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          case 'motherduck.import_table': {
            const result = await this.motherduckHandlers['motherduck.import_table'](args)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
        }
      } catch (error: any) {
        logger.error('Tool execution error:', error)
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

    // List available resources (tables, DuckLake catalogs, spaces)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const resources = []

        // List regular tables
        const tables = await this.duckdb.getSchema()
        resources.push(
          ...tables.map((table) => ({
            uri: `duckdb://table/${table.table_name}`,
            name: table.table_name,
            description: `DuckDB table: ${table.table_name} (${table.table_type})`,
            mimeType: 'application/json',
          }))
        )

        // List DuckLake catalogs if any exist
        try {
          const catalogsResult = await this.duckdb.executeQuery(`
            SELECT DISTINCT catalog_name, location
            FROM information_schema.schemata
            WHERE schema_name LIKE 'ducklake_%'
          `)

          if (catalogsResult.length > 0) {
            resources.push(
              ...catalogsResult.map((catalog: any) => ({
                uri: `duckdb://ducklake/${catalog.catalog_name}`,
                name: `DuckLake: ${catalog.catalog_name}`,
                description: `DuckLake catalog with ACID transactions and time travel`,
                mimeType: 'application/json',
              }))
            )
          }
        } catch {
          // DuckLake not configured, skip
        }

        // List multi-tenant spaces if any exist
        try {
          const spacesResult = await this.duckdb.executeQuery(`
            SELECT DISTINCT schema_name
            FROM information_schema.schemata
            WHERE schema_name LIKE 'space_%'
          `)

          if (spacesResult.length > 0) {
            resources.push(
              ...spacesResult.map((space: any) => ({
                uri: `duckdb://space/${space.schema_name}`,
                name: `Space: ${space.schema_name}`,
                description: `Multi-tenant space for isolated data`,
                mimeType: 'application/json',
              }))
            )
          }
        } catch {
          // Spaces not configured, skip
        }

        return { resources }
      } catch (error) {
        logger.error('Error listing resources:', error)
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
        const data = await this.duckdb.executeQuery(
          `SELECT * FROM ${escapeIdentifier(tableName)} LIMIT 1000`
        )

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
        logger.error('Error reading resource:', error)
        throw new McpError(ErrorCode.InternalError, `Failed to read resource: ${error.message}`)
      }
    })

    // List available prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [
          {
            name: 'analyze_data',
            description: 'Analyze data in a table with aggregations and statistics',
            arguments: [
              {
                name: 'table_name',
                description: 'Name of the table to analyze',
                required: true,
              },
              {
                name: 'columns',
                description: 'Specific columns to analyze (optional)',
                required: false,
              },
            ],
          },
          {
            name: 'ducklake_time_travel',
            description: 'Query historical data from DuckLake tables',
            arguments: [
              {
                name: 'catalog_name',
                description: 'DuckLake catalog name',
                required: true,
              },
              {
                name: 'table_name',
                description: 'Table to query',
                required: true,
              },
              {
                name: 'timestamp',
                description: 'Point in time to query (ISO format or version number)',
                required: true,
              },
            ],
          },
          {
            name: 'migrate_to_ducklake',
            description: 'Migrate data from various formats to DuckLake',
            arguments: [
              {
                name: 'source_path',
                description: 'Path to source file (CSV, Parquet, etc.)',
                required: true,
              },
              {
                name: 'catalog_name',
                description: 'Target DuckLake catalog',
                required: true,
              },
              {
                name: 'table_name',
                description: 'Name for the new table',
                required: true,
              },
            ],
          },
          {
            name: 'optimize_query',
            description: 'Get query optimization suggestions',
            arguments: [
              {
                name: 'query',
                description: 'SQL query to optimize',
                required: true,
              },
            ],
          },
          {
            name: 'data_quality_check',
            description: 'Check data quality and integrity',
            arguments: [
              {
                name: 'table_name',
                description: 'Table to check',
                required: true,
              },
              {
                name: 'checks',
                description: 'Types of checks to perform (nulls, duplicates, ranges)',
                required: false,
              },
            ],
          },
        ],
      }
    })

    // Get specific prompt
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const promptName = request.params.name
      const args = request.params.arguments || {}

      const prompts: Record<string, any> = {
        analyze_data: {
          name: 'analyze_data',
          description: 'Analyze data in a table with aggregations and statistics',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please analyze the table ${args.table_name || '[TABLE_NAME]'} and provide:
1. Row count and basic statistics
2. Column data types and null counts
3. ${args.columns ? `Focus on columns: ${args.columns}` : 'Analyze all columns'}
4. Any data quality issues found

Use these queries:
- SELECT COUNT(*) FROM ${args.table_name || '[TABLE_NAME]'}
- SELECT * FROM ${args.table_name || '[TABLE_NAME]'} LIMIT 10
- DESCRIBE ${args.table_name || '[TABLE_NAME]'}`,
              },
            },
          ],
        },
        ducklake_time_travel: {
          name: 'ducklake_time_travel',
          description: 'Query historical data from DuckLake tables',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Using DuckLake time travel to query ${args.table_name || '[TABLE]'} at ${args.timestamp || '[TIMESTAMP]'}:

1. Use the ducklake.time_travel tool with:
   - catalog_name: ${args.catalog_name || '[CATALOG]'}
   - table_name: ${args.table_name || '[TABLE]'}
   - timestamp: ${args.timestamp || '[TIMESTAMP]'}

2. Compare with current data if needed
3. Show what changed between versions`,
              },
            },
          ],
        },
        migrate_to_ducklake: {
          name: 'migrate_to_ducklake',
          description: 'Migrate data from various formats to DuckLake',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Migrate data to DuckLake:

Source: ${args.source_path || '[SOURCE_PATH]'}
Target Catalog: ${args.catalog_name || '[CATALOG]'}
Target Table: ${args.table_name || '[TABLE]'}

Steps:
1. Check if source file exists and is readable
2. Attach DuckLake catalog if not already attached
3. Create table with appropriate schema
4. Load data with ACID transaction
5. Verify migration success with row counts`,
              },
            },
          ],
        },
        optimize_query: {
          name: 'optimize_query',
          description: 'Get query optimization suggestions',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Optimize this query: ${args.query || '[QUERY]'}

Please provide:
1. EXPLAIN output for the query
2. Identified performance bottlenecks
3. Suggested indexes or materialized views
4. Rewritten optimized query if applicable
5. Expected performance improvement`,
              },
            },
          ],
        },
        data_quality_check: {
          name: 'data_quality_check',
          description: 'Check data quality and integrity',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Perform data quality checks on ${args.table_name || '[TABLE]'}:

Checks to perform: ${args.checks || 'nulls, duplicates, ranges'}

1. Check for null values in each column
2. Identify duplicate rows
3. Validate data ranges and types
4. Check referential integrity if foreign keys exist
5. Generate data quality report with recommendations`,
              },
            },
          ],
        },
      }

      const prompt = prompts[promptName]
      if (!prompt) {
        throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${promptName}`)
      }

      return prompt
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
   * Get native tool handlers for embedding in other MCP servers
   * This is the main API for using DuckDB MCP as a library
   */
  getNativeHandlers() {
    // Build context with space support
    const context = {
      duckdb: this.duckdb,
      spaceId: this.currentSpace?.getId(),
      applySpaceContext: this.currentSpace
        ? (sql: string) => this.currentSpace!.applyToQuery(sql)
        : undefined,
    }

    // Return handlers bound to this context
    return Object.fromEntries(
      Object.entries(nativeToolHandlers).map(([name, handler]) => [
        name,
        (args: any) => handler(args, context),
      ])
    )
  }

  /**
   * Get native tool definitions for MCP registration
   */
  getNativeToolDefinitions() {
    return nativeToolDefinitions
  }

  /**
   * Switch to a different space context (hidden feature)
   * @internal
   */
  async switchSpace(spaceId: string, config?: any) {
    if (!this.spaceFactory) {
      this.spaceFactory = new SpaceContextFactory(this.duckdb)
    }

    this.currentSpace = await this.spaceFactory.getOrCreate(spaceId, config)
    return this.currentSpace
  }

  /**
   * Get the DuckDB service instance
   */
  getDuckDBService() {
    return this.duckdb
  }

  /**
   * Get the MCP client instance
   */
  getMCPClient() {
    return this.mcpClient
  }

  /**
   * Start the MCP server
   */
  async start() {
    // Initialize DuckDB with a timeout
    const initPromise = this.duckdb.initialize()
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('DuckDB initialization timeout')), 5000)
    )

    try {
      await Promise.race([initPromise, timeoutPromise])
      // DuckDB initialized successfully

      // Start metrics collection
      const metricsCollector = getMetricsCollector()
      await metricsCollector.start()
    } catch (error) {
      logger.error('Failed to initialize DuckDB:', error)
      throw error
    }

    // Only start stdio transport if not in embedded mode
    if (!this.embeddedMode) {
      const transport = new StdioServerTransport()
      await this.server.connect(transport)
      // DuckDB MCP Server started successfully
    }
  }
}

// Start the server if run directly
// Auto-start when this is the main module being executed
// Works with: node, tsx, ts-node, MCP Inspector
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` || // Direct execution
  process.argv[1]?.includes('mcp-server') || // Script name match
  process.argv.includes('--stdio') // CLI flag

if (isMainModule) {
  const server = new DuckDBMCPServer()
  server.start().catch((error) => {
    logger.error('Failed to start server:', error)
    process.exit(1)
  })
}

export { DuckDBMCPServer }
