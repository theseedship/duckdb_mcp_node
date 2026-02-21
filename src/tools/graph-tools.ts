/**
 * Barrel file for graph algorithm MCP tools (S2: F1-F5)
 * Aggregates tool definitions and handlers from all 5 modules.
 */

import { handlePageRank, handleEigenvector } from './graph-centrality.js'
import { handleCommunityDetect, handleModularity } from './graph-community.js'
import { handleWeightedPath } from './graph-paths.js'
import { handleTemporalFilter, handleComparePeriods } from './graph-temporal.js'
import { handleGraphExport } from './graph-export.js'

// Re-export individual handlers for direct use
export {
  handlePageRank,
  handleEigenvector,
  handleCommunityDetect,
  handleModularity,
  handleWeightedPath,
  handleTemporalFilter,
  handleComparePeriods,
  handleGraphExport,
}

// ── Shared input schema (JSON Schema for MCP tool registration) ──

const graphInputProperties = {
  node_table: { type: 'string', description: 'Table containing graph nodes' },
  edge_table: { type: 'string', description: 'Table containing graph edges' },
  node_id_column: {
    type: 'string',
    description: 'Node ID column name (default: node_id)',
    default: 'node_id',
  },
  source_column: {
    type: 'string',
    description: 'Edge source column name (default: source)',
    default: 'source',
  },
  target_column: {
    type: 'string',
    description: 'Edge target column name (default: target)',
    default: 'target',
  },
  weight_column: { type: 'string', description: 'Optional edge weight column' },
  filter: { type: 'string', description: 'Optional WHERE clause to filter edges' },
}

const graphRequired = ['node_table', 'edge_table']

// ── Tool Definitions ─────────────────────────────────────────

export const graphToolDefinitions = [
  {
    name: 'graph.pagerank',
    description: 'Compute PageRank centrality scores for graph nodes using iterative power method',
    inputSchema: {
      type: 'object',
      properties: {
        ...graphInputProperties,
        iterations: {
          type: 'number',
          description: 'Number of iterations (default: 20)',
          default: 20,
        },
        damping: { type: 'number', description: 'Damping factor (default: 0.85)', default: 0.85 },
        top_n: {
          type: 'number',
          description: 'Return top N nodes by rank (default: 20)',
          default: 20,
        },
      },
      required: graphRequired,
    },
  },
  {
    name: 'graph.eigenvector',
    description: 'Compute eigenvector centrality scores using power iteration',
    inputSchema: {
      type: 'object',
      properties: {
        ...graphInputProperties,
        iterations: {
          type: 'number',
          description: 'Number of iterations (default: 30)',
          default: 30,
        },
        top_n: {
          type: 'number',
          description: 'Return top N nodes by score (default: 20)',
          default: 20,
        },
      },
      required: graphRequired,
    },
  },
  {
    name: 'graph.community_detect',
    description: 'Detect communities using label propagation algorithm',
    inputSchema: {
      type: 'object',
      properties: {
        ...graphInputProperties,
        max_iterations: {
          type: 'number',
          description: 'Maximum iterations (default: 15)',
          default: 15,
        },
        directed: {
          type: 'boolean',
          description: 'Treat graph as directed (default: false)',
          default: false,
        },
      },
      required: graphRequired,
    },
  },
  {
    name: 'graph.modularity',
    description: 'Compute modularity score Q for community structure quality',
    inputSchema: {
      type: 'object',
      properties: {
        ...graphInputProperties,
        community_column: {
          type: 'string',
          description:
            'Column with community assignments (optional — runs community_detect if omitted)',
        },
        max_iterations: {
          type: 'number',
          description: 'Max iterations for auto community detection (default: 15)',
          default: 15,
        },
      },
      required: graphRequired,
    },
  },
  {
    name: 'graph.weighted_path',
    description:
      'Find weighted paths between nodes: strongest (max weight product), cheapest (min cost), or combined (additive)',
    inputSchema: {
      type: 'object',
      properties: {
        ...graphInputProperties,
        source_node: { type: 'string', description: 'Starting node ID' },
        target_node: {
          type: 'string',
          description: 'Optional target node ID (if omitted, finds paths to all reachable nodes)',
        },
        mode: {
          type: 'string',
          enum: ['strongest', 'cheapest', 'combined'],
          description: 'Path mode (default: strongest)',
          default: 'strongest',
        },
        max_hops: { type: 'number', description: 'Maximum path length (default: 6)', default: 6 },
      },
      required: [...graphRequired, 'source_node'],
    },
  },
  {
    name: 'graph.temporal_filter',
    description: 'Filter graph edges by time period and return graph statistics',
    inputSchema: {
      type: 'object',
      properties: {
        ...graphInputProperties,
        period_column: { type: 'string', description: 'Column containing period/time values' },
        period_value: { type: 'string', description: 'Period value to filter by' },
      },
      required: [...graphRequired, 'period_column', 'period_value'],
    },
  },
  {
    name: 'graph.compare_periods',
    description:
      'Compare graph structure between two time periods — find new, removed, strengthened, and weakened edges',
    inputSchema: {
      type: 'object',
      properties: {
        ...graphInputProperties,
        period_column: { type: 'string', description: 'Column containing period/time values' },
        period_a: { type: 'string', description: 'First period to compare' },
        period_b: { type: 'string', description: 'Second period to compare' },
        metrics: {
          type: 'array',
          items: { type: 'string', enum: ['edge_count', 'avg_weight', 'density', 'node_count'] },
          description: 'Metrics to compute (default: edge_count, avg_weight, density)',
        },
      },
      required: [...graphRequired, 'period_column', 'period_a', 'period_b'],
    },
  },
  {
    name: 'graph.export',
    description: 'Export graph in multiple formats: json, csv (Gephi), d3, graphml, or parquet',
    inputSchema: {
      type: 'object',
      properties: {
        ...graphInputProperties,
        format: {
          type: 'string',
          enum: ['json', 'csv', 'd3', 'graphml', 'parquet'],
          description: 'Export format (default: json)',
          default: 'json',
        },
        output_path: {
          type: 'string',
          description: 'File path for export (required for parquet, optional for others)',
        },
      },
      required: graphRequired,
    },
  },
]

// ── Handler Map ──────────────────────────────────────────────

export const graphToolHandlers = {
  'graph.pagerank': handlePageRank,
  'graph.eigenvector': handleEigenvector,
  'graph.community_detect': handleCommunityDetect,
  'graph.modularity': handleModularity,
  'graph.weighted_path': handleWeightedPath,
  'graph.temporal_filter': handleTemporalFilter,
  'graph.compare_periods': handleComparePeriods,
  'graph.export': handleGraphExport,
} as const
