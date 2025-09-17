import { Socket } from 'net'
import { Transport } from './transport.js'
import { MCPMessage } from './types.js'
import { MessageFormatter } from './messages.js'

/**
 * TCP transport implementation for network MCP communication
 * Compatible with C++ duckdb_mcp TCP mode
 */
export class TCPTransport extends Transport {
  private host: string
  private port: number
  private socket?: Socket
  private connected = false
  private buffer = ''
  private messageQueue: MCPMessage[] = []
  private waitingResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = []
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private keepAliveInterval?: ReturnType<typeof setInterval>

  constructor(host: string, port: number) {
    super()
    this.host = host
    this.port = port
    this.formatter = new MessageFormatter()
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    return new Promise((resolve, reject) => {
      this.socket = new Socket()

      // Set socket options
      this.socket.setKeepAlive(true, 60000) // Keep-alive every 60 seconds
      this.socket.setNoDelay(true) // Disable Nagle algorithm for lower latency

      // Connection timeout
      const connectTimeout = setTimeout(() => {
        this.socket?.destroy()
        reject(new Error(`Connection timeout to ${this.host}:${this.port}`))
      }, 10000) // 10 second timeout

      this.socket.connect(this.port, this.host, () => {
        clearTimeout(connectTimeout)
        this.connected = true
        this.reconnectAttempts = 0
        this.reconnectDelay = 1000
        this.startKeepAlive()

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
            console.info(`✅ Connected to TCP MCP server at ${this.host}:${this.port}`)
            resolve()
          })
          .catch(reject)
      })

      // Handle incoming data
      this.socket.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('utf-8')
        this.processBuffer()
      })

      // Handle errors
      this.socket.on('error', (error: Error) => {
        console.error('TCP socket error:', error)
        if (!this.connected) {
          clearTimeout(connectTimeout)
          reject(new Error(`Failed to connect: ${error.message}`))
        }
      })

      // Handle connection close
      this.socket.on('close', (hadError: boolean) => {
        const wasConnected = this.connected
        this.connected = false
        this.stopKeepAlive()
        clearTimeout(connectTimeout)

        if (hadError) {
          console.error('TCP connection closed with error')
        } else {
          console.info('TCP connection closed')
        }

        // Attempt reconnection if it was previously connected
        if (wasConnected && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect()
        } else {
          this.resolveWaitingIterators(true)
        }
      })

      // Handle connection end
      this.socket.on('end', () => {
        console.info('TCP connection ended by server')
      })

      // Handle timeout
      this.socket.on('timeout', () => {
        console.warn('TCP socket timeout - connection may be stale')
        // Send a ping to check if connection is still alive
        this.sendPing().catch(() => {
          this.socket?.destroy()
        })
      })
    })
  }

  async disconnect(): Promise<void> {
    if (!this.connected && !this.socket) {
      return
    }

    this.stopKeepAlive()
    this.connected = false

    // Disable auto-reconnect
    this.reconnectAttempts = this.maxReconnectAttempts

    if (this.socket) {
      // Send disconnect notification if connected
      if (this.connected) {
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

      // Close the socket
      this.socket.destroy()
      this.socket = undefined
    }

    this.resolveWaitingIterators(true)
    console.info(`✅ Disconnected from TCP MCP server`)
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.connected || !this.socket) {
      throw new Error('Transport not connected')
    }

    if (this.socket.destroyed || !this.socket.writable) {
      throw new Error('TCP socket is not writable')
    }

    return new Promise((resolve, reject) => {
      const serialized = this.formatter.serialize(message)
      const data = `${serialized}\n` // Add newline delimiter

      this.socket?.write(data, 'utf-8', (error) => {
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
    return this.connected && !this.socket?.destroyed && this.socket?.writable === true
  }

  /**
   * Process the input buffer and extract complete messages
   */
  private processBuffer(): void {
    // Split buffer by newlines to find complete messages
    const lines = this.buffer.split('\n')

    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || ''

    // Process complete lines
    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = this.formatter.parseMessage(line)
          this.messageQueue.push(message)
          this.resolveWaitingIterators(false)
        } catch (error) {
          console.error('Failed to parse TCP message:', error)
        }
      }
    }
  }

  /**
   * Start keep-alive mechanism
   */
  private startKeepAlive(intervalMs: number = 30000): void {
    if (this.keepAliveInterval) {
      return
    }

    this.keepAliveInterval = setInterval(() => {
      this.sendPing().catch((error) => {
        console.error('Keep-alive ping failed:', error)
      })
    }, intervalMs)
  }

  /**
   * Stop keep-alive mechanism
   */
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = undefined
    }
  }

  /**
   * Send a ping message to check connection health
   */
  private async sendPing(): Promise<void> {
    if (!this.connected) {
      return
    }

    await this.send({
      jsonrpc: '2.0',
      method: 'ping',
      params: { timestamp: Date.now() },
      id: `ping-${Date.now()}`,
    })
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++

    console.info(
      `Attempting TCP reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms...`
    )

    setTimeout(async () => {
      try {
        await this.connect()
        console.info('✅ TCP reconnected successfully')
      } catch (error) {
        console.error('TCP reconnection failed:', error)

        // Exponential backoff with max delay of 30 seconds
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect()
        } else {
          console.error('Max TCP reconnection attempts reached')
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
   * Get socket state (for debugging)
   */
  getSocketState(): string {
    if (!this.socket) return 'NOT_CREATED'
    if (this.socket.destroyed) return 'DESTROYED'
    if (!this.socket.writable) return 'NOT_WRITABLE'
    if (!this.socket.readable) return 'NOT_READABLE'
    if (this.connected) return 'CONNECTED'
    return 'CONNECTING'
  }
}
