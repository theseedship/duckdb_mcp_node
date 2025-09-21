import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebSocketTransport } from './websocket-transport'
import { TCPTransport } from './tcp-transport'
import { HTTPTransport } from './http-transport'
import { SDKTransportAdapter } from './sdk-transport-adapter'
import { EventEmitter } from 'events'
import * as net from 'net'
import * as http from 'http'
import WebSocket from 'ws'

// Mock modules
vi.mock('ws')
vi.mock('net')
vi.mock('http')
vi.mock('https')

describe('Protocol Transports', () => {
  describe('WebSocketTransport', () => {
    let transport: WebSocketTransport
    let mockWs: any

    beforeEach(() => {
      mockWs = new EventEmitter() as any
      mockWs.send = vi.fn()
      mockWs.close = vi.fn()
      mockWs.readyState = WebSocket.OPEN
      mockWs.OPEN = WebSocket.OPEN
      mockWs.CLOSED = WebSocket.CLOSED

      vi.mocked(WebSocket).mockImplementation(() => mockWs)
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    describe('connection', () => {
      it('should connect to WebSocket server', async () => {
        transport = new WebSocketTransport('ws://localhost:8080')

        const connectPromise = transport.connect()
        mockWs.emit('open')

        await connectPromise
        expect(WebSocket).toHaveBeenCalledWith('ws://localhost:8080')
      })

      it('should handle connection with custom headers', async () => {
        transport = new WebSocketTransport('ws://localhost:8080', {
          headers: { Authorization: 'Bearer token' },
        })

        const connectPromise = transport.connect()
        mockWs.emit('open')

        await connectPromise
        expect(WebSocket).toHaveBeenCalledWith(
          'ws://localhost:8080',
          expect.objectContaining({
            headers: { Authorization: 'Bearer token' },
          })
        )
      })

      it('should handle connection errors', async () => {
        transport = new WebSocketTransport('ws://localhost:8080')

        const connectPromise = transport.connect()
        mockWs.emit('error', new Error('Connection failed'))

        await expect(connectPromise).rejects.toThrow('Connection failed')
      })

      it('should reconnect on unexpected close', async () => {
        transport = new WebSocketTransport('ws://localhost:8080', {
          reconnect: true,
          reconnectDelay: 10,
        })

        const connectPromise = transport.connect()
        mockWs.emit('open')
        await connectPromise

        // Simulate unexpected close
        mockWs.emit('close', 1006, 'Abnormal closure')

        // Wait for reconnect
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(WebSocket).toHaveBeenCalledTimes(2)
      })
    })

    describe('messaging', () => {
      beforeEach(async () => {
        transport = new WebSocketTransport('ws://localhost:8080')
        const connectPromise = transport.connect()
        mockWs.emit('open')
        await connectPromise
      })

      it('should send messages', () => {
        const message = { type: 'test', data: 'hello' }
        transport.send(message)

        expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(message))
      })

      it('should receive and parse messages', () => {
        const messageHandler = vi.fn()
        transport.on('message', messageHandler)

        const message = { type: 'response', data: 'world' }
        mockWs.emit('message', JSON.stringify(message))

        expect(messageHandler).toHaveBeenCalledWith(message)
      })

      it('should handle malformed messages', () => {
        const errorHandler = vi.fn()
        transport.on('error', errorHandler)

        mockWs.emit('message', 'invalid json{')

        expect(errorHandler).toHaveBeenCalledWith(expect.any(Error))
      })

      it('should handle ping/pong for keepalive', () => {
        const pongHandler = vi.fn()
        mockWs.pong = pongHandler

        mockWs.emit('ping')

        expect(pongHandler).toHaveBeenCalled()
      })
    })

    describe('disconnection', () => {
      it('should close connection properly', async () => {
        transport = new WebSocketTransport('ws://localhost:8080')
        const connectPromise = transport.connect()
        mockWs.emit('open')
        await connectPromise

        await transport.close()

        expect(mockWs.close).toHaveBeenCalled()
      })

      it('should handle already closed connections', async () => {
        transport = new WebSocketTransport('ws://localhost:8080')
        mockWs.readyState = WebSocket.CLOSED

        await expect(transport.close()).resolves.not.toThrow()
      })
    })
  })

  describe('TCPTransport', () => {
    let transport: TCPTransport
    let mockSocket: any

    beforeEach(() => {
      mockSocket = new EventEmitter() as any
      mockSocket.connect = vi.fn((port, host, cb) => {
        process.nextTick(cb)
      })
      mockSocket.write = vi.fn((data, cb) => {
        if (cb) process.nextTick(cb)
      })
      mockSocket.end = vi.fn()
      mockSocket.destroy = vi.fn()
      mockSocket.setEncoding = vi.fn()
      mockSocket.setNoDelay = vi.fn()
      mockSocket.setKeepAlive = vi.fn()

      vi.mocked(net.createConnection).mockReturnValue(mockSocket)
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    describe('connection', () => {
      it('should connect to TCP server', async () => {
        transport = new TCPTransport('localhost', 9999)

        await transport.connect()

        expect(net.createConnection).toHaveBeenCalledWith({
          host: 'localhost',
          port: 9999,
        })
        expect(mockSocket.setNoDelay).toHaveBeenCalledWith(true)
        expect(mockSocket.setKeepAlive).toHaveBeenCalledWith(true, 60000)
      })

      it('should handle connection errors', async () => {
        mockSocket.connect = vi.fn((port, host, cb) => {
          process.nextTick(() => mockSocket.emit('error', new Error('ECONNREFUSED')))
        })

        transport = new TCPTransport('localhost', 9999)

        await expect(transport.connect()).rejects.toThrow()
      })

      it('should handle connection timeout', async () => {
        mockSocket.connect = vi.fn(() => {
          setTimeout(() => mockSocket.emit('timeout'), 10)
        })

        transport = new TCPTransport('localhost', 9999, { timeout: 5 })

        await expect(transport.connect()).rejects.toThrow()
      })
    })

    describe('messaging', () => {
      beforeEach(async () => {
        transport = new TCPTransport('localhost', 9999)
        await transport.connect()
      })

      it('should send messages with length prefix', () => {
        const message = { type: 'request', id: 1 }
        transport.send(message)

        const json = JSON.stringify(message)
        const expectedData = Buffer.concat([Buffer.from([0, 0, 0, json.length]), Buffer.from(json)])

        expect(mockSocket.write).toHaveBeenCalledWith(expectedData, expect.any(Function))
      })

      it('should receive and parse length-prefixed messages', () => {
        const messageHandler = vi.fn()
        transport.on('message', messageHandler)

        const message = { type: 'response', id: 1 }
        const json = JSON.stringify(message)
        const data = Buffer.concat([Buffer.from([0, 0, 0, json.length]), Buffer.from(json)])

        mockSocket.emit('data', data)

        expect(messageHandler).toHaveBeenCalledWith(message)
      })

      it('should handle fragmented messages', () => {
        const messageHandler = vi.fn()
        transport.on('message', messageHandler)

        const message = { type: 'response', data: 'test' }
        const json = JSON.stringify(message)
        const lengthPrefix = Buffer.from([0, 0, 0, json.length])

        // Send length prefix first
        mockSocket.emit('data', lengthPrefix)
        // Then send partial message
        mockSocket.emit('data', Buffer.from(json.slice(0, 10)))
        // Then send rest
        mockSocket.emit('data', Buffer.from(json.slice(10)))

        expect(messageHandler).toHaveBeenCalledWith(message)
      })
    })

    describe('disconnection', () => {
      it('should close connection properly', async () => {
        transport = new TCPTransport('localhost', 9999)
        await transport.connect()

        await transport.close()

        expect(mockSocket.end).toHaveBeenCalled()
      })

      it('should handle unexpected disconnection', async () => {
        transport = new TCPTransport('localhost', 9999)
        await transport.connect()

        const closeHandler = vi.fn()
        transport.on('close', closeHandler)

        mockSocket.emit('close', false)

        expect(closeHandler).toHaveBeenCalled()
      })
    })
  })

  describe('HTTPTransport', () => {
    let transport: HTTPTransport
    let mockRequest: any
    let mockResponse: any

    beforeEach(() => {
      mockResponse = new EventEmitter() as any
      mockResponse.statusCode = 200
      mockResponse.headers = { 'content-type': 'application/json' }
      mockResponse.setEncoding = vi.fn()

      mockRequest = new EventEmitter() as any
      mockRequest.write = vi.fn()
      mockRequest.end = vi.fn()
      mockRequest.abort = vi.fn()
      mockRequest.setTimeout = vi.fn()

      vi.mocked(http.request).mockReturnValue(mockRequest)
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    describe('requests', () => {
      it('should send POST requests', async () => {
        transport = new HTTPTransport('http://localhost:3000/mcp')

        const message = { type: 'request', method: 'test' }
        const sendPromise = transport.send(message)

        // Simulate response
        mockRequest.emit('response', mockResponse)
        mockResponse.emit('data', JSON.stringify({ success: true }))
        mockResponse.emit('end')

        const result = await sendPromise

        expect(http.request).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
            }),
          }),
          expect.any(Function)
        )
        expect(mockRequest.write).toHaveBeenCalledWith(JSON.stringify(message))
        expect(result).toEqual({ success: true })
      })

      it('should handle custom headers', async () => {
        transport = new HTTPTransport('http://localhost:3000/mcp', {
          headers: { Authorization: 'Bearer token' },
        })

        const message = { type: 'request' }
        transport.send(message)

        expect(http.request).toHaveBeenCalledWith(
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer token',
              'Content-Type': 'application/json',
            }),
          }),
          expect.any(Function)
        )
      })

      it('should handle request timeout', async () => {
        transport = new HTTPTransport('http://localhost:3000/mcp', {
          timeout: 100,
        })

        const message = { type: 'request' }
        const sendPromise = transport.send(message)

        mockRequest.emit('timeout')

        await expect(sendPromise).rejects.toThrow('Request timeout')
      })

      it('should handle HTTP errors', async () => {
        transport = new HTTPTransport('http://localhost:3000/mcp')

        const message = { type: 'request' }
        const sendPromise = transport.send(message)

        mockResponse.statusCode = 500
        mockRequest.emit('response', mockResponse)
        mockResponse.emit('data', 'Internal Server Error')
        mockResponse.emit('end')

        await expect(sendPromise).rejects.toThrow('HTTP 500')
      })

      it('should handle network errors', async () => {
        transport = new HTTPTransport('http://localhost:3000/mcp')

        const message = { type: 'request' }
        const sendPromise = transport.send(message)

        mockRequest.emit('error', new Error('ECONNREFUSED'))

        await expect(sendPromise).rejects.toThrow('ECONNREFUSED')
      })
    })

    describe('long polling', () => {
      it('should support long polling for server-sent events', async () => {
        transport = new HTTPTransport('http://localhost:3000/mcp', {
          longPolling: true,
          pollingInterval: 10,
        })

        const messageHandler = vi.fn()
        transport.on('message', messageHandler)

        await transport.connect()

        // Simulate server response
        mockRequest.emit('response', mockResponse)
        mockResponse.emit('data', JSON.stringify({ type: 'event', data: 'test' }))
        mockResponse.emit('end')

        // Wait for next poll
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(messageHandler).toHaveBeenCalledWith({ type: 'event', data: 'test' })
        expect(http.request).toHaveBeenCalledTimes(2) // Initial + one poll

        await transport.close()
      })
    })
  })

  describe('SDKTransportAdapter', () => {
    let adapter: SDKTransportAdapter
    let mockTransport: any

    beforeEach(() => {
      mockTransport = {
        send: vi.fn(),
        receive: vi.fn(),
        close: vi.fn(),
      }
    })

    describe('adaptation', () => {
      it('should adapt SDK transport to internal format', async () => {
        adapter = new SDKTransportAdapter(mockTransport)

        await adapter.connect()

        const message = { type: 'request', id: 1 }
        await adapter.send(message)

        expect(mockTransport.send).toHaveBeenCalledWith(message)
      })

      it('should handle async receive operations', async () => {
        const message = { type: 'response', id: 1 }
        mockTransport.receive.mockResolvedValue(message)

        adapter = new SDKTransportAdapter(mockTransport)

        const messageHandler = vi.fn()
        adapter.on('message', messageHandler)

        await adapter.connect()
        await adapter.startReceiving()

        // Wait for receive loop
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(messageHandler).toHaveBeenCalledWith(message)
      })

      it('should handle receive errors', async () => {
        mockTransport.receive.mockRejectedValue(new Error('Receive failed'))

        adapter = new SDKTransportAdapter(mockTransport)

        const errorHandler = vi.fn()
        adapter.on('error', errorHandler)

        await adapter.connect()
        await adapter.startReceiving()

        // Wait for error
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(errorHandler).toHaveBeenCalledWith(expect.any(Error))
      })

      it('should stop receiving on close', async () => {
        adapter = new SDKTransportAdapter(mockTransport)

        await adapter.connect()
        await adapter.startReceiving()
        await adapter.close()

        expect(mockTransport.close).toHaveBeenCalled()
      })
    })

    describe('protocol compatibility', () => {
      it('should handle JSON-RPC messages', async () => {
        adapter = new SDKTransportAdapter(mockTransport)

        const jsonRpcMessage = {
          jsonrpc: '2.0',
          method: 'test',
          params: { data: 'value' },
          id: 1,
        }

        await adapter.send(jsonRpcMessage)

        expect(mockTransport.send).toHaveBeenCalledWith(jsonRpcMessage)
      })

      it('should preserve message metadata', async () => {
        adapter = new SDKTransportAdapter(mockTransport)

        const messageWithMeta = {
          type: 'request',
          id: 'abc-123',
          timestamp: Date.now(),
          meta: { clientId: 'test-client' },
        }

        await adapter.send(messageWithMeta)

        expect(mockTransport.send).toHaveBeenCalledWith(messageWithMeta)
      })
    })
  })

  describe('Transport Factory', () => {
    it('should create appropriate transport based on URL', () => {
      const wsTransport = createTransport('ws://localhost:8080')
      expect(wsTransport).toBeInstanceOf(WebSocketTransport)

      const tcpTransport = createTransport('tcp://localhost:9999')
      expect(tcpTransport).toBeInstanceOf(TCPTransport)

      const httpTransport = createTransport('http://localhost:3000')
      expect(httpTransport).toBeInstanceOf(HTTPTransport)
    })
  })
})

// Helper function for transport factory test
function createTransport(url: string) {
  const urlObj = new URL(url)
  switch (urlObj.protocol) {
    case 'ws:':
    case 'wss:':
      return new WebSocketTransport(url)
    case 'tcp:':
      return new TCPTransport(urlObj.hostname, parseInt(urlObj.port || '9999'))
    case 'http:':
    case 'https:':
      return new HTTPTransport(url)
    default:
      throw new Error(`Unsupported protocol: ${urlObj.protocol}`)
  }
}
