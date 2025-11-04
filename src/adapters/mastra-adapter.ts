/**
 * Mastra AI Framework Integration Adapter
 *
 * This module provides compatibility layer between DuckDB MCP Native tools
 * and the Mastra AI framework (https://mastra.ai).
 *
 * ## Integration Status
 *
 * - **Phase 0 (Current)**: Skeleton and type definitions (November 2025)
 * - **Phase 1 (Planned)**: Tool conversion implementation (December 2025 - January 2026)
 * - **Phase 2 (Planned)**: Full MCPServer integration (February - April 2026)
 * - **Phase 3 (Planned)**: Advanced features (SLM, HITL, vector store) (May - September 2026)
 *
 * ## API Stability Guarantee
 *
 * - **v0.x**: EXPERIMENTAL - Breaking changes possible between minor versions
 * - **v1.x**: STABLE - Semantic versioning, no breaking changes in minor/patch
 *
 * @packageDocumentation
 * @experimental This module is in early development (Phase 0)
 * @see {@link https://mastra.ai|Mastra AI Framework}
 * @see {@link https://github.com/mastra-ai/mastra|Mastra GitHub}
 */

import type { DuckDBService } from '../duckdb/service.js'

/**
 * Mastra Tool compatible interface
 *
 * Represents a tool that can be used by Mastra agents. This interface
 * matches Mastra's expected tool format with JSON Schema for input validation.
 *
 * @example
 * ```typescript
 * const queryTool: MastraToolAdapter = {
 *   id: 'query_duckdb',
 *   description: 'Execute SQL query on DuckDB',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       sql: { type: 'string', description: 'SQL query to execute' }
 *     },
 *     required: ['sql']
 *   },
 *   execute: async ({ sql }) => {
 *     // Execute query logic
 *   }
 * }
 * ```
 */
export interface MastraToolAdapter {
  /** Unique tool identifier (e.g., 'query_duckdb', 'list_tables') */
  id: string

  /** Human-readable description of what the tool does */
  description: string

  /**
   * JSON Schema defining the tool's input parameters
   * @see {@link https://json-schema.org|JSON Schema Specification}
   */
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }

  /**
   * Async function that executes the tool with given parameters
   * @param params - Tool input parameters (validated against inputSchema)
   * @returns Tool execution result
   */
  execute: (params: unknown) => Promise<unknown>
}

/**
 * Configuration for Mastra adapter behavior
 */
export interface MastraAdapterConfig {
  /**
   * DuckDB service instance to use for tool execution
   * If not provided, tools will need to manage their own connections
   */
  duckdb?: DuckDBService

  /**
   * Whether to include experimental tools (default: false)
   * Experimental tools may have unstable APIs or incomplete implementations
   */
  includeExperimental?: boolean

  /**
   * Tool execution timeout in milliseconds (default: 30000ms / 30s)
   */
  timeout?: number
}

/**
 * Converts DuckDB MCP native tools to Mastra-compatible format
 *
 * This function takes the 6 native DuckDB tools (query_duckdb, list_tables, etc.)
 * and converts them to Mastra's tool format with JSON Schema validation.
 *
 * ## Phase 1 Implementation (Planned)
 *
 * Will use `zod-to-json-schema` to convert Zod schemas to JSON Schema:
 *
 * ```typescript
 * import { zodToJsonSchema } from 'zod-to-json-schema'
 * import { nativeToolDefinitions, nativeToolHandlers } from '../tools/native-tools'
 *
 * return nativeToolDefinitions.map(tool => ({
 *   id: tool.name,
 *   description: tool.description,
 *   inputSchema: zodToJsonSchema(tool.inputSchema),
 *   execute: async (params) => {
 *     const handler = nativeToolHandlers[tool.name]
 *     return await handler(params, config.duckdb)
 *   }
 * }))
 * ```
 *
 * @param config - Configuration for adapter behavior
 * @returns Array of Mastra-compatible tool definitions
 * @throws {Error} Phase 0: Not yet implemented
 *
 * @example
 * ```typescript
 * import { Mastra, Agent } from '@mastra/core'
 * import { convertToMastraTools } from '@seed-ship/duckdb-mcp-native/mastra'
 *
 * const agent = new Agent({
 *   name: 'SQL Analytics Agent',
 *   tools: convertToMastraTools({ duckdb: myDuckDBInstance }),
 *   model: { provider: 'ANTHROPIC', name: 'claude-3-5-sonnet-20241022' }
 * })
 * ```
 *
 * @see {@link https://mastra.ai/docs/agents|Mastra Agents Documentation}
 */
