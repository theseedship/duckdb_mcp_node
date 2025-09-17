import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { URL } from 'url'
import { HTTPTransport, WebSocketTransport, TCPTransport } from '../protocol/index.js'
import { SDKTransportAdapter } from '../protocol/sdk-transport-adapter.js'

/**
 * Represents a pooled connection to an MCP server
 */
export interface PooledConnection {
  url: string
  transport: 'stdio' | 'http' | 'websocket' | 'tcp' | 'auto'
  client: Client
  connectedAt: Date
  lastUsed: Date
  useCount: number
  healthy: boolean
  metadata?: Record<string, any>
}

/**
 * Configuration for connection pool
 */
export interface ConnectionPoolConfig {
  maxConnections?: number
  connectionTTL?: number // milliseconds
  idleTimeout?: number // milliseconds
  healthCheckInterval?: number // milliseconds
  retryAttempts?: number
  retryDelay?: number // milliseconds
}

/**
 * Connection pool for managing MCP client connections
 * Handles connection reuse, health checks, and automatic transport negotiation
 */
export class MCPConnectionPool {
  private connections = new Map<string, PooledConnection>()
  private config: Required<ConnectionPoolConfig>
  private healthCheckTimer?: ReturnType<typeof setInterval>
  private cleanupTimer?: ReturnType<typeof setInterval>

  constructor(config: ConnectionPoolConfig = {}) {
    this.config = {
      maxConnections: config.maxConnections ?? 50,
      connectionTTL: config.connectionTTL ?? 3600000, // 1 hour
      idleTimeout: config.idleTimeout ?? 600000, // 10 minutes
      healthCheckInterval: config.healthCheckInterval ?? 30000, // 30 seconds
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000, // 1 second
    }

    // Start periodic health checks and cleanup
    this.startMaintenanceTasks()
  }

  /**
   * Get or create a client connection
   * @param url The server URL
   * @param transport Optional transport type (auto-negotiates if not specified)
   * @returns The MCP client
   */
  async getClient(
    url: string,
    transport: 'stdio' | 'http' | 'websocket' | 'tcp' | 'auto' = 'auto'
  ): Promise<Client> {
    const key = this.getConnectionKey(url, transport)

    // Check for existing healthy connection
    const existing = this.connections.get(key)
    if (existing && existing.healthy) {
      existing.lastUsed = new Date()
      existing.useCount++
      return existing.client
    }

    // Remove unhealthy connection if exists
    if (existing) {
      await this.removeConnection(key)
    }

    // Check if we've reached max connections
    if (this.connections.size >= this.config.maxConnections) {
      await this.evictLeastRecentlyUsed()
    }

    // Create new connection
    const connection = await this.createConnection(url, transport)
    this.connections.set(key, connection)

    console.info(`🔗 Created connection to ${url} using ${connection.transport} transport`)
    return connection.client
  }

