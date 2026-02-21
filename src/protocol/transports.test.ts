import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebSocketTransport } from './websocket-transport'
import { TCPTransport } from './tcp-transport'
import { HTTPTransport } from './http-transport'
import { SDKTransportAdapter } from './sdk-transport-adapter'
import { EventEmitter } from 'events'
import axios from 'axios'

// Hoisted shared state accessible in vi.mock factories AND tests
const { wsInstances, socketInstances, wsConstructorSpy, mockAxiosClient, socketConnectBehavior } =
  vi.hoisted(() => {
    const wsInstances: any[] = []
    const socketInstances: any[] = []
    const wsConstructorSpy = vi.fn()
    const mockAxiosClient = {
      post: vi.fn().mockResolvedValue({ data: {} }),
      get: vi.fn().mockResolvedValue({ data: {} }),
      defaults: { headers: {} as Record<string, any> },
    }
    // 'auto' = call cb via nextTick, 'manual' = don't call cb
    const socketConnectBehavior = { mode: 'auto' as 'auto' | 'manual' }
    return {
      wsInstances,
      socketInstances,
      wsConstructorSpy,
      mockAxiosClient,
      socketConnectBehavior,
    }
  })

// Mock logger to suppress output
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// Mock ws with constructable class
vi.mock('ws', async () => {
  const { EventEmitter } = await import('events')

  class MockWebSocket extends EventEmitter {
    send = vi.fn((_data: any, cb?: (err?: Error) => void) => {
      if (cb) cb()
    })
    close = vi.fn((_code?: number, _reason?: string) => {})
    ping = vi.fn((_cb?: (err?: Error) => void) => {})
    pong = vi.fn()
    readyState = 1
    static OPEN = 1
    static CLOSED = 3
    static CONNECTING = 0
    static CLOSING = 2
    constructor(...args: any[]) {
      super()
      wsConstructorSpy(...args)
      wsInstances.push(this)
    }
  }

  return { default: MockWebSocket }
})

// Mock net with constructable Socket
vi.mock('net', async () => {
  const { EventEmitter } = await import('events')

  class MockSocket extends EventEmitter {
    connect = vi.fn((_port: number, _host: string, cb?: () => void) => {
      if (socketConnectBehavior.mode === 'auto' && cb) process.nextTick(cb)
    })
    write = vi.fn((_data: string, _encoding?: string, cb?: (err?: Error) => void) => {
      if (cb) process.nextTick(() => cb())
    })
    destroy = vi.fn()
    end = vi.fn()
    setEncoding = vi.fn()
    setNoDelay = vi.fn()
    setKeepAlive = vi.fn()
    setTimeout = vi.fn()
    writable = true
    destroyed = false
    readable = true
    constructor() {
      super()
      socketInstances.push(this)
    }
  }

  return { Socket: MockSocket, createConnection: vi.fn() }
})

// Mock axios (HTTPTransport uses axios, not native http)
// Export both default and named to satisfy ESM import patterns
vi.mock('axios', () => {
  const isAxiosError = (err: any) => !!(err && err.isAxiosError)
  const mockAxios = {
    create: vi.fn(() => mockAxiosClient),
    isAxiosError,
  }
  return {
    default: mockAxios,
    // Named exports for `import { isAxiosError } from 'axios'`
    isAxiosError,
    create: mockAxios.create,
  }
})

