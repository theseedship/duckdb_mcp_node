/**
 * F5: Graph export — json, csv, d3, graphml, parquet
 *
 * Validated patterns from tests/fierce-f2f5.ts:239-290.
 */

import { GraphExportInputSchema } from '../types/graph-schemas.js'
import type { GraphExportResult } from '../types/graph-types.js'
import { openComputeSession, type ComputeSession, type DuckDBLike } from '../compute-session.js'
import { validateGraphTables, getColumnRefs } from './graph-utils.js'
import { escapeString } from '../utils/sql-escape.js'
import { logger } from '../utils/logger.js'

/**
 * graph.export — Export graph in multiple formats
 */
export async function handleGraphExport(
  args: unknown,
  duckdb: DuckDBLike | ComputeSession
): Promise<GraphExportResult> {
  const session = openComputeSession(duckdb)

  const input = GraphExportInputSchema.parse(args)
  const { nodeCount, edgeCount } = await validateGraphTables(session, input)
  const { nodeTable, nodeIdCol, sourceCol, targetCol, weightCol, edgeSub } = getColumnRefs(input)

  try {
    switch (input.format) {
      case 'json':
        return await exportJson(
          session,
          input,
          nodeTable,
          nodeIdCol,
          edgeSub,
          sourceCol,
          targetCol,
          weightCol,
          nodeCount,
          edgeCount
        )
      case 'csv':
        return await exportCsv(
          session,
          input,
          nodeTable,
          nodeIdCol,
          edgeSub,
          sourceCol,
          targetCol,
          weightCol,
          nodeCount,
          edgeCount
        )
      case 'd3':
        return await exportD3(
          session,
          input,
          nodeTable,
          nodeIdCol,
          edgeSub,
          sourceCol,
          targetCol,
          weightCol,
          nodeCount,
          edgeCount
        )
      case 'graphml':
        return await exportGraphML(
          session,
          input,
          nodeTable,
          nodeIdCol,
          edgeSub,
          sourceCol,
          targetCol,
          weightCol,
          nodeCount,
          edgeCount
        )
      case 'parquet':
        return await exportParquet(
          session,
          input,
          nodeTable,
          nodeIdCol,
          edgeSub,
          sourceCol,
          targetCol,
          weightCol,
          nodeCount,
          edgeCount
        )
      default:
        throw new Error(`Unsupported export format: ${input.format}`)
    }
  } catch (error) {
    logger.error('graph.export failed', error)
    throw error
  }
}

type ExportInput = ReturnType<typeof GraphExportInputSchema.parse>

async function exportJson(
  session: ComputeSession,
  input: ExportInput,
  nodeTable: string,
  nodeIdCol: string,
  edgeSub: string,
  sourceCol: string,
  targetCol: string,
  weightCol: string | null,
  nodeCount: number,
  edgeCount: number
): Promise<GraphExportResult> {
  if (input.output_path) {
    // Export nodes and edges to JSON files
    const nodesPath = input.output_path.replace(/\.json$/, '_nodes.json')
    const edgesPath = input.output_path.replace(/\.json$/, '_edges.json')
    await session.exec(
      `COPY (SELECT * FROM ${nodeTable}) TO ${escapeString(nodesPath)} (FORMAT JSON)`
    )
    await session.exec(
      `COPY (SELECT * FROM ${edgeSub}) TO ${escapeString(edgesPath)} (FORMAT JSON)`
    )
    return {
      success: true,
      algorithm: 'export',
      format: 'json',
      output_path: input.output_path,
      node_count: nodeCount,
      edge_count: edgeCount,
    }
  }

  // In-memory: return data directly
  const nodes = await session.exec(`SELECT * FROM ${nodeTable}`)
  const edges = await session.exec(`SELECT * FROM ${edgeSub}`)
  return {
    success: true,
    algorithm: 'export',
    format: 'json',
    data: { nodes, edges },
    node_count: nodeCount,
    edge_count: edgeCount,
  }
}

async function exportCsv(
  session: ComputeSession,
  input: ExportInput,
  nodeTable: string,
  nodeIdCol: string,
  edgeSub: string,
  sourceCol: string,
  targetCol: string,
  weightCol: string | null,
  nodeCount: number,
  edgeCount: number
): Promise<GraphExportResult> {
  if (input.output_path) {
    // Gephi-compatible CSV
    const nodesPath = input.output_path.replace(/\.csv$/, '_nodes.csv')
    const edgesPath = input.output_path.replace(/\.csv$/, '_edges.csv')
    await session.exec(
      `COPY (SELECT ${nodeIdCol} AS Id, ${nodeIdCol} AS Label FROM ${nodeTable})
       TO ${escapeString(nodesPath)} (FORMAT CSV, HEADER)`
    )
    const weightSelect = weightCol ? `, ${weightCol} AS Weight` : ''
    await session.exec(
      `COPY (SELECT ${sourceCol} AS Source, ${targetCol} AS Target${weightSelect} FROM ${edgeSub})
       TO ${escapeString(edgesPath)} (FORMAT CSV, HEADER)`
    )
    return {
      success: true,
      algorithm: 'export',
      format: 'csv',
      output_path: input.output_path,
      node_count: nodeCount,
      edge_count: edgeCount,
    }
  }

  // In-memory Gephi-style
  const nodes = await session.exec(
    `SELECT ${nodeIdCol} AS Id, ${nodeIdCol} AS Label FROM ${nodeTable}`
  )
  const weightSelect = weightCol ? `, ${weightCol} AS Weight` : ''
  const edges = await session.exec(
    `SELECT ${sourceCol} AS Source, ${targetCol} AS Target${weightSelect} FROM ${edgeSub}`
  )
  return {
    success: true,
    algorithm: 'export',
    format: 'csv',
    data: { nodes, edges },
    node_count: nodeCount,
    edge_count: edgeCount,
  }
}

