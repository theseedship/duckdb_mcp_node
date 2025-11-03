/**
 * Data helper tools for DuckDB MCP
 * Provides utilities for data profiling, sampling, and format conversion
 */

import { DuckDBService } from '../duckdb/service.js'
import { z } from 'zod'
import { escapeString, escapeIdentifier } from '../utils/sql-escape.js'
import { logger } from '../utils/logger.js'
import * as path from 'path'
import * as fs from 'fs'

/**
 * Type definitions for DuckDB query results
 */
interface CountResult {
  count: number
}

interface SchemaColumnInfo {
  column_name: string
  column_type: string
  null: string
  key: string | null
  default: string | null
  extra: string | null
}

interface ColumnStatsResult {
  null_count: number
  distinct_count: number
  min_val: string | number | null
  max_val: string | number | null
  avg_val: number | null
}

type MinMaxValue = string | number | null

interface ColumnStats {
  name: string
  type: string
  null_count: number
  distinct_count: number
  min?: MinMaxValue
  max?: MinMaxValue
  avg?: number
}

type ParquetRecord = Record<string, unknown>

/**
 * Schema for json_to_parquet arguments
 */
export const JsonToParquetArgsSchema = z.object({
  json_data: z.union([z.array(z.any()), z.string().min(1)]).optional(),
  json_url: z.string().min(1).optional(),
  output_path: z.string().min(1),
  table_name: z.string().min(1).optional(),
})

/**
 * Schema for profile_parquet arguments
 */
export const ProfileParquetArgsSchema = z.object({
  url: z.string().min(1),
  columns: z.array(z.string()).optional(),
  sample_size: z.number().int().min(1).max(10000).default(1000),
})

/**
 * Schema for sample_parquet arguments
 */
export const SampleParquetArgsSchema = z.object({
  url: z.string().min(1),
  method: z.enum(['random', 'systematic', 'first']).default('random'),
  n: z.number().int().min(1).max(100000).default(1000),
  seed: z.number().int().optional(),
})

/**
 * Load JSON data into a temporary table
 */
async function loadJsonData(
  duckdb: DuckDBService,
  tempTable: string,
  json_data: unknown,
  json_url?: string
): Promise<void> {
  if (json_url) {
    logger.info(`Loading JSON from URL: ${json_url}`)
    await duckdb.executeQuery(`
      CREATE OR REPLACE TABLE ${escapeIdentifier(tempTable)} AS
      SELECT * FROM read_json_auto(${escapeString(json_url)})
    `)
  } else if (json_data) {
    if (typeof json_data === 'string') {
      await duckdb.executeQuery(`
        CREATE OR REPLACE TABLE ${escapeIdentifier(tempTable)} AS
        SELECT * FROM read_json_auto(${escapeString(json_data)})
      `)
    } else if (Array.isArray(json_data)) {
      await duckdb.createTableFromJSON(tempTable, json_data)
    } else {
      throw new Error('json_data must be an array or URL string')
    }
  } else {
    throw new Error('Either json_data or json_url must be provided')
  }
}

/**
 * Convert JSON data to Parquet format
 * Supports both inline JSON arrays and URLs to JSON files
 */