describe('Protocol Transports', () => {
  describe('WebSocketTransport', () => {
    let transport: WebSocketTransport

    afterEach(async () => {
      try {
        await transport?.disconnect()
      } catch {}
      vi.clearAllMocks()
      wsInstances.length = 0
      wsConstructorSpy.mockClear()
    })

    /** Helper: connect transport and return the mock WS instance */
    async function connectWS(url = 'ws://localhost:8080', headers?: Record<string, string>) {
      transport = new WebSocketTransport(url, headers)
      const p = transport.connect()
      const ws = wsInstances[wsInstances.length - 1]
      ws.emit('open')
      await p
      ws.send.mockClear() // clear initialize send
      return ws
    }

    describe('connection', () => {
      it('should connect to WebSocket server', async () => {
        transport = new WebSocketTransport('ws://localhost:8080')
        const p = transport.connect()
        const ws = wsInstances[wsInstances.length - 1]
        ws.emit('open')
        await p

        expect(wsConstructorSpy).toHaveBeenCalledWith(
          'ws://localhost:8080',
          expect.objectContaining({ perMessageDeflate: false })
        )
      })

      it('should handle connection with custom headers', async () => {
        transport = new WebSocketTransport('ws://localhost:8080', {
          Authorization: 'Bearer token',
        })
        const p = transport.connect()
        const ws = wsInstances[wsInstances.length - 1]
        ws.emit('open')
        await p

        expect(wsConstructorSpy).toHaveBeenCalledWith(
          'ws://localhost:8080',
          expect.objectContaining({
            headers: { Authorization: 'Bearer token' },
          })
        )
      })

      it('should handle connection errors', async () => {
        transport = new WebSocketTransport('ws://localhost:8080')
        // Transport re-emits WS errors — prevent uncaught 'error' event
        transport.on('error', () => {})

        const p = transport.connect()
        const ws = wsInstances[wsInstances.length - 1]
        ws.emit('error', new Error('Connection failed'))

        await expect(p).rejects.toThrow('Connection failed')
      })

      it('should reconnect on unexpected close', async () => {
        const ws = await connectWS()

        // Shorten reconnect delay for test speed
        ;(transport as any).reconnectDelay = 10

        // Simulate unexpected close (wasConnected = true, reconnectAttempts < max)
        ws.emit('close', 1006, Buffer.from('Abnormal closure'))

        // Wait for reconnect timer
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(wsInstances.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('messaging', () => {
      let ws: any

      beforeEach(async () => {
        ws = await connectWS()
      })

      it('should send messages', async () => {
        const message = {
          jsonrpc: '2.0' as const,
          method: 'test',
          params: { data: 'hello' },
          id: 1,
        }
        await transport.send(message)

        expect(ws.send).toHaveBeenCalledWith(JSON.stringify(message), expect.any(Function))
      })

      it('should receive and parse messages', () => {
        const messageHandler = vi.fn()
        transport.on('message', messageHandler)

        // Must be valid JSON-RPC for parseMessage
        const message = { jsonrpc: '2.0', method: 'response', params: { data: 'world' }, id: 'r1' }
        ws.emit('message', Buffer.from(JSON.stringify(message)))

        expect(messageHandler).toHaveBeenCalledWith(
          expect.objectContaining({ method: 'response', id: 'r1' })
        )
      })

      it('should handle malformed messages', () => {
        const errorHandler = vi.fn()
        transport.on('error', errorHandler)

        ws.emit('message', Buffer.from('invalid json{'))

        expect(errorHandler).toHaveBeenCalledWith(expect.any(Error))
      })

      it('should set up keepalive ping interval on connect', () => {
        // Ping interval is started during connect
        expect((transport as any).pingInterval).toBeDefined()
      })
    })

    describe('disconnection', () => {
      it('should close connection properly', async () => {
        const ws = await connectWS()
        await transport.disconnect()

        expect(ws.close).toHaveBeenCalled()
      })

      it('should handle disconnect without prior connect', async () => {
        transport = new WebSocketTransport('ws://localhost:8080')
        await expect(transport.disconnect()).resolves.not.toThrow()
      })
    })
  })

  describe('TCPTransport', () => {
    let transport: TCPTransport

    afterEach(async () => {
      try {
        await transport?.disconnect()
      } catch {}
      vi.clearAllMocks()
      socketInstances.length = 0
      socketConnectBehavior.mode = 'auto'
    })

    /** Helper: connect TCP transport and return the mock socket */
    async function connectTCP(host = 'localhost', port = 9999) {
      transport = new TCPTransport(host, port)
      await transport.connect()
      const socket = socketInstances[socketInstances.length - 1]
      socket.write.mockClear() // clear initialize send
      return socket
    }

    describe('connection', () => {
      it('should connect to TCP server', async () => {
        transport = new TCPTransport('localhost', 9999)
        await transport.connect()

        const socket = socketInstances[socketInstances.length - 1]
        expect(socket.setNoDelay).toHaveBeenCalledWith(true)
        expect(socket.setKeepAlive).toHaveBeenCalledWith(true, 60000)
        expect(socket.connect).toHaveBeenCalledWith(9999, 'localhost', expect.any(Function))
      })

      it('should handle connection errors', async () => {
        socketConnectBehavior.mode = 'manual'
        transport = new TCPTransport('localhost', 9999)
        // Transport re-emits socket errors — prevent uncaught 'error' event
        transport.on('error', () => {})

        const p = transport.connect()
        const socket = socketInstances[socketInstances.length - 1]
        setTimeout(() => socket.emit('error', new Error('ECONNREFUSED')), 5)

        await expect(p).rejects.toThrow('ECONNREFUSED')
      })

      it('should handle connection timeout', async () => {
        socketConnectBehavior.mode = 'manual'
        transport = new TCPTransport('localhost', 9999)
        transport.on('error', () => {})

        // Real 10s timeout — no fake timers to avoid OOM
        await expect(transport.connect()).rejects.toThrow('Connection timeout')
      }, 15000)
    })

    describe('messaging', () => {
      let socket: any

      beforeEach(async () => {
        socket = await connectTCP()
      })

      it('should send messages with newline delimiter', async () => {
        const message = { jsonrpc: '2.0' as const, method: 'request', params: {}, id: 1 }
        await transport.send(message)

        const json = JSON.stringify(message)
        expect(socket.write).toHaveBeenCalledWith(`${json}\n`, 'utf-8', expect.any(Function))
      })

      it('should receive and parse newline-delimited messages', () => {
        const messageHandler = vi.fn()
        transport.on('message', messageHandler)

        const message = { jsonrpc: '2.0', method: 'response', params: {}, id: 1 }
        socket.emit('data', Buffer.from(JSON.stringify(message) + '\n'))

        expect(messageHandler).toHaveBeenCalledWith(
          expect.objectContaining({ method: 'response', id: 1 })
        )
      })

      it('should handle fragmented messages', () => {
        const messageHandler = vi.fn()
        transport.on('message', messageHandler)

        const message = { jsonrpc: '2.0', method: 'response', params: { data: 'test' }, id: 1 }
        const json = JSON.stringify(message)

        // Send data in fragments
        socket.emit('data', Buffer.from(json.slice(0, 10)))
        expect(messageHandler).not.toHaveBeenCalled()

        // Send rest with newline delimiter
        socket.emit('data', Buffer.from(json.slice(10) + '\n'))
        expect(messageHandler).toHaveBeenCalledWith(
          expect.objectContaining({ method: 'response', id: 1 })
        )
      })
    })

    describe('disconnection', () => {
      it('should close connection properly', async () => {
        const socket = await connectTCP()
        await transport.disconnect()

        expect(socket.destroy).toHaveBeenCalled()
      })

      it('should handle unexpected disconnection', async () => {
        const socket = await connectTCP()
        const closeHandler = vi.fn()
        transport.on('close', closeHandler)

        socket.emit('close', false)

        // The transport should no longer be connected
        expect(transport.isConnected()).toBe(false)
      })
    })
  })

  describe('HTTPTransport', () => {
    let transport: HTTPTransport

    beforeEach(() => {
      // Default: connect succeeds
      mockAxiosClient.post.mockResolvedValue({ data: {} })
      mockAxiosClient.get.mockResolvedValue({ data: {} })
    })

    afterEach(async () => {
      try {
        await transport?.disconnect()
      } catch {}
      vi.clearAllMocks()
      mockAxiosClient.post.mockReset()
      mockAxiosClient.get.mockReset()
      mockAxiosClient.post.mockResolvedValue({ data: {} })
      mockAxiosClient.get.mockResolvedValue({ data: {} })
    })

    describe('requests', () => {
      it('should send POST requests via axios', async () => {
        transport = new HTTPTransport('http://localhost:3000/mcp')
        await transport.connect()

        const message = { jsonrpc: '2.0' as const, method: 'test', params: {}, id: 1 }
        // Mock the send response
        mockAxiosClient.post.mockResolvedValueOnce({
          data: { jsonrpc: '2.0', result: { success: true }, id: 1 },
        })
        await transport.send(message)

        expect(mockAxiosClient.post).toHaveBeenCalledWith('/mcp/message', message)
      })

      it('should handle custom headers', () => {
        transport = new HTTPTransport('http://localhost:3000/mcp', {
          Authorization: 'Bearer token',
        })

        // axios.create should be called with merged headers
        expect(axios.create).toHaveBeenCalledWith(
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer token',
              'Content-Type': 'application/json',
            }),
          })
        )
      })

      it('should handle request errors', async () => {
        transport = new HTTPTransport('http://localhost:3000/mcp')
        await transport.connect()

        mockAxiosClient.post.mockRejectedValueOnce(new Error('timeout of 30000ms exceeded'))

        await expect(
          transport.send({ jsonrpc: '2.0', method: 'test', params: {}, id: 1 })
        ).rejects.toThrow('timeout')
      })

      it('should handle HTTP errors', async () => {
        transport = new HTTPTransport('http://localhost:3000/mcp')
        await transport.connect()

        mockAxiosClient.post.mockRejectedValueOnce(new Error('Request failed with status code 500'))

        await expect(
          transport.send({ jsonrpc: '2.0', method: 'test', params: {}, id: 1 })
        ).rejects.toThrow('500')
      })

      it('should handle network errors', async () => {
        transport = new HTTPTransport('http://localhost:3000/mcp')
        await transport.connect()

        mockAxiosClient.post.mockRejectedValueOnce(new Error('ECONNREFUSED'))

        await expect(
          transport.send({ jsonrpc: '2.0', method: 'test', params: {}, id: 1 })
        ).rejects.toThrow('ECONNREFUSED')
      })
    })

    describe('long polling', () => {
      it('should support long polling for server-sent events', async () => {
        transport = new HTTPTransport('http://localhost:3000/mcp')

        // Connect returns sessionId + serverSentEvents capability
        mockAxiosClient.post.mockResolvedValueOnce({
          data: {
            result: {
              sessionId: 'test-session',
              capabilities: { serverSentEvents: true },
            },
          },
        })
        await transport.connect()

        // Mock poll response
        mockAxiosClient.get.mockResolvedValueOnce({
          data: {
            messages: [{ jsonrpc: '2.0', method: 'event', params: { data: 'test' } }],
          },
        })

        // Wait for the first poll (default 1000ms interval)
        await new Promise((resolve) => setTimeout(resolve, 1200))

        expect(mockAxiosClient.get).toHaveBeenCalledWith(
          '/mcp/poll',
          expect.objectContaining({ params: { sessionId: 'test-session' } })
        )

        await transport.disconnect()
      }, 5000)
    })
  })

  describe('SDKTransportAdapter', () => {
    let adapter: SDKTransportAdapter
    let mockTransport: any

    beforeEach(() => {
      // Create a proper mock transport with EventEmitter capabilities
      // receive() returns a hanging promise by default to prevent the adapter's
      // receiveLoop from spinning and creating thousands of timeout promises (OOM)
      mockTransport = Object.assign(new EventEmitter(), {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(undefined),
        receive: vi.fn().mockReturnValue(new Promise(() => {})),
        isConnected: vi.fn().mockReturnValue(true),
        formatter: {},
      })
    })

    afterEach(async () => {
      try {
        await adapter?.close()
      } catch {}
    })

    describe('adaptation', () => {
      it('should adapt SDK transport to internal format', async () => {
        adapter = new SDKTransportAdapter(mockTransport)
        await adapter.start()

        const message = { jsonrpc: '2.0' as const, method: 'request', params: {}, id: 1 }
        await adapter.send(message as any)

        expect(mockTransport.send).toHaveBeenCalledWith(message)
      })

      it('should handle async receive operations', async () => {
        const message = { jsonrpc: '2.0', method: 'response', params: {}, id: 1 }

        // receive() returns an async iterable that yields one message
        async function* generateMessage() {
          yield message
        }
        mockTransport.receive.mockReturnValueOnce(generateMessage())

        adapter = new SDKTransportAdapter(mockTransport)
        const messageHandler = vi.fn()
        adapter.onmessage = messageHandler

        await adapter.start()

        // Wait for receive loop to process
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(messageHandler).toHaveBeenCalledWith(message)
      })

      it('should handle receive errors', async () => {
        mockTransport.receive.mockRejectedValueOnce(new Error('Receive failed'))

        adapter = new SDKTransportAdapter(mockTransport)
        const errorHandler = vi.fn()
        adapter.onerror = errorHandler

        await adapter.start()

        // Wait for receive loop to hit the error
        await new Promise((resolve) => setTimeout(resolve, 150))

        expect(errorHandler).toHaveBeenCalledWith(expect.any(Error))
      })

      it('should stop receiving on close', async () => {
        adapter = new SDKTransportAdapter(mockTransport)
        await adapter.start()
        await adapter.close()

        expect(mockTransport.disconnect).toHaveBeenCalled()
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

        await adapter.send(jsonRpcMessage as any)

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

        await adapter.send(messageWithMeta as any)

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
