/**
 * SQL query builders for process mining tools
 * All queries use safe parameter substitution to prevent SQL injection
 */

import { escapeString } from '../utils/sql-escape.js'

/**
 * Build SQL query for process.describe tool
 * Returns top-N processes ordered by confidence
 */
export function buildProcessDescribeQuery(parquetUrl: string, topN: number): string {
  return `
    SELECT
      doc_id,
      process_id,
      type,
      one_liner,
      steps_count,
      confidence,
      mermaid
    FROM read_parquet(${escapeString(parquetUrl)})
    ORDER BY confidence DESC
    LIMIT ${Math.min(topN, 100)}
  `
}

/**
 * Build SQL query for process.similar tool
 * Finds similar processes using vector distance
 *
 * Note: DuckDB's list_distance function computes L2 (Euclidean) distance
 * Other options: array_cosine_similarity, array_inner_product
 */
export function buildProcessSimilarQuery(
  parquetUrl: string,
  embeddingVector: number[],
  k: number
): string {
  // Convert embedding array to DuckDB list literal
  const vectorLiteral = `[${embeddingVector.join(', ')}]`

  return `
    SELECT
      doc_id,
      process_id,
      list_distance(signature_emb, ${vectorLiteral}) AS distance
    FROM read_parquet(${escapeString(parquetUrl)})
    ORDER BY distance ASC
    LIMIT ${Math.min(k, 100)}
  `
}

/**
 * Build SQL query to load process steps for specific documents
 */
export function buildProcessStepsQuery(parquetUrl: string, docIds: string[]): string {
  // Build WHERE clause with escaped doc_ids
  const docIdConditions = docIds.map((id) => `doc_id = ${escapeString(id)}`).join(' OR ')

  return `
    SELECT
      doc_id,
      process_id,
      step_id,
      "order",
      step_key,
      label,
      evidence,
      embedding
    FROM read_parquet(${escapeString(parquetUrl)})
    WHERE ${docIdConditions}
    ORDER BY doc_id, "order"
  `
}

/**
 * Build SQL query to load process edges for specific documents
 */
export function buildProcessEdgesQuery(parquetUrl: string, docIds: string[]): string {
  const docIdConditions = docIds.map((id) => `doc_id = ${escapeString(id)}`).join(' OR ')

  return `
    SELECT
      doc_id,
      process_id,
      from_step_id,
      to_step_id,
      relation,
      evidence
    FROM read_parquet(${escapeString(parquetUrl)})
    WHERE ${docIdConditions}
  `
}

/**
 * Build SQL query for timeline events (optional temporal view)
 */
export function buildTimelineEventsQuery(parquetUrl: string, docIds?: string[]): string {
  let whereClause = ''
  if (docIds && docIds.length > 0) {
    const docIdConditions = docIds.map((id) => `doc_id = ${escapeString(id)}`).join(' OR ')
    whereClause = `WHERE ${docIdConditions}`
  }

  return `
    SELECT
      date,
      doc_id,
      label,
      evidence
    FROM read_parquet(${escapeString(parquetUrl)})
    ${whereClause}
    ORDER BY date
  `
}

/**
 * Build SQL query for temporal intervals (optional temporal view)
 */
export function buildTimelineIntervalsQuery(parquetUrl: string, docIds?: string[]): string {
  let whereClause = ''
  if (docIds && docIds.length > 0) {
    const docIdConditions = docIds.map((id) => `doc_id = ${escapeString(id)}`).join(' OR ')
    whereClause = `WHERE ${docIdConditions}`
  }

  return `
    SELECT
      start,
      "end",
      doc_id,
      type,
      evidence
    FROM read_parquet(${escapeString(parquetUrl)})
    ${whereClause}
    ORDER BY start
  `
}

/**
 * Build SQL query for metric time series (optional temporal view)
 */
export function buildMetricTimeQuery(
  parquetUrl: string,
  metric?: string,
  docIds?: string[]
): string {
  const conditions: string[] = []

  if (metric) {
    conditions.push(`metric = ${escapeString(metric)}`)
  }

  if (docIds && docIds.length > 0) {
    const docIdConditions = docIds.map((id) => `doc_id = ${escapeString(id)}`).join(' OR ')
    conditions.push(`(${docIdConditions})`)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return `
    SELECT
      ts,
      metric,
      val,
      doc_id,
      unit
    FROM read_parquet(${escapeString(parquetUrl)})
    ${whereClause}
    ORDER BY ts
  `
}

/**
 * Resolve parquet URL templates with doc_uuid placeholders
 * Example: s3://bucket/{doc_uuid}/file.parquet -> s3://bucket/abc123/file.parquet
 */
export function resolveParquetUrl(urlTemplate: string, docId: string): string {
  return urlTemplate.replace(/{doc_uuid}/g, docId).replace(/{doc_id}/g, docId)
}

/**
 * Build glob pattern for multi-document parquet files
 * Example: s3://bucket/parquet/star/process_summary.parquet (star = wildcard)
 */
export function buildParquetGlobPattern(urlTemplate: string): string {
  return urlTemplate.replace(/{doc_uuid}/g, '*').replace(/{doc_id}/g, '*')
}
