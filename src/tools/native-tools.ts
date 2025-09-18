/**
 * Native DuckDB MCP tools - Exported for embedding in other MCP servers
 * @public
 */
import { DuckDBService, getDuckDBService } from '../duckdb/service.js'
import { z } from 'zod'
import { escapeIdentifier, escapeString } from '../utils/sql-escape.js'

// Export schemas for external validation
export const nativeToolSchemas = {
  query_duckdb: z.object({
    sql: z.string().describe('SQL query to execute'),
    limit: z.number().optional().default(1000).describe('Maximum number of results'),
    space_id: z.string().optional().describe('Optional space identifier for multi-tenant queries'),
  }),

  list_tables: z.object({
    schema: z.string().optional().default('main').describe('Schema to list tables from'),
    space_id: z.string().optional().describe('Optional space identifier'),
  }),

  describe_table: z.object({
    table_name: z.string().describe('Name of the table to describe'),
    schema: z.string().optional().default('main').describe('Schema containing the table'),
    space_id: z.string().optional().describe('Optional space identifier'),
  }),

  load_csv: z.object({
    path: z.string().describe('Path to the CSV file'),
    table_name: z.string().describe('Name for the new table'),
    options: z
      .object({
        header: z.boolean().optional().describe('Whether CSV has header row'),
        delimiter: z.string().optional().describe('Column delimiter'),
        quote: z.string().optional().describe('Quote character'),
      })
      .optional()
      .describe('CSV parsing options'),
    space_id: z.string().optional().describe('Optional space identifier'),
  }),

  load_parquet: z.object({
    path: z.string().describe('Path to the Parquet file'),
    table_name: z.string().describe('Name for the new table'),
    space_id: z.string().optional().describe('Optional space identifier'),
  }),

  export_data: z.object({
    query: z.string().describe('SQL query to export results from'),
    path: z.string().describe('Output file path'),
    format: z.enum(['csv', 'parquet', 'json']).optional().default('csv').describe('Export format'),
    space_id: z.string().optional().describe('Optional space identifier'),
  }),
}

// Context interface for space-aware execution (hidden feature)
interface ExecutionContext {
  duckdb?: DuckDBService
  spaceId?: string
  applySpaceContext?: (sql: string) => string
  metadata?: Record<string, any>
}

