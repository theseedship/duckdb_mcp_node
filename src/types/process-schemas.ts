/**
 * Zod schemas for process mining resources
 * These schemas validate parquet data at runtime
 */

import { z } from 'zod'

/**
 * Schema for process summary records
 */
export const ProcessSummarySchema = z.object({
  doc_id: z.string().min(1),
  process_id: z.string().min(1),
  type: z.string().min(1),
  one_liner: z.string().max(160),
  steps_count: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  mermaid: z.string().nullable().optional(),
})

/**
 * Schema for process step records
 */
export const ProcessStepSchema = z.object({
  doc_id: z.string().min(1),
  process_id: z.string().min(1),
  step_id: z.string().min(1),
  order: z.number().int().min(0),
  step_key: z.string().min(1),
  label: z.string().min(1),
  evidence: z.string().max(512).nullable().optional(),
  embedding: z.array(z.number()).nullable().optional(),
})

/**
 * Schema for process edge records
 */
export const ProcessEdgeSchema = z.object({
  doc_id: z.string().min(1),
  process_id: z.string().min(1),
  from_step_id: z.string().min(1),
  to_step_id: z.string().min(1),
  relation: z.string().default('next'),
  evidence: z.string().nullable().optional(),
})

/**
 * Schema for process signature records
 */
export const ProcessSignatureSchema = z.object({
  doc_id: z.string().min(1),
  process_id: z.string().min(1),
  signature_emb: z.array(z.number()).min(1),
})

/**
 * Schema for temporal event records
 */
export const EventSchema = z.object({
  date: z.string().datetime(),
  doc_id: z.string().min(1),
  label: z.string().min(1),
  evidence: z.string().optional(),
})

/**
 * Schema for temporal interval records
 */
export const IntervalSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  doc_id: z.string().min(1),
  type: z.string().min(1),
  evidence: z.string().optional(),
})

/**
 * Schema for time-series metric records
 */
export const MetricTimeSchema = z.object({
  ts: z.string().datetime(),
  metric: z.string().min(1),
  val: z.number(),
  doc_id: z.string().min(1),
  unit: z.string().optional(),
})

/**
 * Schema for state deadline records
 */
export const StateDeadlineSchema = z.object({
  date: z.string().datetime(),
  type: z.string().min(1),
  info: z.string().min(1),
  doc_id: z.string().min(1),
})

/**
 * Schema for process.describe tool arguments
 */
export const ProcessDescribeArgsSchema = z.object({
  topN: z.number().int().min(1).max(100).default(5),
  parquet_url: z.string().min(1).optional(),
})

/**
 * Schema for process.similar tool arguments
 */
export const ProcessSimilarArgsSchema = z.object({
  signature_emb: z.array(z.number()).min(1),
  k: z.number().int().min(1).max(100).default(5),
  parquet_url: z.string().min(1).optional(),
})

/**
 * Schema for process.compose tool arguments
 */
export const ProcessComposeArgsSchema = z.object({
  doc_ids: z.array(z.string().min(1)).min(1),
  steps_url: z.string().min(1).optional(),
  edges_url: z.string().min(1).optional(),
})

/**
 * Schema for process parquet configuration
 */
export const ProcessParquetConfigSchema = z.object({
  summary_url: z.string().url().optional(),
  steps_url: z.string().url().optional(),
  edges_url: z.string().url().optional(),
  signature_url: z.string().url().optional(),
  events_url: z.string().url().optional(),
  intervals_url: z.string().url().optional(),
  metric_time_url: z.string().url().optional(),
  state_deadline_url: z.string().url().optional(),
})

// Export types inferred from schemas
export type ProcessSummary = z.infer<typeof ProcessSummarySchema>
export type ProcessStep = z.infer<typeof ProcessStepSchema>
export type ProcessEdge = z.infer<typeof ProcessEdgeSchema>
export type ProcessSignature = z.infer<typeof ProcessSignatureSchema>
export type Event = z.infer<typeof EventSchema>
export type Interval = z.infer<typeof IntervalSchema>
export type MetricTime = z.infer<typeof MetricTimeSchema>
export type StateDeadline = z.infer<typeof StateDeadlineSchema>
export type ProcessDescribeArgs = z.infer<typeof ProcessDescribeArgsSchema>
export type ProcessSimilarArgs = z.infer<typeof ProcessSimilarArgsSchema>
export type ProcessComposeArgs = z.infer<typeof ProcessComposeArgsSchema>
export type ProcessParquetConfig = z.infer<typeof ProcessParquetConfigSchema>