  /**
   * Create a new connection with auto-negotiation
   */
  private async createConnection(
    url: string,
    preferredTransport: 'stdio' | 'http' | 'websocket' | 'tcp' | 'auto'
  ): Promise<PooledConnection> {
    const client = new Client({ name: 'duckdb-mcp-pool', version: '1.0.0' }, { capabilities: {} })

    let actualTransport: 'stdio' | 'http' | 'websocket' | 'tcp' = 'stdio'
    let clientTransport: any

    // Auto-negotiate transport based on URL or preference
    if (preferredTransport === 'auto') {
      actualTransport = this.detectTransport(url)
    } else {
      actualTransport = preferredTransport
    }

    // Try to connect with retries
    let lastError: Error | undefined
    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        clientTransport = await this.createTransport(url, actualTransport)
        await client.connect(clientTransport)

        // Connection successful
        return {
          url,
          transport: actualTransport,
          client,
          connectedAt: new Date(),
          lastUsed: new Date(),
          useCount: 1,
          healthy: true,
        }
      } catch (error) {
        lastError = error as Error
        console.warn(`Connection attempt ${attempt + 1} failed for ${url}: ${error}`)

        // Try fallback transports on auto mode
        if (preferredTransport === 'auto' && attempt < this.config.retryAttempts - 1) {
          actualTransport = this.getNextTransport(actualTransport)
        }

        // Wait before retry
        if (attempt < this.config.retryAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, this.config.retryDelay))
        }
      }
    }

    throw new Error(
      `Failed to connect to ${url} after ${this.config.retryAttempts} attempts: ${lastError}`
    )
  }

  /**
   * Create a transport based on type
   */
  private async createTransport(
    url: string,
    transport: 'stdio' | 'http' | 'websocket' | 'tcp'
  ): Promise<any> {
    const urlParts = new URL(url)

    switch (transport) {
      case 'stdio': {
        let command: string
        if (urlParts.hostname) {
          command = urlParts.hostname
        } else {
          command = urlParts.pathname.startsWith('/')
            ? urlParts.pathname
            : urlParts.pathname.slice(1)
        }

        const args = urlParts.searchParams.get('args')?.split(',') || []

        return new StdioClientTransport({
          command,
          args,
          env: process.env as Record<string, string>,
        })
      }

      case 'http': {
        const headers = this.extractHeaders(urlParts)
        const httpTransport = new HTTPTransport(url, headers)
        return new SDKTransportAdapter(httpTransport)
      }

      case 'websocket': {
        const headers = this.extractHeaders(urlParts)
        const wsTransport = new WebSocketTransport(url, headers)
        return new SDKTransportAdapter(wsTransport)
      }

      case 'tcp': {
        const host = urlParts.hostname || 'localhost'
        const port = parseInt(urlParts.port || '9999')
        const tcpTransport = new TCPTransport(host, port)
        return new SDKTransportAdapter(tcpTransport)
      }

      default:
        throw new Error(`Unsupported transport: ${transport}`)
    }
  }

  /**
   * Detect transport type from URL
   */
  private detectTransport(url: string): 'stdio' | 'http' | 'websocket' | 'tcp' {
    const protocol = new URL(url).protocol.replace(':', '')

    switch (protocol) {
      case 'stdio':
        return 'stdio'
      case 'http':
      case 'https':
        return 'http'
      case 'ws':
      case 'wss':
        return 'websocket'
      case 'tcp':
        return 'tcp'
      default:
        // Default to stdio for unknown protocols
        return 'stdio'
    }
  }

  /**
   * Get next transport to try in fallback sequence
   */
  private getNextTransport(
    current: 'stdio' | 'http' | 'websocket' | 'tcp'
  ): 'stdio' | 'http' | 'websocket' | 'tcp' {
    const sequence: Array<'stdio' | 'http' | 'websocket' | 'tcp'> = [
      'stdio',
      'http',
      'websocket',
      'tcp',
    ]
    const index = sequence.indexOf(current)
    return sequence[(index + 1) % sequence.length]
  }

  /**
   * Extract headers from URL parameters
   */
  private extractHeaders(urlParts: URL): Record<string, string> {
    const headers: Record<string, string> = {}
    urlParts.searchParams.forEach((value, key) => {
      if (key.startsWith('header_')) {
        headers[key.replace('header_', '')] = value
      }
    })
    return headers
  }

  /**
   * Remove a connection from the pool
   */
  private async removeConnection(key: string): Promise<void> {
    const connection = this.connections.get(key)
    if (connection) {
      try {
        await connection.client.close()
      } catch {
        // Ignore close errors
      }
      this.connections.delete(key)
    }
  }

  /**
   * Evict the least recently used connection
   */
  private async evictLeastRecentlyUsed(): Promise<void> {
    let lruKey: string | null = null
    let lruTime = new Date()

    for (const [key, conn] of this.connections) {
      if (conn.lastUsed < lruTime) {
        lruTime = conn.lastUsed
        lruKey = key
      }
    }

    if (lruKey) {
      await this.removeConnection(lruKey)
      console.info(`♻️ Evicted LRU connection: ${lruKey}`)
    }
  }

  /**
   * Perform health check on a connection
   */
  private async checkHealth(connection: PooledConnection): Promise<boolean> {
    try {
      // Try a simple operation to verify connection
      await connection.client.listResources()
      return true
    } catch {
      return false
    }
  }

  /**
   * Start maintenance tasks (health checks and cleanup)
   */
  private startMaintenanceTasks(): void {
    // Health check timer
    this.healthCheckTimer = setInterval(async () => {
      for (const [key, conn] of this.connections) {
        const healthy = await this.checkHealth(conn)
        if (!healthy) {
          conn.healthy = false
          console.warn(`⚠️ Connection unhealthy: ${key}`)
        }
      }
    }, this.config.healthCheckInterval)

    // Cleanup timer
    this.cleanupTimer = setInterval(async () => {
      const now = Date.now()
      const keysToRemove: string[] = []

      for (const [key, conn] of this.connections) {
        const age = now - conn.connectedAt.getTime()
        const idle = now - conn.lastUsed.getTime()

        if (age > this.config.connectionTTL || idle > this.config.idleTimeout) {
          keysToRemove.push(key)
        }
      }

      for (const key of keysToRemove) {
        await this.removeConnection(key)
        console.info(`🧹 Cleaned up connection: ${key}`)
      }
    }, this.config.idleTimeout / 2)
  }

  /**
   * Get connection key for caching
   */
  private getConnectionKey(url: string, transport: string): string {
    return `${transport}://${url}`
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalConnections: number
    healthyConnections: number
    unhealthyConnections: number
    connectionsByTransport: Record<string, number>
    averageUseCount: number
  } {
    const connections = Array.from(this.connections.values())
    const healthy = connections.filter((c) => c.healthy).length
    const unhealthy = connections.filter((c) => !c.healthy).length

    const byTransport: Record<string, number> = {}
    let totalUseCount = 0

    for (const conn of connections) {
      byTransport[conn.transport] = (byTransport[conn.transport] || 0) + 1
      totalUseCount += conn.useCount
    }

    return {
      totalConnections: connections.length,
      healthyConnections: healthy,
      unhealthyConnections: unhealthy,
      connectionsByTransport: byTransport,
      averageUseCount: connections.length > 0 ? totalUseCount / connections.length : 0,
    }
  }

  /**
   * Close all connections and stop maintenance tasks
   */
  async close(): Promise<void> {
    // Stop maintenance tasks
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }

    // Close all connections
    const closePromises: Promise<void>[] = []
    for (const [key] of this.connections) {
      closePromises.push(this.removeConnection(key))
    }

    await Promise.all(closePromises)
    console.info('🔒 Connection pool closed')
  }
}
