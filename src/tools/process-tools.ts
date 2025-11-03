/**
 * Process mining tools for DuckDB MCP
 * Implements process.describe, process.similar, and process.compose
 */

import { DuckDBService } from '../duckdb/service.js'
import {
  ProcessDescribeArgsSchema,
  ProcessSimilarArgsSchema,
  ProcessComposeArgsSchema,
  ProcessSummarySchema,
  ProcessStepSchema,
  ProcessEdgeSchema,
} from '../types/process-schemas.js'
import {
  ProcessDescribeResult,
  ProcessSimilarResult,
  ProcessComposeResult,
  ProcessStep,
  ProcessSummary,
} from '../types/process-types.js'
import {
  buildProcessDescribeQuery,
  buildProcessSimilarQuery,
  buildProcessStepsQuery,
  buildProcessEdgesQuery,
  buildParquetGlobPattern,
} from './process-queries.js'
import { logger } from '../utils/logger.js'

/**
 * Get parquet URL from environment or arguments
 */
function getParquetUrl(envVar: string, providedUrl?: string): string {
  const url = providedUrl || process.env[envVar]

  if (!url) {
    throw new Error(
      `Parquet URL not configured. Set ${envVar} environment variable or provide parquet_url argument`
    )
  }

  return url
}

/**
 * Process.describe tool handler
 * Returns top-N processes ordered by confidence score
 */
export async function handleProcessDescribe(
  args: unknown,
  duckdb: DuckDBService
): Promise<ProcessDescribeResult> {
  try {
    // Validate arguments
    const validatedArgs = ProcessDescribeArgsSchema.parse(args)
    const { topN, parquet_url } = validatedArgs

    // Get parquet URL
    const parquetUrl = getParquetUrl('PROCESS_SUMMARY_URL', parquet_url)

    // Support glob patterns for multi-document files
    const finalUrl = parquetUrl.includes('{') ? buildParquetGlobPattern(parquetUrl) : parquetUrl

    // Build and execute query
    const sql = buildProcessDescribeQuery(finalUrl, topN)
    logger.debug('Executing process.describe query', { sql, topN })

    const results = await duckdb.executeQueryWithVFS(sql)

    // Validate results
    const processes = results.map((row) => ProcessSummarySchema.parse(row))

    return {
      success: true,
      processes,
      count: processes.length,
    }
  } catch (error) {
    logger.error('process.describe failed', error)
    throw error
  }
}

/**
 * Process.similar tool handler
 * Finds similar processes using vector similarity search
 */
export async function handleProcessSimilar(
  args: unknown,
  duckdb: DuckDBService
): Promise<ProcessSimilarResult> {
  try {
    // Validate arguments
    const validatedArgs = ProcessSimilarArgsSchema.parse(args)
    const { signature_emb, k, parquet_url } = validatedArgs

    // Get parquet URL
    const parquetUrl = getParquetUrl('PROCESS_SIGNATURE_URL', parquet_url)

    // Support glob patterns
    const finalUrl = parquetUrl.includes('{') ? buildParquetGlobPattern(parquetUrl) : parquetUrl

    // Build and execute similarity query
    const sql = buildProcessSimilarQuery(finalUrl, signature_emb, k)
    logger.debug('Executing process.similar query', { embeddingDim: signature_emb.length, k })

    const results = await duckdb.executeQueryWithVFS(sql)

    // Format results
    interface SimilarityResult {
      doc_id: string
      process_id: string
      distance: number
      summary?: ProcessSummary
    }

    const matches: SimilarityResult[] = results.map((row: Record<string, unknown>) => ({
      doc_id: row.doc_id as string,
      process_id: row.process_id as string,
      distance: row.distance as number,
    }))

    // Optionally fetch full summaries
    if (matches.length > 0) {
      const summaryUrl = getParquetUrl('PROCESS_SUMMARY_URL', parquet_url)
      const summaryFinalUrl = summaryUrl.includes('{')
        ? buildParquetGlobPattern(summaryUrl)
        : summaryUrl

      const docIds = matches.map((m) => m.doc_id)
      const summaryQuery = `
        SELECT * FROM read_parquet('${summaryFinalUrl}')
        WHERE doc_id IN (${docIds.map((id) => `'${id}'`).join(', ')})
      `

      try {
        const summaries = await duckdb.executeQueryWithVFS(summaryQuery)
        const summaryMap = new Map(
          summaries.map((s: Record<string, unknown>) => [s.doc_id, s as unknown as ProcessSummary])
        )

        matches.forEach((match) => {
          match.summary = summaryMap.get(match.doc_id)
        })
      } catch (summaryError) {
        logger.warn('Failed to fetch process summaries', summaryError)
        // Continue without summaries
      }
    }

    return {
      success: true,
      matches,
      count: matches.length,
    }
  } catch (error) {
    logger.error('process.similar failed', error)
    throw error
  }
}