// Exportable handlers for embedding
export const nativeToolHandlers = {
  /**
   * Execute SQL query on DuckDB
   */
  query_duckdb: async (args: any, context?: ExecutionContext) => {
    const service = context?.duckdb || (await getDuckDBService())
    const validated = nativeToolSchemas.query_duckdb.parse(args)

    // Apply space context if provided (hidden feature)
    let sql = validated.sql
    if (context?.spaceId && context?.applySpaceContext) {
      sql = context.applySpaceContext(sql)
    }

    // Add limit if not present in SELECT query
    const isSelectQuery = sql.trim().toUpperCase().startsWith('SELECT')
    const hasLimit = sql.match(/LIMIT\s+\d+/i)
    const safeSql = isSelectQuery && !hasLimit ? `${sql} LIMIT ${validated.limit}` : sql

    try {
      const startTime = Date.now()
      const results = await service.executeQuery(safeSql)
      const executionTime = Date.now() - startTime

      return {
        success: true,
        rowCount: results.length,
        executionTime,
        data: results,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Query execution failed',
      }
    }
  },

  /**
   * List all tables in a schema
   */
  list_tables: async (args: any, context?: ExecutionContext) => {
    const service = context?.duckdb || (await getDuckDBService())
    const validated = nativeToolSchemas.list_tables.parse(args)

    // Space-aware schema (hidden feature)
    const schema = context?.spaceId ? `space_${context.spaceId}` : validated.schema

    try {
      const result = await service.executeQuery(`
        SELECT table_name, table_type 
        FROM information_schema.tables 
        WHERE table_schema = '${escapeString(schema)}'
        ORDER BY table_name
      `)

      return {
        success: true,
        schema,
        tables: result,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list tables',
      }
    }
  },

  /**
   * Describe table structure
   */
  describe_table: async (args: any, context?: ExecutionContext) => {
    const service = context?.duckdb || (await getDuckDBService())
    const validated = nativeToolSchemas.describe_table.parse(args)

    // Space-aware schema (hidden feature)
    const schema = context?.spaceId ? `space_${context.spaceId}` : validated.schema

    try {
      const result = await service.executeQuery(`
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns 
        WHERE table_schema = '${escapeString(schema)}' 
          AND table_name = '${escapeString(validated.table_name)}'
        ORDER BY ordinal_position
      `)

      return {
        success: true,
        table: validated.table_name,
        schema,
        columns: result,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to describe table',
      }
    }
  },

  /**
   * Load CSV file into DuckDB table
   */
  load_csv: async (args: any, context?: ExecutionContext) => {
    const service = context?.duckdb || (await getDuckDBService())
    const validated = nativeToolSchemas.load_csv.parse(args)

    // Space-aware table name (hidden feature)
    let tableName = validated.table_name
    if (context?.spaceId) {
      // Create space schema if needed
      await service.executeQuery(`CREATE SCHEMA IF NOT EXISTS space_${context.spaceId}`)
      tableName = `space_${context.spaceId}.${tableName}`
    }

    try {
      // Build CSV options string
      const optionsParts = []
      if (validated.options?.header !== undefined) {
        optionsParts.push(`header = ${validated.options.header}`)
      }
      if (validated.options?.delimiter) {
        optionsParts.push(`delim = '${escapeString(validated.options.delimiter)}'`)
      }
      if (validated.options?.quote) {
        optionsParts.push(`quote = '${escapeString(validated.options.quote)}'`)
      }

      const optionsStr = optionsParts.length > 0 ? `, ${optionsParts.join(', ')}` : ''

      // Create table from CSV
      await service.executeQuery(`
        CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} AS 
        SELECT * FROM read_csv('${escapeString(validated.path)}'${optionsStr})
      `)

      // Get row count
      const countResult = await service.executeQuery(
        `SELECT COUNT(*) as count FROM ${escapeIdentifier(tableName)}`
      )

      return {
        success: true,
        message: `Loaded CSV into table '${tableName}'`,
        rowCount: countResult[0]?.count || 0,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load CSV',
      }
    }
  },

  /**
   * Load Parquet file into DuckDB table
   */
  load_parquet: async (args: any, context?: ExecutionContext) => {
    const service = context?.duckdb || (await getDuckDBService())
    const validated = nativeToolSchemas.load_parquet.parse(args)

    // Space-aware table name (hidden feature)
    let tableName = validated.table_name
    if (context?.spaceId) {
      // Create space schema if needed
      await service.executeQuery(`CREATE SCHEMA IF NOT EXISTS space_${context.spaceId}`)
      tableName = `space_${context.spaceId}.${tableName}`
    }

    try {
      // Create table from Parquet
      await service.executeQuery(`
        CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} AS 
        SELECT * FROM read_parquet('${escapeString(validated.path)}')
      `)

      // Get row count
      const countResult = await service.executeQuery(
        `SELECT COUNT(*) as count FROM ${escapeIdentifier(tableName)}`
      )

      return {
        success: true,
        message: `Loaded Parquet into table '${tableName}'`,
        rowCount: countResult[0]?.count || 0,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load Parquet',
      }
    }
  },

  /**
   * Export query results to file
   */
  export_data: async (args: any, context?: ExecutionContext) => {
    const service = context?.duckdb || (await getDuckDBService())
    const validated = nativeToolSchemas.export_data.parse(args)

    // Apply space context to query if provided (hidden feature)
    let query = validated.query
    if (context?.spaceId && context?.applySpaceContext) {
      query = context.applySpaceContext(query)
    }

    try {
      let exportQuery = ''
      switch (validated.format) {
        case 'csv':
          exportQuery = `COPY (${query}) TO '${escapeString(validated.path)}' WITH (FORMAT CSV, HEADER)`
          break
        case 'parquet':
          exportQuery = `COPY (${query}) TO '${escapeString(validated.path)}' (FORMAT PARQUET)`
          break
        case 'json':
          exportQuery = `COPY (${query}) TO '${escapeString(validated.path)}' (FORMAT JSON)`
          break
      }

      await service.executeQuery(exportQuery)

      return {
        success: true,
        message: `Exported data to ${validated.path} in ${validated.format} format`,
        path: validated.path,
        format: validated.format,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export data',
      }
    }
  },
}

// Export tool definitions for MCP registration
export const nativeToolDefinitions = [
  {
    name: 'query_duckdb',
    description: 'Execute SQL queries on DuckDB',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL query to execute' },
        limit: { type: 'number', description: 'Maximum number of results', default: 1000 },
      },
      required: ['sql'],
    },
  },
  {
    name: 'list_tables',
    description: 'List all tables in a schema',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'string', description: 'Schema to list tables from', default: 'main' },
      },
    },
  },
  {
    name: 'describe_table',
    description: 'Get the structure of a table',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string', description: 'Name of the table' },
        schema: { type: 'string', description: 'Schema containing the table', default: 'main' },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'load_csv',
    description: 'Load a CSV file into a DuckDB table',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the CSV file' },
        table_name: { type: 'string', description: 'Name for the new table' },
        options: {
          type: 'object',
          properties: {
            header: { type: 'boolean', description: 'Whether CSV has header row' },
            delimiter: { type: 'string', description: 'Column delimiter' },
            quote: { type: 'string', description: 'Quote character' },
          },
        },
      },
      required: ['path', 'table_name'],
    },
  },
  {
    name: 'load_parquet',
    description: 'Load a Parquet file into a DuckDB table',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the Parquet file' },
        table_name: { type: 'string', description: 'Name for the new table' },
      },
      required: ['path', 'table_name'],
    },
  },
  {
    name: 'export_data',
    description: 'Export query results to a file',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query to export results from' },
        path: { type: 'string', description: 'Output file path' },
        format: {
          type: 'string',
          enum: ['csv', 'parquet', 'json'],
          description: 'Export format',
          default: 'csv',
        },
      },
      required: ['query', 'path'],
    },
  },
]

// Type exports for TypeScript users
export type QueryDuckDBInput = z.infer<typeof nativeToolSchemas.query_duckdb>
export type ListTablesInput = z.infer<typeof nativeToolSchemas.list_tables>
export type DescribeTableInput = z.infer<typeof nativeToolSchemas.describe_table>
export type LoadCSVInput = z.infer<typeof nativeToolSchemas.load_csv>
export type LoadParquetInput = z.infer<typeof nativeToolSchemas.load_parquet>
export type ExportDataInput = z.infer<typeof nativeToolSchemas.export_data>
