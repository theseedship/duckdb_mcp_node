/**
 * Configuration for starting an MCP server
 */
export interface ServerConfig {
  transport?: 'stdio' | 'http'
  port?: number
  host?: string
  maxConnections?: number
}

/**
 * Options for attaching to an MCP server
 */
export interface AttachOptions {
  skipCache?: boolean
  cacheTTL?: number // in milliseconds
  autoRefresh?: boolean
  refreshInterval?: number // in milliseconds
  connectionTimeout?: number // in milliseconds
}

/**
 * Status information for a server or client
 */
export interface ConnectionStatus {
  name: string
  type: 'server' | 'client'
  status: 'running' | 'connected' | 'error'
  error?: string
}

/**
 * Overall service status
 */
export interface ServiceStatus {
  servers: ConnectionStatus[]
  clients: ConnectionStatus[]
  resourceCacheSize: number
}

/**
 * Virtual table configuration for service layer
 */
export interface ServiceVirtualTableConfig {
  tableName: string
  resourceUri: string
  refreshInterval?: number
  autoRefresh?: boolean
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean
  data?: any
  error?: string
  executionTime?: number
}