/**
 * Process.compose tool handler
 * Merges steps from multiple processes into a unified action plan
 */
export async function handleProcessCompose(
  args: unknown,
  duckdb: DuckDBService
): Promise<ProcessComposeResult> {
  try {
    // Validate arguments
    const validatedArgs = ProcessComposeArgsSchema.parse(args)
    const { doc_ids, steps_url, edges_url } = validatedArgs

    // Get parquet URLs
    const stepsParquetUrl = getParquetUrl('PROCESS_STEPS_URL', steps_url)
    const edgesParquetUrl = getParquetUrl('PROCESS_EDGES_URL', edges_url)

    // Support glob patterns
    const stepsUrl = stepsParquetUrl.includes('{')
      ? buildParquetGlobPattern(stepsParquetUrl)
      : stepsParquetUrl
    const edgesUrlFinal = edgesParquetUrl.includes('{')
      ? buildParquetGlobPattern(edgesParquetUrl)
      : edgesParquetUrl

    // Load steps
    const stepsQuery = buildProcessStepsQuery(stepsUrl, doc_ids)
    logger.debug('Loading process steps', { doc_ids, stepsQuery })

    const stepsResults = await duckdb.executeQueryWithVFS(stepsQuery)
    const steps = stepsResults.map((row) => ProcessStepSchema.parse(row))

    // Load edges
    const edgesQuery = buildProcessEdgesQuery(edgesUrlFinal, doc_ids)
    logger.debug('Loading process edges', { doc_ids, edgesQuery })

    const edgesResults = await duckdb.executeQueryWithVFS(edgesQuery)
    const edges = edgesResults.map((row) => ProcessEdgeSchema.parse(row))

    // Deduplicate steps by step_key (keep first occurrence)
    const mergedSteps = deduplicateSteps(steps)

    // Reorder by global order
    mergedSteps.sort((a, b) => a.order - b.order)

    logger.info('Process composition complete', {
      source_docs: doc_ids.length,
      total_steps: steps.length,
      merged_steps: mergedSteps.length,
      edges: edges.length,
    })

    return {
      success: true,
      steps: mergedSteps,
      edges,
      merged_count: steps.length - mergedSteps.length,
      source_docs: doc_ids,
    }
  } catch (error) {
    logger.error('process.compose failed', error)
    throw error
  }
}

/**
 * Deduplicate process steps by step_key
 * Strategy: Keep first occurrence, normalize step_key to lowercase
 */
function deduplicateSteps(steps: ProcessStep[]): ProcessStep[] {
  const seen = new Set<string>()
  const result: ProcessStep[] = []

  for (const step of steps) {
    const normalizedKey = step.step_key.toLowerCase().trim()

    if (!seen.has(normalizedKey)) {
      seen.add(normalizedKey)
      result.push(step)
    }
  }

  return result
}

/**
 * Tool definitions for MCP server registration
 */
export const processToolDefinitions = [
  {
    name: 'process.describe',
    description: 'Describe top-N processes ordered by confidence score',
    inputSchema: {
      type: 'object',
      properties: {
        topN: {
          type: 'number',
          description: 'Number of top processes to return (default: 5, max: 100)',
          default: 5,
        },
        parquet_url: {
          type: 'string',
          description:
            'Optional parquet URL (defaults to PROCESS_SUMMARY_URL env var). Supports {doc_uuid} placeholder.',
        },
      },
    },
  },
  {
    name: 'process.similar',
    description: 'Find similar processes using embedding-based vector similarity',
    inputSchema: {
      type: 'object',
      properties: {
        signature_emb: {
          type: 'array',
          items: { type: 'number' },
          description: 'Process signature embedding vector (FLOAT array)',
        },
        k: {
          type: 'number',
          description: 'Number of similar processes to return (default: 5, max: 100)',
          default: 5,
        },
        parquet_url: {
          type: 'string',
          description:
            'Optional parquet URL (defaults to PROCESS_SIGNATURE_URL env var). Supports {doc_uuid} placeholder.',
        },
      },
      required: ['signature_emb'],
    },
  },
  {
    name: 'process.compose',
    description: 'Compose a unified action plan by merging steps from multiple processes',
    inputSchema: {
      type: 'object',
      properties: {
        doc_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of document IDs to merge',
        },
        steps_url: {
          type: 'string',
          description: 'Optional parquet URL for steps (defaults to PROCESS_STEPS_URL env var)',
        },
        edges_url: {
          type: 'string',
          description: 'Optional parquet URL for edges (defaults to PROCESS_EDGES_URL env var)',
        },
      },
      required: ['doc_ids'],
    },
  },
]

/**
 * Export handlers map for easy integration
 */
export const processToolHandlers = {
  'process.describe': handleProcessDescribe,
  'process.similar': handleProcessSimilar,
  'process.compose': handleProcessCompose,
}
