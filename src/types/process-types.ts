/**
 * TypeScript types for process mining resources
 * These types represent the structure of process-related parquet files
 */

/**
 * Process summary with high-level metadata
 */
export interface ProcessSummary {
  doc_id: string
  process_id: string
  type: string
  one_liner: string
  steps_count: number
  confidence: number
  mermaid?: string | null
}

/**
 * Individual process step with embedding
 */
export interface ProcessStep {
  doc_id: string
  process_id: string
  step_id: string
  order: number
  step_key: string
  label: string
  evidence?: string | null
  embedding?: number[] | null // FLOAT[N] array for similarity search
}

/**
 * Edge connecting two process steps
 */
export interface ProcessEdge {
  doc_id: string
  process_id: string
  from_step_id: string
  to_step_id: string
  relation: string
  evidence?: string | null
}

/**
 * Process signature embedding for similarity search
 */
export interface ProcessSignature {
  doc_id: string
  process_id: string
  signature_emb: number[] // FLOAT[N] array representing the entire process
}

/**
 * Optional: Temporal event
 */
export interface Event {
  date: string // ISO 8601 date
  doc_id: string
  label: string
  evidence?: string
}

/**
 * Optional: Temporal interval
 */
export interface Interval {
  start: string // ISO 8601 timestamp
  end: string // ISO 8601 timestamp
  doc_id: string
  type: string
  evidence?: string
}

/**
 * Optional: Time-series metric
 */
export interface MetricTime {
  ts: string // ISO 8601 timestamp
  metric: string
  val: number
  doc_id: string
  unit?: string
}

/**
 * Optional: State deadline
 */
export interface StateDeadline {
  date: string // ISO 8601 date
  type: string
  info: string
  doc_id: string
}

/**
 * Result from process.describe tool
 */
export interface ProcessDescribeResult {
  success: boolean
  processes: ProcessSummary[]
  count: number
}

/**
 * Result from process.similar tool
 */
export interface ProcessSimilarResult {
  success: boolean
  matches: Array<{
    doc_id: string
    process_id: string
    distance: number
    summary?: ProcessSummary
  }>
  count: number
}

/**
 * QA report for composed process
 * P2.9.4: Quality assurance checks
 */
export interface QAReport {
  orphan_steps: string[] // Steps with no incoming or outgoing edges
  cycles: string[][] // Detected cycles (pairs of mutually connected steps)
  duplicate_edges: string[] // Duplicate edge connections
  warnings: string[] // Human-readable warnings
}

/**
 * Result from process.compose tool
 */
export interface ProcessComposeResult {
  success: boolean
  steps: ProcessStep[]
  edges: ProcessEdge[]
  merged_count: number
  source_docs: string[]
  qa: QAReport // P2.9.4: Quality assurance report
}

/**
 * Configuration for process parquet URLs
 */
export interface ProcessParquetConfig {
  summary_url?: string
  steps_url?: string
  edges_url?: string
  signature_url?: string
  events_url?: string
  intervals_url?: string
  metric_time_url?: string
  state_deadline_url?: string
}
