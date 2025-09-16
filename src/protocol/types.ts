import { z } from 'zod'

// JSON-RPC 2.0 Base Types
export const JSONRPCVersionSchema = z.literal('2.0')

export const JSONRPCIdSchema = z.union([z.string(), z.number(), z.null()])

export const JSONRPCErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.any().optional(),
})

// MCP Request/Response Types
export const MCPRequestSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  method: z.string(),
  params: z.record(z.any()).optional(),
  id: JSONRPCIdSchema,
})

export const MCPResponseSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  result: z.any().optional(),
  error: JSONRPCErrorSchema.optional(),
  id: JSONRPCIdSchema,
})

export const MCPNotificationSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  method: z.string(),
  params: z.record(z.any()).optional(),
})

// MCP Resource Types
export const MCPResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

// MCP Tool Types
export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.any()),
    required: z.array(z.string()).optional(),
  }),
})

// MCP Server Configuration
export const MCPServerConfigSchema = z.object({
  name: z.string(),
  version: z.string(),
  transport: z.enum(['stdio', 'tcp', 'websocket', 'http']).default('stdio'),
  host: z.string().optional(),
  port: z.number().optional(),
  securityMode: z.enum(['development', 'production']).default('development'),
  maxQuerySize: z.number().default(1000000),
  queryTimeout: z.number().default(30000),
})

// MCP Client Configuration
export const MCPClientConfigSchema = z.object({
  serverName: z.string(),
  transport: z.enum(['stdio', 'tcp', 'websocket', 'http']),
  command: z.string().optional(), // For stdio transport
  host: z.string().optional(), // For network transports
  port: z.number().optional(), // For network transports
  reconnectAttempts: z.number().default(3),
  reconnectDelay: z.number().default(1000),
})

// Type exports
export type JSONRPCId = z.infer<typeof JSONRPCIdSchema>
export type JSONRPCError = z.infer<typeof JSONRPCErrorSchema>
export type MCPRequest = z.infer<typeof MCPRequestSchema>
export type MCPResponse = z.infer<typeof MCPResponseSchema>
export type MCPNotification = z.infer<typeof MCPNotificationSchema>
export type MCPResource = z.infer<typeof MCPResourceSchema>
export type MCPTool = z.infer<typeof MCPToolSchema>
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>
export type MCPClientConfig = z.infer<typeof MCPClientConfigSchema>

// Error codes (JSON-RPC 2.0 standard)
export enum ErrorCode {
  // ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  // InvalidParams = -32602,
  InternalError = -32603,
  // MCP-specific error codes
  // ResourceNotFound = -32001,
  // ToolExecutionFailed = -32002,
  // AuthenticationFailed = -32003,
  // SecurityViolation = -32004,
  // QueryTimeout = -32005,
}

// MCP Message type (union of all message types)
export type MCPMessage = MCPRequest | MCPResponse | MCPNotification
