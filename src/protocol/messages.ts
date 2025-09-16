import {
  MCPRequest,
  MCPResponse,
  MCPNotification,
  JSONRPCId,
  ErrorCode,
  MCPRequestSchema,
  MCPResponseSchema,
  MCPNotificationSchema,
} from './types.js'

/**
 * Message formatter for MCP protocol
 */
export class MessageFormatter {
  private requestId = 0

  /**
   * Generate a unique request ID
   */
  private generateId(): string {
    return `req_${Date.now()}_${++this.requestId}`
  }

  /**
   * Format a request message
   */
  formatRequest(method: string, params?: Record<string, any>): MCPRequest {
    return {
      jsonrpc: '2.0',
      method,
      params,
      id: this.generateId(),
    }
  }

  /**
   * Format a notification message (no ID, no response expected)
   */
  formatNotification(method: string, params?: Record<string, any>): MCPNotification {
    return {
      jsonrpc: '2.0',
      method,
      params,
    }
  }

  /**
   * Format a success response
   */
  formatResponse(id: JSONRPCId, result: any): MCPResponse {
    return {
      jsonrpc: '2.0',
      result,
      id,
    }
  }

  /**
   * Format an error response
   */
  formatError(id: JSONRPCId, code: ErrorCode, message: string, data?: any): MCPResponse {
    return {
      jsonrpc: '2.0',
      error: {
        code,
        message,
        data,
      },
      id,
    }
  }

  /**
   * Parse and validate an incoming message
   */
  parseMessage(data: string): MCPRequest | MCPResponse | MCPNotification {
    try {
      const json = JSON.parse(data)

      // Try to parse as request first
      if ('method' in json && 'id' in json) {
        return MCPRequestSchema.parse(json)
      }

      // Try to parse as notification
      if ('method' in json && !('id' in json)) {
        return MCPNotificationSchema.parse(json)
      }

      // Try to parse as response
      if (('result' in json || 'error' in json) && 'id' in json) {
        return MCPResponseSchema.parse(json)
      }

      throw new Error('Invalid message format')
    } catch (error) {
      throw new Error(`Failed to parse message: ${error}`)
    }
  }

  /**
   * Serialize a message to JSON string
   */
  serialize(message: MCPRequest | MCPResponse | MCPNotification): string {
    return JSON.stringify(message)
  }

  /**
   * Check if a message is a request
   */
  isRequest(message: any): message is MCPRequest {
    return 'method' in message && 'id' in message
  }

  /**
   * Check if a message is a notification
   */
  isNotification(message: any): message is MCPNotification {
    return 'method' in message && !('id' in message)
  }

  /**
   * Check if a message is a response
   */
  isResponse(message: any): message is MCPResponse {
    return ('result' in message || 'error' in message) && 'id' in message
  }

  /**
   * Check if a response is an error
   */
  isErrorResponse(response: MCPResponse): boolean {
    return 'error' in response && response.error !== undefined
  }
}

/**
 * Message router for handling different message types
 */
export class MessageRouter {
  private handlers = new Map<string, (params: any) => Promise<any>>()
  private formatter = new MessageFormatter()

  /**
   * Register a method handler
   */
  registerHandler(method: string, handler: (_params: any) => Promise<any>) {
    this.handlers.set(method, handler)
  }

  /**
   * Route a request to the appropriate handler
   */
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const handler = this.handlers.get(request.method)

    if (!handler) {
      return this.formatter.formatError(
        request.id,
        ErrorCode.MethodNotFound,
        `Method not found: ${request.method}`
      )
    }

    try {
      const result = await handler(request.params || {})
      return this.formatter.formatResponse(request.id, result)
    } catch (error: any) {
      return this.formatter.formatError(
        request.id,
        ErrorCode.InternalError,
        error.message || 'Internal error',
        error.stack
      )
    }
  }

  /**
   * Handle a notification (no response)
   */
  async handleNotification(notification: MCPNotification): Promise<void> {
    const handler = this.handlers.get(notification.method)

    if (!handler) {
      // Notifications don't send error responses
      console.warn(`No handler for notification: ${notification.method}`)
      return
    }

    try {
      await handler(notification.params || {})
    } catch (error) {
      // Log error but don't send response for notifications
      console.error(`Error handling notification ${notification.method}:`, error)
    }
  }
}

/**
 * Correlation tracker for matching requests with responses
 */
export class CorrelationTracker {
  private pendingRequests = new Map<
    JSONRPCId,
    {
      resolve: (_response: MCPResponse) => void
      reject: (_error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()

  /**
   * Track a request and return a promise that resolves with the response
   */
  trackRequest(id: JSONRPCId, timeoutMs: number = 30000): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timeout })
    })
  }

  /**
   * Resolve a pending request with a response
   */
  resolveRequest(response: MCPResponse) {
    const pending = this.pendingRequests.get(response.id)

    if (!pending) {
      console.warn(`No pending request for response ID: ${response.id}`)
      return
    }

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(response.id)
    pending.resolve(response)
  }

  /**
   * Cancel a pending request
   */
  cancelRequest(id: JSONRPCId) {
    const pending = this.pendingRequests.get(id)

    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(id)
      pending.reject(new Error(`Request ${id} cancelled`))
    }
  }

  /**
   * Cancel all pending requests
   */
  cancelAll() {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(`Request ${id} cancelled`))
    }
    this.pendingRequests.clear()
  }
}
