/**
 * Zod schemas for graph algorithm MCP tools (S2: F1-F5)
 * All tools share GraphInputBase for table/column configuration.
 */

import { z } from 'zod'

// ── Shared base ──────────────────────────────────────────────

export const GraphInputBaseSchema = z.object({
  node_table: z.string().min(1),
  edge_table: z.string().min(1),
  node_id_column: z.string().default('node_id'),
  source_column: z.string().default('source'),
  target_column: z.string().default('target'),
  weight_column: z.string().optional(),
  filter: z.string().optional(),
})

export type GraphInputBase = z.infer<typeof GraphInputBaseSchema>

// ── F1: Centrality ───────────────────────────────────────────

export const PageRankInputSchema = GraphInputBaseSchema.extend({
  iterations: z.number().int().min(1).max(100).default(20),
  damping: z.number().min(0).max(1).default(0.85),
  top_n: z.number().int().min(1).max(1000).default(20),
})

export type PageRankInput = z.infer<typeof PageRankInputSchema>

export const EigenvectorInputSchema = GraphInputBaseSchema.extend({
  iterations: z.number().int().min(1).max(100).default(30),
  top_n: z.number().int().min(1).max(1000).default(20),
})

export type EigenvectorInput = z.infer<typeof EigenvectorInputSchema>

// ── F2: Community ────────────────────────────────────────────

export const CommunityDetectInputSchema = GraphInputBaseSchema.extend({
  max_iterations: z.number().int().min(1).max(100).default(15),
  directed: z.boolean().default(false),
})

export type CommunityDetectInput = z.infer<typeof CommunityDetectInputSchema>

export const ModularityInputSchema = GraphInputBaseSchema.extend({
  community_column: z.string().optional(),
  max_iterations: z.number().int().min(1).max(100).default(15),
})

export type ModularityInput = z.infer<typeof ModularityInputSchema>

// ── F3: Weighted Paths ───────────────────────────────────────

export const WeightedPathInputSchema = GraphInputBaseSchema.extend({
  source_node: z.union([z.string(), z.number()]),
  target_node: z.union([z.string(), z.number()]).optional(),
  mode: z.enum(['strongest', 'cheapest', 'combined']).default('strongest'),
  max_hops: z.number().int().min(1).max(20).default(6),
})

export type WeightedPathInput = z.infer<typeof WeightedPathInputSchema>

// ── F4: Temporal ─────────────────────────────────────────────

export const TemporalFilterInputSchema = GraphInputBaseSchema.extend({
  period_column: z.string().min(1),
  period_value: z.string().min(1),
})

export type TemporalFilterInput = z.infer<typeof TemporalFilterInputSchema>

export const ComparePeriodsInputSchema = GraphInputBaseSchema.extend({
  period_column: z.string().min(1),
  period_a: z.string().min(1),
  period_b: z.string().min(1),
  metrics: z
    .array(z.enum(['edge_count', 'avg_weight', 'density', 'node_count']))
    .default(['edge_count', 'avg_weight', 'density']),
})

export type ComparePeriodsInput = z.infer<typeof ComparePeriodsInputSchema>

// ── F5: Export ────────────────────────────────────────────────

export const GraphExportInputSchema = GraphInputBaseSchema.extend({
  format: z.enum(['json', 'csv', 'd3', 'graphml', 'parquet']).default('json'),
  output_path: z.string().optional(),
})

export type GraphExportInput = z.infer<typeof GraphExportInputSchema>