export async function handleJsonToParquet(
  args: unknown,
  duckdb: DuckDBService
): Promise<{
  success: boolean
  output_path?: string
  row_count?: number
  file_size?: number
  error?: string
}> {
  try {
    const validatedArgs = JsonToParquetArgsSchema.parse(args)
    const { json_data, json_url, output_path, table_name } = validatedArgs

    const outputDir = path.dirname(output_path)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const tempTable = table_name || `temp_json_${Date.now()}`

    try {
      await loadJsonData(duckdb, tempTable, json_data, json_url)

      await duckdb.executeQuery(`
        COPY ${escapeIdentifier(tempTable)} TO ${escapeString(output_path)} (FORMAT PARQUET, COMPRESSION ZSTD)
      `)

      const stats = await duckdb.executeQuery(`
        SELECT COUNT(*) as row_count FROM ${escapeIdentifier(tempTable)}
      `)

      const fileSize = fs.existsSync(output_path) ? fs.statSync(output_path).size : 0

      if (!table_name) {
        await duckdb.executeQuery(`DROP TABLE IF EXISTS ${escapeIdentifier(tempTable)}`)
      }

      return {
        success: true,
        output_path,
        row_count: Number(stats[0].row_count),
        file_size: fileSize,
      }
    } catch (error) {
      if (!table_name) {
        try {
          await duckdb.executeQuery(`DROP TABLE IF EXISTS ${escapeIdentifier(tempTable)}`)
        } catch {
          // Ignore cleanup errors
        }
      }
      throw error
    }
  } catch (error) {
    logger.error('json_to_parquet failed', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Profile a parquet file - get statistics and samples
 */
export async function handleProfileParquet(
  args: unknown,
  duckdb: DuckDBService
): Promise<{
  success: boolean
  url?: string
  row_count?: number
  column_count?: number
  columns?: ColumnStats[]
  sample?: ParquetRecord[]
  error?: string
}> {
  try {
    const validatedArgs = ProfileParquetArgsSchema.parse(args)
    const { url, columns: selectedColumns, sample_size } = validatedArgs

    logger.info(`Profiling parquet file: ${url}`)

    // Get row count
    const countQuery = `SELECT COUNT(*) as count FROM read_parquet(${escapeString(url)})`
    const countResult = await duckdb.executeQuery<CountResult>(countQuery)
    const rowCount = Number(countResult[0].count)

    // Get schema information
    const schemaQuery = `DESCRIBE SELECT * FROM read_parquet(${escapeString(url)}) LIMIT 1`
    const schemaResult = await duckdb.executeQuery<SchemaColumnInfo>(schemaQuery)

    const columnsToProfile = selectedColumns || schemaResult.map((col) => col.column_name)

    // Profile each column
    const columnStats: ColumnStats[] = []
    for (const colName of columnsToProfile) {
      const colInfo = schemaResult.find((c) => c.column_name === colName)
      if (!colInfo) continue

      const escapedCol = escapeIdentifier(colName)
      const isNumeric = ['INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL'].some((t) =>
        colInfo.column_type.toUpperCase().includes(t)
      )

      let statsQuery = `
        SELECT
          COUNT(*) - COUNT(${escapedCol}) as null_count,
          COUNT(DISTINCT ${escapedCol}) as distinct_count
      `

      if (isNumeric) {
        statsQuery += `,
          MIN(${escapedCol}) as min_val,
          MAX(${escapedCol}) as max_val,
          AVG(${escapedCol}) as avg_val
        `
      } else {
        statsQuery += `,
          MIN(${escapedCol}) as min_val,
          MAX(${escapedCol}) as max_val,
          NULL as avg_val
        `
      }

      statsQuery += `FROM read_parquet(${escapeString(url)})`

      const statsResult = await duckdb.executeQuery<ColumnStatsResult>(statsQuery)
      const stats = statsResult[0]

      columnStats.push({
        name: colName,
        type: colInfo.column_type,
        null_count: Number(stats.null_count),
        distinct_count: Number(stats.distinct_count),
        min: stats.min_val,
        max: stats.max_val,
        avg: stats.avg_val ? Number(stats.avg_val) : undefined,
      })
    }

    // Get sample data
    const sampleQuery = `
      SELECT * FROM read_parquet(${escapeString(url)})
      USING SAMPLE ${sample_size} ROWS
    `
    const sampleResult = await duckdb.executeQuery<ParquetRecord>(sampleQuery)

    return {
      success: true,
      url,
      row_count: rowCount,
      column_count: schemaResult.length,
      columns: columnStats,
      sample: sampleResult,
    }
  } catch (error) {
    logger.error('profile_parquet failed', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Sample data from a parquet file
 */
export async function handleSampleParquet(
  args: unknown,
  duckdb: DuckDBService
): Promise<{
  success: boolean
  url?: string
  method?: string
  requested_rows?: number
  actual_rows?: number
  data?: ParquetRecord[]
  error?: string
}> {
  try {
    const validatedArgs = SampleParquetArgsSchema.parse(args)
    const { url, method, n, seed } = validatedArgs

    logger.info(`Sampling parquet file: ${url} (method: ${method}, n: ${n})`)

    let sampleQuery: string

    switch (method) {
      case 'random':
        sampleQuery = seed
          ? `SELECT * FROM read_parquet(${escapeString(url)}) USING SAMPLE ${n} ROWS (seed ${seed})`
          : `SELECT * FROM read_parquet(${escapeString(url)}) USING SAMPLE ${n} ROWS`
        break

      case 'systematic':
        // Systematic sampling: get every Nth row
        sampleQuery = `
          WITH total AS (
            SELECT COUNT(*) as cnt FROM read_parquet(${escapeString(url)})
          ),
          step_size AS (
            SELECT CAST(GREATEST(cnt / ${n}, 1) AS INTEGER) as step FROM total
          )
          SELECT t.* FROM (
            SELECT *, ROW_NUMBER() OVER () as rn
            FROM read_parquet(${escapeString(url)})
          ) t
          CROSS JOIN step_size
          WHERE t.rn % step = 0
          LIMIT ${n}
        `
        break

      case 'first':
        sampleQuery = `SELECT * FROM read_parquet(${escapeString(url)}) LIMIT ${n}`
        break

      default:
        throw new Error(`Invalid sampling method: ${method}`)
    }

    const result = await duckdb.executeQuery(sampleQuery)

    return {
      success: true,
      url,
      method,
      requested_rows: n,
      actual_rows: result.length,
      data: result,
    }
  } catch (error) {
    logger.error('sample_parquet failed', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Tool definitions for MCP server registration
 */
export const dataHelperToolDefinitions = [
  {
    name: 'json_to_parquet',
    description: 'Convert JSON data to Parquet format with compression',
    inputSchema: {
      type: 'object',
      properties: {
        json_data: {
          type: ['array', 'string'],
          description: 'Inline JSON array or URL to JSON file',
        },
        json_url: {
          type: 'string',
          description: 'URL to JSON file (alternative to json_data)',
        },
        output_path: {
          type: 'string',
          description: 'Output path for parquet file',
        },
        table_name: {
          type: 'string',
          description: 'Optional temporary table name (will be cleaned up)',
        },
      },
      required: ['output_path'],
    },
  },
  {
    name: 'profile_parquet',
    description:
      'Profile a parquet file - get row count, column stats (min/max/avg/nulls/distinct), and sample data',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL or path to parquet file',
        },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of columns to profile (defaults to all)',
        },
        sample_size: {
          type: 'number',
          description: 'Number of rows to return as sample (default: 1000, max: 10000)',
          default: 1000,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'sample_parquet',
    description: 'Sample data from a parquet file using various sampling methods',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL or path to parquet file',
        },
        method: {
          type: 'string',
          enum: ['random', 'systematic', 'first'],
          description:
            'Sampling method: random (uniform random), systematic (every Nth row), first (top N rows)',
          default: 'random',
        },
        n: {
          type: 'number',
          description: 'Number of rows to sample (default: 1000, max: 100000)',
          default: 1000,
        },
        seed: {
          type: 'number',
          description: 'Random seed for reproducible sampling (random method only)',
        },
      },
      required: ['url'],
    },
  },
]

/**
 * Export handlers map for easy integration
 */
export const dataHelperToolHandlers = {
  json_to_parquet: handleJsonToParquet,
  profile_parquet: handleProfileParquet,
  sample_parquet: handleSampleParquet,
}
