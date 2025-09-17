#!/usr/bin/env node
import express from 'express'
import bodyParser from 'body-parser'

/**
 * Simple HTTP MCP Test Server
 * This creates a mock MCP server that responds to HTTP requests
 */

const app = express()
app.use(bodyParser.json())

const PORT = 3001
let sessionCounter = 1
const sessions = new Map()

// Initialize endpoint
app.post('/mcp/initialize', (req, res) => {
  const sessionId = `session-${sessionCounter++}`
  sessions.set(sessionId, {
    connected: true,
    messages: [],
  })

  console.log(`✅ New session initialized: ${sessionId}`)

  res.json({
    jsonrpc: '2.0',
    result: {
      protocolVersion: '2025-03-26',
      capabilities: {
        resources: {},
        tools: {},
        serverSentEvents: true,
      },
      serverInfo: {
        name: 'HTTP Test Server',
        version: '1.0.0',
      },
      sessionId,
    },
    id: req.body.id || 'init',
  })
})

// Message endpoint
app.post('/mcp/message', (req, res) => {
  const sessionId = req.headers['x-session-id']
  console.log(`📨 Message received for session ${sessionId}:`, req.body.method)

  // Echo back a response
  res.json({
    jsonrpc: '2.0',
    result: {
      message: 'Message received',
      echo: req.body,
    },
    id: req.body.id,
  })
})

// Polling endpoint for server-sent events
app.get('/mcp/poll', (req, res) => {
  const sessionId = req.query.sessionId
  const session = sessions.get(sessionId)

  if (!session) {
    return res.status(404).json({ error: 'Session not found' })
  }

  // Return any pending messages
  const messages = session.messages.splice(0, session.messages.length)
  res.json({ messages })
})

// Request endpoint for RPC calls
app.post('/mcp/request', (req, res) => {
  console.log(`🔧 Request received:`, req.body.method)

  // Handle different MCP methods
  switch (req.body.method) {
    case 'resources/list':
      res.json({
        jsonrpc: '2.0',
        result: {
          resources: [
            {
              uri: 'test://data.json',
              name: 'Test Data',
              mimeType: 'application/json',
            },
            {
              uri: 'test://table.csv',
              name: 'Test Table',
              mimeType: 'text/csv',
            },
          ],
        },
        id: req.body.id,
      })
      break

    case 'tools/list':
      res.json({
        jsonrpc: '2.0',
        result: {
          tools: [
            {
              name: 'test_tool',
              description: 'A test tool',
              inputSchema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                },
              },
            },
          ],
        },
        id: req.body.id,
      })
      break

    default:
      res.json({
        jsonrpc: '2.0',
        result: { success: true, method: req.body.method },
        id: req.body.id,
      })
  }
})

// Disconnect endpoint
app.post('/mcp/disconnect', (req, res) => {
  const sessionId = req.body.sessionId
  sessions.delete(sessionId)
  console.log(`👋 Session disconnected: ${sessionId}`)
  res.json({ success: true })
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 HTTP MCP Test Server running on http://localhost:${PORT}`)
  console.log(`📝 Endpoints:`)
  console.log(`   POST /mcp/initialize - Start session`)
  console.log(`   POST /mcp/message - Send message`)
  console.log(`   GET  /mcp/poll - Poll for messages`)
  console.log(`   POST /mcp/request - Make RPC request`)
  console.log(`   POST /mcp/disconnect - End session`)
})
