#!/usr/bin/env node
import { WebSocketServer } from 'ws'

/**
 * Simple WebSocket MCP Test Server
 * This creates a mock MCP server that communicates over WebSocket
 */

const PORT = 8080
const wss = new WebSocketServer({ port: PORT })

console.log(`🚀 WebSocket MCP Test Server running on ws://localhost:${PORT}`)

wss.on('connection', (ws) => {
  console.log('✅ New WebSocket client connected')

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString())
      console.log('📨 Received:', message.method || message.id)

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
                name: 'WebSocket Test Server',
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
                  uri: 'ws://test/data.json',
                  name: 'WebSocket Test Data',
                  mimeType: 'application/json',
                },
                {
                  uri: 'ws://test/metrics.csv',
                  name: 'WebSocket Metrics',
                  mimeType: 'text/csv',
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
                  name: 'ws_echo',
                  description: 'Echo tool for WebSocket',
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
          if (message.params?.name === 'ws_echo') {
            response = {
              jsonrpc: '2.0',
              result: {
                content: [
                  {
                    type: 'text',
                    text: `Echo: ${message.params.arguments?.message || 'no message'}`,
                  },
                ],
              },
              id: message.id,
            }
          }
          break

        case 'disconnect':
          console.log('👋 Client disconnecting')
          response = {
            jsonrpc: '2.0',
            result: { success: true },
            id: message.id,
          }
          // Close connection after sending response
          setTimeout(() => ws.close(), 100)
          break

        case 'ping':
          response = {
            jsonrpc: '2.0',
            result: { pong: true, timestamp: Date.now() },
            id: message.id,
          }
          break

        default:
          response = {
            jsonrpc: '2.0',
            result: {
              echo: message,
              timestamp: Date.now(),
            },
            id: message.id,
          }
      }

      // Send response
      if (response) {
        ws.send(JSON.stringify(response))
        console.log('📤 Sent response for:', message.method || message.id)
      }
    } catch (error) {
      console.error('Error processing message:', error)
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error',
            data: error.message,
          },
          id: null,
        })
      )
    }
  })

  // Handle ping/pong
  ws.on('ping', () => {
    console.log('🏓 Received ping, sending pong')
    ws.pong()
  })

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error)
  })

  // Handle close
  ws.on('close', () => {
    console.log('❌ WebSocket client disconnected')
  })

  // Send a welcome message
  ws.send(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'notification',
      params: {
        type: 'welcome',
        message: 'Connected to WebSocket MCP Test Server',
        timestamp: Date.now(),
      },
    })
  )
})

wss.on('error', (error) => {
  console.error('WebSocket server error:', error)
})

console.log('📝 Send JSON-RPC 2.0 messages to test:')
console.log('   {"jsonrpc":"2.0","method":"initialize","params":{},"id":"1"}')
console.log('   {"jsonrpc":"2.0","method":"resources/list","params":{},"id":"2"}')
console.log('   {"jsonrpc":"2.0","method":"tools/list","params":{},"id":"3"}')
