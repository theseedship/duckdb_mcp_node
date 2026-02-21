/**
 * TypeScript result interfaces for graph algorithm MCP tools (S2: F1-F5)
 */

// ── F1: Centrality Results ───────────────────────────────────

export interface PageRankNode {
  node_id: string | number
  rank: number
}

export interface PageRankResult {
  success: boolean
  algorithm: 'pagerank'
  nodes: PageRankNode[]
  iterations: number
  damping: number
  total_nodes: number
}

export interface EigenvectorNode {
  node_id: string | number
  score: number
}

export interface EigenvectorResult {
  success: boolean
  algorithm: 'eigenvector'
  nodes: EigenvectorNode[]
  iterations: number
  total_nodes: number
}

// ── F2: Community Results ────────────────────────────────────

export interface CommunityNode {
  node_id: string | number
  community_id: string | number
}

export interface CommunityInfo {
  community_id: string | number
  size: number
  members: (string | number)[]
}

export interface CommunityDetectResult {
  success: boolean
  algorithm: 'label_propagation'
  communities: CommunityInfo[]
  node_assignments: CommunityNode[]
  num_communities: number
  iterations_used: number
  converged: boolean
}

export interface ModularityResult {
  success: boolean
  algorithm: 'modularity'
  modularity: number
  num_communities: number
  total_edges: number
}

// ── F3: Weighted Path Results ────────────────────────────────

export interface PathStep {
  node_id: string | number
  cumulative_weight: number
}

export interface PathResult {
  source: string | number
  target: string | number
  path: PathStep[]
  total_weight: number
  hops: number
}

export interface WeightedPathResult {
  success: boolean
  algorithm: 'weighted_path'
  mode: 'strongest' | 'cheapest' | 'combined'
  paths: PathResult[]
  max_hops: number
}

// ── F4: Temporal Results ─────────────────────────────────────

export interface TemporalFilterResult {
  success: boolean
  algorithm: 'temporal_filter'
  period_column: string
  period_value: string
  node_count: number
  edge_count: number
  avg_weight: number | null
  density: number
}

export interface EdgeChange {
  source: string | number
  target: string | number
  weight_a: number | null
  weight_b: number | null
  change_type: 'STRENGTHENED' | 'WEAKENED' | 'STABLE' | 'NEW' | 'REMOVED'
}

export interface PeriodMetrics {
  edge_count: number
  avg_weight: number | null
  density: number
  node_count: number
}

export interface ComparePeriodsResult {
  success: boolean
  algorithm: 'compare_periods'
  period_a: PeriodMetrics
  period_b: PeriodMetrics
  changes: EdgeChange[]
  summary: {
    new_edges: number
    removed_edges: number
    strengthened: number
    weakened: number
    stable: number
  }
}

// ── F5: Export Results ────────────────────────────────────────

export interface GraphExportResult {
  success: boolean
  algorithm: 'export'
  format: 'json' | 'csv' | 'd3' | 'graphml' | 'parquet'
  output_path?: string
  data?: unknown
  node_count: number
  edge_count: number
}
