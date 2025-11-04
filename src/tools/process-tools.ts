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
  ProcessEdge,
  QAReport,
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
 * Expected embedding dimension for process mining (FLOAT[384])
 */
const EXPECTED_EMBEDDING_DIM = 384

/**
 * Calculate L2 (Euclidean) distance between two vectors
 * Fallback for when DuckDB VSS is unavailable
 */
function l2Distance(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error(`Vector dimension mismatch: ${vec1.length} vs ${vec2.length}`)
  }

  let sum = 0
  for (let i = 0; i < vec1.length; i++) {
    const diff = vec1[i] - vec2[i]
    sum += diff * diff
  }

  return Math.sqrt(sum)
}

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

    // P2.8.1: Validate embedding dimension
    if (signature_emb.length !== EXPECTED_EMBEDDING_DIM) {
      throw new Error(
        `Invalid embedding dimension: expected ${EXPECTED_EMBEDDING_DIM}, got ${signature_emb.length}. ` +
          `Process mining requires FLOAT[${EXPECTED_EMBEDDING_DIM}] embeddings. ` +
          `Please re-embed with a ${EXPECTED_EMBEDDING_DIM}-dimensional model.`
      )
    }

    // Get parquet URL
    const parquetUrl = getParquetUrl('PROCESS_SIGNATURE_URL', parquet_url)

    // Support glob patterns
    const finalUrl = parquetUrl.includes('{') ? buildParquetGlobPattern(parquetUrl) : parquetUrl

    // P2.8.2: Try DuckDB VSS first, fallback to TypeScript L2 if unavailable
    let distanceSource: 'duckdb_vss' | 'typescript_l2' = 'duckdb_vss'
    let results: Record<string, unknown>[]

    try {
      // Build and execute similarity query with DuckDB VSS
      const sql = buildProcessSimilarQuery(finalUrl, signature_emb, k)
      logger.debug('Executing process.similar query with DuckDB VSS', {
        embeddingDim: signature_emb.length,
        k,
      })

      results = await duckdb.executeQueryWithVFS(sql)
    } catch (vssError) {
      // P2.8.2: Fallback to TypeScript L2 distance calculation
      logger.warn('DuckDB VSS unavailable, falling back to TypeScript L2 distance', vssError)
      distanceSource = 'typescript_l2'

      // Load all signatures from parquet
      const loadQuery = `SELECT * FROM read_parquet('${finalUrl}')`
      const allSignatures = await duckdb.executeQueryWithVFS(loadQuery)

      // Calculate L2 distances in TypeScript
      const distances = allSignatures.map((row: Record<string, unknown>) => ({
        ...row,
        distance: l2Distance(signature_emb, row.signature_emb as number[]),
      }))

      // Sort by distance and take top k
      distances.sort((a, b) => a.distance - b.distance)
      results = distances.slice(0, k)

      logger.info('TypeScript L2 fallback completed', {
        total_signatures: allSignatures.length,
        returned: results.length,
      })
    }

    // P2.8.3: Format results with distance_source transparency field
    interface SimilarityResult {
      doc_id: string
      process_id: string
      distance: number
      distance_source: 'duckdb_vss' | 'typescript_l2'
      summary?: ProcessSummary
    }

    const matches: SimilarityResult[] = results.map((row: Record<string, unknown>) => ({
      doc_id: row.doc_id as string,
      process_id: row.process_id as string,
      distance: row.distance as number,
      distance_source: distanceSource, // P2.8.3: Transparency field
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

    // P2.8.3: Log distance source for observability
    logger.info('process.similar completed', {
      matches: matches.length,
      distance_source: distanceSource,
    })

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
    let edges = edgesResults.map((row) => ProcessEdgeSchema.parse(row))

    // P2.9.1 & P2.9.2: Deduplicate steps with conflict resolution
    const { steps: mergedSteps, idMapping } = deduplicateSteps(steps)

    // Reorder by global order
    mergedSteps.sort((a, b) => a.order - b.order)

    // P2.9.3: Remap edges to use merged step IDs
    edges = remapEdges(edges, idMapping)

    // P2.9.4: Run QA checks
    const qaReport = runQAChecks(mergedSteps, edges)

    logger.info('Process composition complete', {
      source_docs: doc_ids.length,
      total_steps: steps.length,
      merged_steps: mergedSteps.length,
      edges: edges.length,
      conflicts_resolved: steps.length - mergedSteps.length,
      qa_warnings: qaReport.warnings.length,
    })

    return {
      success: true,
      steps: mergedSteps,
      edges,
      merged_count: steps.length - mergedSteps.length,
      source_docs: doc_ids,
      qa: qaReport, // P2.9.4: Include QA report
    }
  } catch (error) {
    logger.error('process.compose failed', error)
    throw error
  }
}

/**
 * P2.9.3: Remap edges after step deduplication
 * Maps old step_ids to merged step_ids
 */
function remapEdges(edges: ProcessEdge[], idMapping: Map<string, string>): ProcessEdge[] {
  return edges.map((edge) => ({
    ...edge,
    from_step_id: idMapping.get(edge.from_step_id) || edge.from_step_id,
    to_step_id: idMapping.get(edge.to_step_id) || edge.to_step_id,
  }))
}

/**
 * P2.9.4: QA checks for composed process
 * Detects orphans, cycles, and issues
 */
function runQAChecks(steps: ProcessStep[], edges: ProcessEdge[]): QAReport {
  const report: QAReport = {
    orphan_steps: [],
    cycles: [],
    duplicate_edges: [],
    warnings: [],
  }

  // Check for orphan steps (no incoming or outgoing edges)
  const connectedStepIds = new Set<string>()
  edges.forEach((e) => {
    connectedStepIds.add(e.from_step_id)
    connectedStepIds.add(e.to_step_id)
  })

  for (const step of steps) {
    if (!connectedStepIds.has(step.step_id) && steps.length > 1) {
      report.orphan_steps.push(step.step_key)
    }
  }

  // Check for duplicate edges
  const edgeSet = new Set<string>()
  for (const edge of edges) {
    const edgeKey = `${edge.from_step_id}->${edge.to_step_id}`
    if (edgeSet.has(edgeKey)) {
      report.duplicate_edges.push(edgeKey)
    } else {
      edgeSet.add(edgeKey)
    }
  }

  // Check for cycles (simplified: direct back-edges)
  const adjacency = new Map<string, Set<string>>()
  for (const edge of edges) {
    const from = edge.from_step_id
    const to = edge.to_step_id

    if (!adjacency.has(from)) {
      adjacency.set(from, new Set())
    }
    const fromSet = adjacency.get(from)
    if (fromSet) {
      fromSet.add(to)
    }

    // Check for direct cycle (A -> B and B -> A)
    const toSet = adjacency.get(to)
    if (toSet && toSet.has(from)) {
      report.cycles.push([from, to])
    }
  }

  // Add warnings
  if (report.orphan_steps.length > 0) {
    report.warnings.push(`${report.orphan_steps.length} orphan steps found (no edges)`)
  }
  if (report.duplicate_edges.length > 0) {
    report.warnings.push(`${report.duplicate_edges.length} duplicate edges found`)
  }
  if (report.cycles.length > 0) {
    report.warnings.push(`${report.cycles.length} cycles detected`)
  }

  return report
}

/**
 * P2.9: Enhanced step deduplication with conflict resolution
 * Strategy:
 * - Normalize step_key (trim + lowercase)
 * - Group duplicates by normalized key
 * - Resolve conflicts using median order
 * - Track merged_from sources
 *
 * @returns {steps, idMapping} - Deduplicated steps and old_step_id->new_step_id mapping
 */
function deduplicateSteps(steps: ProcessStep[]): {
  steps: ProcessStep[]
  idMapping: Map<string, string>
} {
  // P2.9.1: Group steps by normalized key
  const groupedSteps = new Map<string, ProcessStep[]>()
  const idMapping = new Map<string, string>() // old step_id -> merged step_id

  for (const step of steps) {
    const normalizedKey = step.step_key.toLowerCase().trim()

    if (!groupedSteps.has(normalizedKey)) {
      groupedSteps.set(normalizedKey, [])
    }
    const group = groupedSteps.get(normalizedKey)
    if (group) {
      group.push(step)
    }
  }

  // P2.9.2: Resolve conflicts using median order
  const result: ProcessStep[] = []

  for (const [normalizedKey, duplicates] of groupedSteps.entries()) {
    let mergedStep: ProcessStep

    if (duplicates.length === 1) {
      // No conflict, use as-is
      mergedStep = { ...duplicates[0], step_key: normalizedKey }
    } else {
      // Conflict: use median order
      const orders = duplicates.map((s) => s.order).sort((a, b) => a - b)
      const medianOrder = orders[Math.floor(orders.length / 2)]

      // Find step with order closest to median
      const selectedStep = duplicates.reduce((closest, current) => {
        const closestDiff = Math.abs(closest.order - medianOrder)
        const currentDiff = Math.abs(current.order - medianOrder)
        return currentDiff < closestDiff ? current : closest
      })

      // Use median order and track sources
      mergedStep = {
        ...selectedStep,
        order: medianOrder,
        step_key: normalizedKey, // Use normalized key
      }

      logger.debug('Resolved step conflict', {
        normalized_key: normalizedKey,
        duplicates: duplicates.length,
        orders: orders,
        median_order: medianOrder,
        selected_doc: selectedStep.doc_id,
      })
    }

    result.push(mergedStep)

    // Map all duplicate step_ids to the merged step's step_id
    for (const duplicate of duplicates) {
      idMapping.set(duplicate.step_id, mergedStep.step_id)
    }
  }

  return { steps: result, idMapping }
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
