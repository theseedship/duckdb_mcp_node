import WebSocket from 'ws'
import { Transport } from './transport.js'
import { MCPMessage } from './types.js'
import { MessageFormatter } from './messages.js'
import { logger } from '../utils/logger.js'

/**
 * WebSocket transport implementation for real-time MCP communication
 * Compatible with Python mcp-server-motherduck WebSocket mode
 */
export class WebSocketTransport extends Transport {
  private url: string
  private ws?: WebSocket
  private connected = false
  private messageQueue: MCPMessage[] = []
  private waitingResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = []
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000 // Start with 1 second
  private pingInterval?: ReturnType<typeof setInterval>
  private headers: Record<string, string>

  constructor(url: string, headers: Record<string, string> = {}) {
    super()
    this.url = url
    this.headers = headers
    this.formatter = new MessageFormatter()
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    return new Promise((resolve, reject) => {
      try {
        // Create WebSocket with headers
        this.ws = new WebSocket(this.url, {
          headers: this.headers,
          perMessageDeflate: false, // Disable compression for better latency
        })

        // Set up event handlers
        this.ws.on('open', () => {
          this.connected = true
          this.reconnectAttempts = 0
          this.reconnectDelay = 1000
          this.startPingInterval()

          // Send initialization message
          this.send({
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
              protocolVersion: '1.0.0',
              capabilities: {
                resources: true,
                tools: true,
              },
            },
            id: 'init',
          })
            .then(() => {
              logger.info(`✅ Connected to WebSocket MCP server at ${this.url}`)
              resolve()
            })
            .catch(reject)
        })

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const text = data.toString()
            const message = this.formatter.parseMessage(text)
            this.messageQueue.push(message)
            this.resolveWaitingIterators(false)
          } catch (error) {
            logger.error('Failed to parse WebSocket message:', error)
          }
        })

        this.ws.on('error', (error: Error) => {
          logger.error('WebSocket error:', error)
          if (!this.connected) {
            reject(new Error(`Failed to connect: ${error.message}`))
          }
        })

        this.ws.on('close', (code: number, reason: Buffer) => {
          const wasConnected = this.connected
          this.connected = false
          this.stopPingInterval()

          logger.info(`WebSocket closed: ${code} - ${reason.toString()}`)

          // Attempt reconnection if it was previously connected
          if (wasConnected && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect()
          } else {
            this.resolveWaitingIterators(true)
          }
        })

        this.ws.on('ping', () => {
          // Respond to ping with pong (ws library handles this automatically)
        })

        this.ws.on('pong', () => {
          // Server responded to our ping
        })
      } catch (error) {
        reject(new Error(`Failed to create WebSocket: ${error}`))
      }
    })
  }

  async disconnect(): Promise<void> {
    if (!this.connected && !this.ws) {
      return
    }

    this.stopPingInterval()
    this.connected = false

    // Disable auto-reconnect
    this.reconnectAttempts = this.maxReconnectAttempts

    if (this.ws) {
      // Send disconnect notification if connected
      if (this.ws.readyState === WebSocket.OPEN) {
        try {
          await this.send({
            jsonrpc: '2.0',
            method: 'disconnect',
            params: {},
            id: 'disconnect',
          })
        } catch {
          // Ignore send errors during disconnect
        }
      }

      // Close the WebSocket
      this.ws.close(1000, 'Client disconnect')
      this.ws = undefined
    }

    this.resolveWaitingIterators(true)
    logger.info(`✅ Disconnected from WebSocket MCP server`)
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.connected || !this.ws) {
      throw new Error('Transport not connected')
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }

    return new Promise((resolve, reject) => {
      const serialized = this.formatter.serialize(message)

      this.ws?.send(serialized, (error) => {
        if (error) {
          reject(new Error(`Failed to send message: ${error.message}`))
        } else {
          resolve()
        }
      })
    })
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
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Start sending periodic ping messages to keep connection alive
   */
  private startPingInterval(intervalMs: number = 30000): void {
    if (this.pingInterval) {
      return
    }

    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping((error?: Error) => {
          if (error) {
            logger.error('Ping failed:', error)
          }
        })
      }
    }, intervalMs)
  }

  /**
   * Stop the ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = undefined
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++

    logger.info(
      `Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms...`
    )

    setTimeout(async () => {
      try {
        await this.connect()
        logger.info('✅ Reconnected successfully')
      } catch (error) {
        logger.error('Reconnection failed:', error)

        // Exponential backoff with max delay of 30 seconds
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect()
        } else {
          logger.error('Max reconnection attempts reached')
          this.resolveWaitingIterators(true)
        }
      }
    }, this.reconnectDelay)
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
   * Get WebSocket ready state (for debugging)
   */
  getReadyState(): string {
    if (!this.ws) return 'NOT_CREATED'

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'CONNECTING'
      case WebSocket.OPEN:
        return 'OPEN'
      case WebSocket.CLOSING:
        return 'CLOSING'
      case WebSocket.CLOSED:
        return 'CLOSED'
      default:
        return 'UNKNOWN'
    }
  }
}
