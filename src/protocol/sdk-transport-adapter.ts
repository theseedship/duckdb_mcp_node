import type {
  Transport as SDKTransport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js'
import { Transport } from './transport.js'

/**
 * Adapter that bridges our Transport implementation with the SDK's Transport interface
 * This allows our HTTP, WebSocket, and TCP transports to work with the MCP SDK Client
 */
export class SDKTransportAdapter implements SDKTransport {
  private transport: Transport
  private receiveTask?: Promise<void>
  private shouldStop = false
  private messageBuffer: JSONRPCMessage[] = []

  // SDK Transport callbacks
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void
  sessionId?: string
  setProtocolVersion?: (version: string) => void

  constructor(transport: Transport) {
    this.transport = transport
  }

  /**
   * Start the transport and begin processing messages
   * Maps to our connect() method and starts the receive loop
   */
  async start(): Promise<void> {
    // Connect our transport
    await this.transport.connect()

    // Start the receive loop in the background
    this.shouldStop = false
    this.receiveTask = this.receiveLoop().catch((error) => {
      // Handle receive loop errors
      if (this.onerror) {
        this.onerror(error as Error)
      }
      // Trigger close callback
      if (this.onclose) {
        this.onclose()
      }
    })
  }

  /**
   * Send a JSON-RPC message with optional settings
   * Maps to our send() method
   */
  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    try {
      // Convert JSONRPCMessage to our MCPMessage format if needed
      await this.transport.send(message as any)

      // Handle resumption token callback if provided
      if (options?.onresumptiontoken && options.resumptionToken) {
        options.onresumptiontoken(options.resumptionToken)
      }
    } catch (error) {
      if (this.onerror) {
        this.onerror(error as Error)
      }
      throw error
    }
  }

  /**
   * Close the transport connection
   * Maps to our disconnect() method
   */
  async close(): Promise<void> {
    // Stop the receive loop
    this.shouldStop = true

    // Disconnect our transport
    await this.transport.disconnect()

    // Wait for receive loop to complete
    if (this.receiveTask) {
      try {
        await this.receiveTask
      } catch {
        // Ignore errors during shutdown
      }
    }

    // Trigger close callback
    if (this.onclose) {
      this.onclose()
    }
  }

  /**
   * Background loop that receives messages from the transport
   * and delivers them via the onmessage callback
   */
  private async receiveLoop(): Promise<void> {
    while (!this.shouldStop) {
      try {
        // Check if transport has a receive() method
        if ('receive' in this.transport && typeof this.transport.receive === 'function') {
          // Try to receive messages with a timeout
          const messages = await Promise.race([
            this.transport.receive(),
            this.createTimeout(100), // 100ms polling interval
          ])

          if (messages && typeof messages === 'object' && Symbol.asyncIterator in messages) {
            // Process async iterator of messages
            const iterator = messages as AsyncIterableIterator<any>
            for await (const message of iterator) {
              if (this.shouldStop) break

              // Deliver message via callback
              if (this.onmessage) {
                this.onmessage(message as JSONRPCMessage)
              }
            }
          } else if (messages && typeof messages === 'object') {
            // Single message - cast through unknown for safety
            if (this.onmessage) {
              this.onmessage(messages as unknown as JSONRPCMessage)
            }
          }
        } else {
          // For transports without receive(), just wait
          await this.createTimeout(100)
        }
      } catch (error) {
        // Handle timeout or other errors
        if (!this.shouldStop && error instanceof Error && !error.message.includes('timeout')) {
          if (this.onerror) {
            this.onerror(error)
          }
          // Break on non-timeout errors
          break
        }
      }
    }
  }

  /**
   * Create a timeout promise for polling
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), ms)
    })
  }

  /**
   * Check if the underlying transport is connected
   */
  isConnected(): boolean {
    return this.transport.isConnected()
  }

  /**
   * Get the underlying transport for debugging
   */
  getUnderlyingTransport(): Transport {
    return this.transport
  }
}

/**
 * Factory function to create an SDK-compatible transport from our transport
 */
export function createSDKTransport(transport: Transport): SDKTransport {
  return new SDKTransportAdapter(transport)
}
