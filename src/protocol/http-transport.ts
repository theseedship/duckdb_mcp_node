import axios, { AxiosInstance } from 'axios'
import { Transport } from './transport.js'
import { MCPMessage } from './types.js'
import { MessageFormatter } from './messages.js'
import { logger } from '../utils/logger.js'

/**
 * HTTP transport implementation for MCP communication
 * Compatible with Python mcp-server-motherduck HTTP mode
 */
export class HTTPTransport extends Transport {
  private url: string
  private client: AxiosInstance
  private connected = false
  private messageQueue: MCPMessage[] = []
  private waitingResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = []
  private sessionId?: string
  private pollInterval?: ReturnType<typeof setInterval>
  private headers: Record<string, string>

  constructor(url: string, headers: Record<string, string> = {}) {
    super()
    this.url = url
    this.headers = headers
    this.formatter = new MessageFormatter()

    // Create axios client with default config
    this.client = axios.create({
      baseURL: this.url,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      timeout: 30000, // 30 second timeout
    })
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    try {
      // Initialize connection with server
      const response = await this.client.post('/mcp/initialize', {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {
            roots: {},
          },
          clientInfo: {
            name: 'duckdb-mcp-http-client',
            version: '1.0.0',
          },
        },
        id: 'init-' + Date.now(),
      })

      // Extract the result from the JSON-RPC response
      const result = response.data.result || response.data

      if (result.sessionId) {
        this.sessionId = result.sessionId
        if (this.client.defaults.headers && this.sessionId) {
          this.client.defaults.headers['X-Session-ID'] = this.sessionId
        }
      }

      this.connected = true

      // Start polling for messages if server supports server-sent events
      if (result.capabilities?.serverSentEvents) {
        this.startPolling()
      }

      logger.info(`✅ Connected to HTTP MCP server at ${this.url}`)
    } catch (error) {
      this.connected = false
      throw new Error(`Failed to connect to HTTP server: ${error}`)
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return
    }

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = undefined
    }

    try {
      // Notify server of disconnection
      if (this.sessionId) {
        await this.client
          .post('/mcp/disconnect', {
            sessionId: this.sessionId,
          })
          .catch(() => {}) // Ignore disconnect errors
      }
    } finally {
      this.connected = false
      this.sessionId = undefined
      this.resolveWaitingIterators(true)
      logger.info(`✅ Disconnected from HTTP MCP server`)
    }
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected')
    }

    try {
      // Send message as JSON-RPC request
      const response = await this.client.post('/mcp/message', message)

      // If response contains a message, add it to queue
      if (response.data && response.data.jsonrpc) {
        this.messageQueue.push(response.data)
        this.resolveWaitingIterators(false)
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`HTTP send failed: ${error.message}`)
      }
      throw error
    }
  }

  async *receive(): AsyncIterator<MCPMessage> {
    while (this.connected || this.messageQueue.length > 0) {
      // If we have messages in queue, yield them
      if (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift()
        if (message) {
          yield message
        }
      } else {
        // Wait for next message
        const result = await this.waitForMessage()
        if (result.done) {
          return
        }
        yield result.value
      }
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  /**
   * Start polling for server-sent messages
   */
  private startPolling(intervalMs: number = 1000): void {
    if (this.pollInterval) {
      return
    }

    this.pollInterval = setInterval(async () => {
      if (!this.connected || !this.sessionId) {
        return
      }

      try {
        const response = await this.client.get('/mcp/poll', {
          params: { sessionId: this.sessionId },
        })

        if (response.data && Array.isArray(response.data.messages)) {
          for (const message of response.data.messages) {
            this.messageQueue.push(message)
          }
          if (response.data.messages.length > 0) {
            this.resolveWaitingIterators(false)
          }
        }
      } catch {
        // Ignore polling errors, will retry on next interval
      }
    }, intervalMs)
  }

  /**
   * Wait for the next message
   */
  private waitForMessage(): Promise<IteratorResult<MCPMessage>> {
    return new Promise((resolve) => {
      if (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift()
        if (message) {
          resolve({ value: message, done: false })
        }
      } else if (!this.connected) {
        resolve({ done: true, value: undefined })
      } else {
        this.waitingResolvers.push(resolve)
      }
    })
  }

  /**
   * Resolve waiting iterators when new messages arrive or connection closes
   */
  private resolveWaitingIterators(done: boolean): void {
    while (this.waitingResolvers.length > 0 && (done || this.messageQueue.length > 0)) {
      const resolver = this.waitingResolvers.shift()
      if (!resolver) continue

      if (done) {
        resolver({ done: true, value: undefined })
      } else if (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift()
        if (message) {
          resolver({ value: message, done: false })
        }
      }
    }
  }

  /**
   * Execute a request-response pattern (convenience method)
   */
  async request(method: string, params?: any): Promise<any> {
    if (!this.connected) {
      throw new Error('Transport not connected')
    }

    try {
      const response = await this.client.post('/mcp/request', {
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now().toString(),
      })

      if (response.data.error) {
        throw new Error(response.data.error.message || 'Request failed')
      }

      return response.data.result
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`HTTP request failed: ${error.message}`)
      }
      throw error
    }
  }
}