export function convertToMastraTools(_config?: MastraAdapterConfig): MastraToolAdapter[] {
  // TODO Phase 1: Implement tool conversion
  // - Install dependencies: @mastra/core, zod-to-json-schema
  // - Convert Zod schemas to JSON Schema
  // - Wrap handlers with error handling
  // - Add timeout support
  // - Test with real Mastra agents
  throw new Error(
    'convertToMastraTools() not yet implemented (Phase 0 skeleton). ' +
      'Implementation planned for Phase 1 (December 2025 - January 2026). ' +
      'See docs/MASTRA_INTEGRATION.md for roadmap.'
  )
}

/**
 * Converts process mining tools to Mastra-compatible format
 *
 * This function converts the 3 process mining tools (process.describe,
 * process.similar, process.compose) to Mastra's tool format.
 *
 * ## Phase 2 Implementation (Planned)
 *
 * Will enable advanced process mining agents:
 *
 * ```typescript
 * const processAgent = new Agent({
 *   name: 'Process Mining Agent',
 *   tools: [
 *     ...convertToMastraTools(),
 *     ...convertProcessToolsToMastra()
 *   ],
 *   instructions: `You analyze process mining data to discover patterns...`
 * })
 * ```
 *
 * @param config - Configuration for adapter behavior
 * @returns Array of Mastra-compatible process mining tools
 * @throws {Error} Phase 0: Not yet implemented
 *
 * @example
 * ```typescript
 * // Workflow Discovery Agent (Phase 2)
 * const discoveryAgent = new Agent({
 *   name: 'Workflow Discovery Agent',
 *   tools: convertProcessToolsToMastra(),
 *   model: { provider: 'ANTHROPIC', name: 'claude-3-5-sonnet' }
 * })
 * ```
 */
export function convertProcessToolsToMastra(_config?: MastraAdapterConfig): MastraToolAdapter[] {
  // TODO Phase 2: Implement process tools conversion
  throw new Error(
    'convertProcessToolsToMastra() not yet implemented (Phase 0 skeleton). ' +
      'Implementation planned for Phase 2 (February - April 2026).'
  )
}

/**
 * Creates a Mastra MCPServer exposing DuckDB tools
 *
 * This function wraps DuckDBMCPServer to expose all 14 server tools via
 * Mastra's MCPServer interface, enabling external Mastra agents to consume
 * DuckDB capabilities.
 *
 * ## Phase 2 Implementation (Planned)
 *
 * Will enable bidirectional MCP integration:
 *
 * ```typescript
 * import { MCPServer } from '@mastra/mcp'
 *
 * const mcpServer = new MCPServer({
 *   name: 'duckdb-mcp-native',
 *   version: '1.0.0',
 *   tools: getAllDuckDBTools(),
 *   resources: getDuckDBResources(),
 *   prompts: getProcessMiningPrompts()
 * })
 * ```
 *
 * @param config - Configuration for MCPServer
 * @returns Mastra MCPServer instance
 * @throws {Error} Phase 0: Not yet implemented
 *
 * @example
 * ```typescript
 * // External agents can connect to this server
 * const server = createMastraMCPServer({
 *   duckdb: myDuckDBInstance,
 *   port: 3000
 * })
 *
 * await server.start()
 * ```
 */
export function createMastraMCPServer(_config?: MastraAdapterConfig): unknown {
  // TODO Phase 2: Implement MCPServer wrapper
  throw new Error(
    'createMastraMCPServer() not yet implemented (Phase 0 skeleton). ' +
      'Implementation planned for Phase 2 (February - April 2026).'
  )
}

/**
 * Type guard to check if a tool conforms to Mastra's interface
 *
 * @param tool - Object to check
 * @returns True if tool is Mastra-compatible
 */
export function isMastraTool(tool: unknown): tool is MastraToolAdapter {
  if (typeof tool !== 'object' || tool === null) return false
  const t = tool as Record<string, unknown>

  return (
    typeof t.id === 'string' &&
    typeof t.description === 'string' &&
    typeof t.inputSchema === 'object' &&
    t.inputSchema !== null &&
    typeof t.execute === 'function'
  )
}

/**
 * Export type definitions for TypeScript users
 */
export type { DuckDBService }
