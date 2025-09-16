import { Readable, Writable } from 'stream'
import { MCPMessage } from './types.js'
import { MessageFormatter } from './messages.js'

/**
 * Abstract transport interface for MCP communication
 */
export abstract class Transport {
  protected formatter = new MessageFormatter()

  abstract connect(): Promise<void>
  abstract disconnect(): Promise<void>
  abstract send(message: MCPMessage): Promise<void>
  abstract receive(): AsyncIterator<MCPMessage>
  abstract isConnected(): boolean
}

/**
 * Stdio transport implementation for process communication
 */
export class StdioTransport extends Transport {
  private input: Readable
  private output: Writable
  private connected = false
  private buffer = ''
  private messageQueue: MCPMessage[] = []
  private waitingResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = []

  constructor(input?: Readable, output?: Writable) {
    super()
    this.input = input || process.stdin
    this.output = output || process.stdout
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    // Set up input stream handling
    this.input.setEncoding('utf-8')

    this.input.on('data', (chunk: string) => {
      this.buffer += chunk
      this.processBuffer()
    })

    this.input.on('end', () => {
      this.connected = false
      this.resolveWaitingIterators(true)
    })

    this.input.on('error', (error) => {
      console.error('Stdio input error:', error)
      this.connected = false
      this.resolveWaitingIterators(true)
    })

    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return
    }

    this.connected = false
    this.resolveWaitingIterators(true)

    // Don't close stdin/stdout as they belong to the process
    if (this.input !== process.stdin) {
      this.input.destroy()
    }
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected')
    }

    const serialized = this.formatter.serialize(message)
    const data = `${serialized}\n`

    return new Promise((resolve, reject) => {
      this.output.write(data, (error) => {
        if (error) {
          reject(error)
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
    return this.connected
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
          console.error('Failed to parse message:', error)
        }
      }
    }
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
}

/**
 * TCP transport implementation for network communication
 */
export class TCPTransport extends Transport {
  private host: string
  private port: number
  private socket: unknown // Will be implemented when needed
  private connected = false

  constructor(host: string, port: number) {
    super()
    this.host = host
    this.port = port
  }

  async connect(): Promise<void> {
    // TODO: Implement TCP connection
    throw new Error('TCP transport not yet implemented')
  }

  async disconnect(): Promise<void> {
    // TODO: Implement TCP disconnection
    throw new Error('TCP transport not yet implemented')
  }

  async send(message: MCPMessage): Promise<void> {
    void message // Suppress unused parameter warning
    // TODO: Implement TCP send
    throw new Error('TCP transport not yet implemented')
  }

  async *receive(): AsyncIterator<MCPMessage> {
    // TODO: Implement TCP receive
    // Yield statement to satisfy generator requirement (unreachable)
    yield undefined as never
    throw new Error('TCP transport not yet implemented')
  }

  isConnected(): boolean {
    return this.connected
  }
}

/**
 * WebSocket transport implementation for real-time communication
 */
export class WebSocketTransport extends Transport {
  private url: string
  private ws: unknown // Will be implemented when needed
  private connected = false

  constructor(url: string) {
    super()
    this.url = url
  }

  async connect(): Promise<void> {
    // TODO: Implement WebSocket connection
    throw new Error('WebSocket transport not yet implemented')
  }

  async disconnect(): Promise<void> {
    // TODO: Implement WebSocket disconnection
    throw new Error('WebSocket transport not yet implemented')
  }

  async send(message: MCPMessage): Promise<void> {
    void message // Suppress unused parameter warning
    // TODO: Implement WebSocket send
    throw new Error('WebSocket transport not yet implemented')
  }

  async *receive(): AsyncIterator<MCPMessage> {
    // TODO: Implement WebSocket receive
    // Yield statement to satisfy generator requirement (unreachable)
    yield undefined as never
    throw new Error('WebSocket transport not yet implemented')
  }

  isConnected(): boolean {
    return this.connected
  }
}
