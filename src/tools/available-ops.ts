/**
 * Discovery API — enumerates the graph + process ops shipped by this
 * plugin so that host runtimes (deposium scratchpad, etc.) can
 * boot-validate their op-to-model bindings against what is actually
 * available. Avoids silent drift when the plugin adds/removes ops.
 *
 * @since v1.3.0
 *
 * Usage on the host side:
 * ```ts
 * import { AVAILABLE_OPS } from '@seed-ship/duckdb-mcp-native'
 *
 * const shipped = new Set(AVAILABLE_OPS.map((op) => op.name))
 * for (const bound of Object.keys(OP_MODEL_BINDINGS)) {
 *   if (!shipped.has(bound)) {
 *     console.warn(`OP_MODEL_BINDINGS references '${bound}' but plugin does not ship it`)
 *   }
 * }
 * ```
 */

/**
 * Metadata for an op exported by the plugin.
 *
 * `costClass` is a coarse hint useful to the host for routing the call to
 * an appropriately-sized model class. It does not encode SLA — it merely
 * groups ops by typical workload shape.
 */
export interface AvailableOp {
  /** Canonical op name, e.g. 'graph.pagerank'. Must match the binding key on the host. */
  name: string
  /** Family the op belongs to. Useful for grouping in dashboards. */
  family: 'graph' | 'process' | 'data'
  /** One-line description of what the op does. */
  description: string
  /**
   * Coarse cost hint for the host's model-router:
   * - `cheap`: fast, deterministic, summarisation-only (e.g. modularity scoring)
   * - `medium`: typical analytical query, multi-statement (e.g. pagerank, community)
   * - `heavy`: large iteration counts or fan-out (e.g. compare_periods on big graphs)
   */
  costClass: 'cheap' | 'medium' | 'heavy'
  /** Names of the input fields the op accepts (Zod schema field names). */
  inputs: readonly string[]
}

export const AVAILABLE_OPS: readonly AvailableOp[] = [
  // ── Graph: centrality ─────────────────────────────────────────
  {
    name: 'graph.pagerank',
    family: 'graph',
    description: 'Iterative PageRank with damping factor (dedup-safe over node_id).',
    costClass: 'medium',
    inputs: [
      'node_table',
      'edge_table',
      'node_id_column',
      'source_column',
      'target_column',
      'weight_column',
      'filter',
      'iterations',
      'damping',
      'top_n',
    ],
  },
  {
    name: 'graph.eigenvector',
    family: 'graph',
    description:
      'Power-iteration eigenvector centrality — weights nodes by the importance of their neighbours.',
    costClass: 'medium',
    inputs: [
      'node_table',
      'edge_table',
      'node_id_column',
      'source_column',
      'target_column',
      'weight_column',
      'filter',
      'iterations',
      'top_n',
    ],
  },
  // ── Graph: community ──────────────────────────────────────────
  {
    name: 'graph.community_detect',
    family: 'graph',
    description: 'Label-propagation community detection (directed or undirected).',
    costClass: 'medium',
    inputs: [
      'node_table',
      'edge_table',
      'node_id_column',
      'source_column',
      'target_column',
      'filter',
      'max_iterations',
      'directed',
    ],
  },
  {
    name: 'graph.modularity',
    family: 'graph',
    description: 'Modularity Q score — qualifies a clustering ("real" vs noise).',
    costClass: 'cheap',
    inputs: [
      'node_table',
      'edge_table',
      'node_id_column',
      'source_column',
      'target_column',
      'filter',
      'community_column',
      'max_iterations',
    ],
  },
  // ── Graph: paths ──────────────────────────────────────────────
  {
    name: 'graph.weighted_path',
    family: 'graph',
    description:
      'Find paths via strongest (BFS multiplicative), cheapest (Bellman-Ford) or combined modes.',
    costClass: 'medium',
    inputs: [
      'node_table',
      'edge_table',
      'node_id_column',
      'source_column',
      'target_column',
      'weight_column',
      'filter',
      'source_node',
      'target_node',
      'mode',
      'max_hops',
    ],
  },
  // ── Graph: temporal ───────────────────────────────────────────
  {
    name: 'graph.temporal_filter',
    family: 'graph',
    description: 'Slice a graph by a period column/value, return node/edge stats and density.',
    costClass: 'cheap',
    inputs: [
      'node_table',
      'edge_table',
      'node_id_column',
      'source_column',
      'target_column',
      'weight_column',
      'period_column',
      'period_value',
    ],
  },
  {
    name: 'graph.compare_periods',
    family: 'graph',
    description:
      'FULL OUTER JOIN edges of two periods; classify NEW / REMOVED / STRENGTHENED / WEAKENED / STABLE.',
    costClass: 'heavy',
    inputs: [
      'node_table',
      'edge_table',
      'node_id_column',
      'source_column',
      'target_column',
      'weight_column',
      'period_column',
      'period_a',
      'period_b',
      'metrics',
    ],
  },
  // ── Graph: export ─────────────────────────────────────────────
  {
    name: 'graph.export',
    family: 'graph',
    description: 'Serialise a graph to json / csv / d3 / graphml / parquet.',
    costClass: 'cheap',
    inputs: [
      'node_table',
      'edge_table',
      'node_id_column',
      'source_column',
      'target_column',
      'weight_column',
      'filter',
      'format',
      'output_path',
    ],
  },
  // ── Process mining (P2.8 / P2.9) ──────────────────────────────
  {
    name: 'process.describe',
    family: 'process',
    description: 'Summarise an event log into ordered steps with frequency stats.',
    costClass: 'cheap',
    inputs: ['event_table', 'case_id_column', 'activity_column', 'timestamp_column'],
  },
  {
    name: 'process.similar',
    family: 'process',
    description: 'Find processes similar to a reference using embedding distance.',
    costClass: 'medium',
    inputs: ['embedding_table', 'reference_id', 'top_k', 'distance_metric'],
  },
  {
    name: 'process.compose',
    family: 'process',
    description: 'Compose multiple process logs into a single merged trace.',
    costClass: 'medium',
    inputs: ['process_ids', 'event_table', 'case_id_column', 'activity_column'],
  },
] as const