async function exportD3(
  session: ComputeSession,
  input: ExportInput,
  nodeTable: string,
  nodeIdCol: string,
  edgeSub: string,
  sourceCol: string,
  targetCol: string,
  weightCol: string | null,
  nodeCount: number,
  edgeCount: number
): Promise<GraphExportResult> {
  // D3 format: {nodes: [{id: ...}], links: [{source: ..., target: ..., value: ...}]}
  const nodes = await session.exec(`SELECT ${nodeIdCol} AS id FROM ${nodeTable}`)
  const valueSelect = weightCol ? `, CAST(${weightCol} AS DOUBLE) AS value` : ''
  const links = await session.exec(
    `SELECT ${sourceCol} AS source, ${targetCol} AS target${valueSelect} FROM ${edgeSub}`
  )

  const d3Data = {
    nodes: nodes.map((n: any) => ({ id: n.id })),
    links: links.map((l: any) => ({
      source: l.source,
      target: l.target,
      ...(weightCol ? { value: Number(l.value) } : {}),
    })),
  }

  if (input.output_path) {
    // Write D3 JSON to file via DuckDB
    // Use a temp table approach to generate JSON
    await session.exec(
      `COPY (SELECT ${escapeString(JSON.stringify(d3Data))} AS data)
       TO ${escapeString(input.output_path)} (FORMAT CSV, HEADER FALSE, QUOTE '')`
    )
    return {
      success: true,
      algorithm: 'export',
      format: 'd3',
      output_path: input.output_path,
      node_count: nodeCount,
      edge_count: edgeCount,
    }
  }

  return {
    success: true,
    algorithm: 'export',
    format: 'd3',
    data: d3Data,
    node_count: nodeCount,
    edge_count: edgeCount,
  }
}

async function exportGraphML(
  session: ComputeSession,
  input: ExportInput,
  nodeTable: string,
  nodeIdCol: string,
  edgeSub: string,
  sourceCol: string,
  targetCol: string,
  weightCol: string | null,
  nodeCount: number,
  edgeCount: number
): Promise<GraphExportResult> {
  // Build GraphML XML via SQL string aggregation
  const nodes = await session.exec(`SELECT ${nodeIdCol} AS id FROM ${nodeTable}`)
  const weightSelect = weightCol ? `, CAST(${weightCol} AS DOUBLE) AS weight` : ''
  const edges = await session.exec(
    `SELECT ${sourceCol} AS source, ${targetCol} AS target${weightSelect} FROM ${edgeSub}`
  )

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  xml += '<graphml xmlns="http://graphml.graphstruct.org/xmlns">\n'
  if (weightCol) {
    xml += '  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>\n'
  }
  xml += '  <graph id="G" edgedefault="directed">\n'
  for (const n of nodes) {
    xml += `    <node id="${n.id}"/>\n`
  }
  for (const e of edges) {
    xml += `    <edge source="${e.source}" target="${e.target}">`
    if (weightCol) {
      xml += `<data key="weight">${(e as any).weight}</data>`
    }
    xml += '</edge>\n'
  }
  xml += '  </graph>\n</graphml>'

  if (input.output_path) {
    // Write via a temp approach — create a single-value table and COPY
    await session.exec(
      `COPY (SELECT ${escapeString(xml)} AS data)
       TO ${escapeString(input.output_path)} (FORMAT CSV, HEADER FALSE, QUOTE '')`
    )
    return {
      success: true,
      algorithm: 'export',
      format: 'graphml',
      output_path: input.output_path,
      node_count: nodeCount,
      edge_count: edgeCount,
    }
  }

  return {
    success: true,
    algorithm: 'export',
    format: 'graphml',
    data: xml,
    node_count: nodeCount,
    edge_count: edgeCount,
  }
}

async function exportParquet(
  session: ComputeSession,
  input: ExportInput,
  nodeTable: string,
  nodeIdCol: string,
  edgeSub: string,
  sourceCol: string,
  targetCol: string,
  weightCol: string | null,
  nodeCount: number,
  edgeCount: number
): Promise<GraphExportResult> {
  if (!input.output_path) {
    throw new Error('output_path is required for parquet export')
  }

  const nodesPath = input.output_path.replace(/\.parquet$/, '_nodes.parquet')
  const edgesPath = input.output_path.replace(/\.parquet$/, '_edges.parquet')

  await session.exec(
    `COPY (SELECT * FROM ${nodeTable}) TO ${escapeString(nodesPath)} (FORMAT PARQUET)`
  )
  await session.exec(
    `COPY (SELECT * FROM ${edgeSub}) TO ${escapeString(edgesPath)} (FORMAT PARQUET)`
  )

  return {
    success: true,
    algorithm: 'export',
    format: 'parquet',
    output_path: input.output_path,
    node_count: nodeCount,
    edge_count: edgeCount,
  }
}
