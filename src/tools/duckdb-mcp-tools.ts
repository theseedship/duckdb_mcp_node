import { z } from 'zod'
import { getDuckDBMcpNativeService } from '../service/DuckDBMcpNativeService.js'

/**
 * MCP Server Tool - Start an MCP server to expose DuckDB tables
 */
export const mcpServeSchema = z.object({
  name: z.string().describe('Name for the MCP server'),
  transport: z.enum(['stdio', 'http']).optional().describe('Transport type (default: stdio)'),
  port: z.number().optional().describe('Port for HTTP transport'),
  host: z.string().optional().describe('Host for HTTP transport'),
})

export async function mcpServe(params: z.infer<typeof mcpServeSchema>) {
  const validated = mcpServeSchema.parse(params)
  const service = getDuckDBMcpNativeService()

  await service.startServer(validated.name, {
    transport: validated.transport,
    port: validated.port,
    host: validated.host,
  })

  return {
    status: 'server_started',
    name: validated.name,
    transport: validated.transport || 'stdio',
  }
}

/**
 * MCP Attach Tool - Connect to an external MCP server
 */
export const mcpAttachSchema = z.object({
  url: z.string().describe('URL of the MCP server to connect to'),
  alias: z.string().describe('Alias for this connection'),
  skipCache: z.boolean().optional().describe('Skip resource cache'),
  cacheTTL: z.number().optional().describe('Cache TTL in milliseconds'),
})

export async function mcpAttach(params: z.infer<typeof mcpAttachSchema>) {
  const validated = mcpAttachSchema.parse(params)
  const service = getDuckDBMcpNativeService()

  const resources = await service.attachMCP(validated.url, validated.alias, {
    skipCache: validated.skipCache,
    cacheTTL: validated.cacheTTL,
  })

  return {
    status: 'attached',
    alias: validated.alias,
    url: validated.url,
    resourceCount: resources.length,
    resources: resources.slice(0, 10), // Return first 10 resources
  }
}

/**
 * MCP Detach Tool - Disconnect from an MCP server
 */
export const mcpDetachSchema = z.object({
  alias: z.string().describe('Alias of the connection to detach'),
})

export async function mcpDetach(params: z.infer<typeof mcpDetachSchema>) {
  const validated = mcpDetachSchema.parse(params)
  const service = getDuckDBMcpNativeService()

  await service.detachMCP(validated.alias)

  return {
    status: 'detached',
    alias: validated.alias,
  }
}

/**
 * MCP Create Virtual Table Tool - Create a DuckDB table from an MCP resource
 */
export const mcpCreateVirtualTableSchema = z.object({
  alias: z.string().describe('Alias of the MCP connection'),
  resourceUri: z.string().describe('URI of the resource to map'),
  tableName: z.string().optional().describe('Name for the virtual table'),
})

export async function mcpCreateVirtualTable(params: z.infer<typeof mcpCreateVirtualTableSchema>) {
  const validated = mcpCreateVirtualTableSchema.parse(params)
  const service = getDuckDBMcpNativeService()

  await service.createVirtualTable(validated.alias, validated.resourceUri, validated.tableName)

  return {
    status: 'table_created',
    alias: validated.alias,
    resourceUri: validated.resourceUri,
    tableName: validated.tableName,
  }
}

/**
 * MCP Call Tool - Execute a tool on a connected MCP server
 */
export const mcpCallToolSchema = z.object({
  alias: z.string().describe('Alias of the MCP connection'),
  toolName: z.string().describe('Name of the tool to call'),
  args: z.any().describe('Arguments for the tool'),
})

export async function mcpCallTool(params: z.infer<typeof mcpCallToolSchema>) {
  const validated = mcpCallToolSchema.parse(params)
  const service = getDuckDBMcpNativeService()

  const result = await service.callTool(validated.alias, validated.toolName, validated.args)

  return {
    status: 'tool_executed',
    alias: validated.alias,
    toolName: validated.toolName,
    result,
  }
}

/**
 * MCP Status Tool - Get status of all servers and clients
 */
export async function mcpStatus() {
  const service = getDuckDBMcpNativeService()
  return service.getStatus()
}

/**
 * MCP List Resources Tool - List resources from a connected MCP server
 */
export const mcpListResourcesSchema = z.object({
  alias: z.string().describe('Alias of the MCP connection'),
})

export async function mcpListResources(params: z.infer<typeof mcpListResourcesSchema>) {
  const validated = mcpListResourcesSchema.parse(params)
  const service = getDuckDBMcpNativeService()

  const resources = await service.getClientResources(validated.alias)

  return {
    status: 'success',
    alias: validated.alias,
    resourceCount: resources.length,
    resources,
  }
}

/**
 * MCP List Tools Tool - List tools from a connected MCP server
 */
export const mcpListToolsSchema = z.object({
  alias: z.string().describe('Alias of the MCP connection'),
})

export async function mcpListTools(params: z.infer<typeof mcpListToolsSchema>) {
  const validated = mcpListToolsSchema.parse(params)
  const service = getDuckDBMcpNativeService()

  const tools = await service.getClientTools(validated.alias)

  return {
    status: 'success',
    alias: validated.alias,
    toolCount: tools.length,
    tools,
  }
}

/**
 * MCP Clear Cache Tool - Clear the resource cache
 */
export async function mcpClearCache() {
  const service = getDuckDBMcpNativeService()
  service.clearCache()

  return {
    status: 'cache_cleared',
  }
}

/**
 * Export all tools for registration
 */
export const duckdbMcpTools = {
  mcpServe,
  mcpAttach,
  mcpDetach,
  mcpCreateVirtualTable,
  mcpCallTool,
  mcpStatus,
  mcpListResources,
  mcpListTools,
  mcpClearCache,
}

/**
 * Export all schemas for validation
 */
export const duckdbMcpSchemas = {
  mcpServeSchema,
  mcpAttachSchema,
  mcpDetachSchema,
  mcpCreateVirtualTableSchema,
  mcpCallToolSchema,
  mcpListResourcesSchema,
  mcpListToolsSchema,
}
