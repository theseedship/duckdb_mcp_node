#!/usr/bin/env node
import net from 'net'

/**
 * Simple TCP MCP Test Server
 * This creates a mock MCP server that communicates over TCP sockets
 */

const PORT = 9999
const clients = new Map()
let clientCounter = 1

const server = net.createServer((socket) => {
  const clientId = `client-${clientCounter++}`
  let buffer = ''

  clients.set(clientId, socket)
  console.log(
    `✅ New TCP client connected: ${clientId} from ${socket.remoteAddress}:${socket.remotePort}`
  )

  // Handle incoming data
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf-8')

    // Process complete messages (newline delimited)
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line)
          console.log(`📨 [${clientId}] Received:`, message.method || message.id)

          // Handle different MCP methods
          let response

          switch (message.method) {
            case 'initialize':
              response = {
                jsonrpc: '2.0',
                result: {
                  protocolVersion: '2025-03-26',
                  capabilities: {
                    resources: {},
                    tools: {},
                  },
                  serverInfo: {
                    name: 'TCP Test Server',
                    version: '1.0.0',
                  },
                },
                id: message.id,
              }
              break

            case 'resources/list':
              response = {
                jsonrpc: '2.0',
                result: {
                  resources: [
                    {
                      uri: 'tcp://test/data.json',
                      name: 'TCP Test Data',
                      mimeType: 'application/json',
                    },
                    {
                      uri: 'tcp://test/logs.txt',
                      name: 'TCP Server Logs',
                      mimeType: 'text/plain',
                    },
                  ],
                },
                id: message.id,
              }
              break

            case 'tools/list':
              response = {
                jsonrpc: '2.0',
                result: {
                  tools: [
                    {
                      name: 'tcp_status',
                      description: 'Get TCP server status',
                      inputSchema: {
                        type: 'object',
                        properties: {},
                      },
                    },
                    {
                      name: 'tcp_echo',
                      description: 'Echo message via TCP',
                      inputSchema: {
                        type: 'object',
                        properties: {
                          message: { type: 'string' },
                        },
                        required: ['message'],
                      },
                    },
                  ],
                },
                id: message.id,
              }
              break

            case 'tools/call':
              if (message.params?.name === 'tcp_status') {
                response = {
                  jsonrpc: '2.0',
                  result: {
                    content: [
                      {
                        type: 'text',
                        text: `TCP Server Status: ${clients.size} connected clients`,
                      },
                    ],
                  },
                  id: message.id,
                }
              } else if (message.params?.name === 'tcp_echo') {
                response = {
                  jsonrpc: '2.0',
                  result: {
                    content: [
                      {
                        type: 'text',
                        text: `TCP Echo: ${message.params.arguments?.message || 'no message'}`,
                      },
                    ],
                  },
                  id: message.id,
                }
              }
              break

            case 'ping':
              response = {
                jsonrpc: '2.0',
                result: {
                  pong: true,
                  timestamp: Date.now(),
                  clientId,
                },
                id: message.id,
              }
              break

            case 'disconnect':
              console.log(`👋 [${clientId}] Client disconnecting`)
              response = {
                jsonrpc: '2.0',
                result: { success: true },
                id: message.id,
              }
              // Close connection after sending response
              setTimeout(() => socket.end(), 100)
              break

            default:
              response = {
                jsonrpc: '2.0',
                result: {
                  echo: message,
                  timestamp: Date.now(),
                  clientId,
                },
                id: message.id,
              }
          }

          // Send response
          if (response) {
            const responseData = JSON.stringify(response) + '\n'
            socket.write(responseData)
            console.log(`📤 [${clientId}] Sent response for:`, message.method || message.id)
          }
        } catch (error) {
          console.error(`Error processing message from ${clientId}:`, error)
          const errorResponse =
            JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: 'Internal error',
                data: error.message,
              },
              id: null,
            }) + '\n'
          socket.write(errorResponse)
        }
      }
    }
  })

  // Handle errors
  socket.on('error', (error) => {
    console.error(`TCP socket error for ${clientId}:`, error.message)
  })

  // Handle close
  socket.on('close', () => {
    console.log(`❌ TCP client disconnected: ${clientId}`)
    clients.delete(clientId)
  })

  // Handle timeout
  socket.on('timeout', () => {
    console.log(`⏱️ TCP client timeout: ${clientId}`)
  })

  // Send a welcome message
  const welcome =
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'notification',
      params: {
        type: 'welcome',
        message: 'Connected to TCP MCP Test Server',
        clientId,
        timestamp: Date.now(),
      },
    }) + '\n'
  socket.write(welcome)
})

// Start server
server.listen(PORT, () => {
  console.log(`🚀 TCP MCP Test Server running on port ${PORT}`)
  console.log(`📝 Connect with: telnet localhost ${PORT}`)
  console.log(`   Or use: nc localhost ${PORT}`)
  console.log(`\n📨 Send JSON-RPC 2.0 messages (newline delimited):`)
  console.log(`   {"jsonrpc":"2.0","method":"initialize","params":{},"id":"1"}`)
  console.log(`   {"jsonrpc":"2.0","method":"resources/list","params":{},"id":"2"}`)
  console.log(`   {"jsonrpc":"2.0","method":"tools/list","params":{},"id":"3"}`)
})

server.on('error', (error) => {
  console.error('TCP server error:', error)
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Please stop the other process or use a different port.`
    )
    process.exit(1)
  }
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down TCP server...')
  clients.forEach((socket, clientId) => {
    console.log(`Closing connection for ${clientId}`)
    socket.end()
  })
  server.close(() => {
    console.log('TCP server closed')
    process.exit(0)
  })
})
