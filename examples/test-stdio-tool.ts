#!/usr/bin/env tsx

import { spawn } from 'child_process'

async function testStdioTool() {
  console.log('Testing stdio tool call...\n')

  const serverProcess = spawn('npx', ['tsx', 'src/server/mcp-server.ts'], {
    stdio: ['pipe', 'pipe', 'ignore'], // Suppress stderr
    env: {
      ...process.env,
      MCP_MODE: 'stdio',
    },
  })

  let messageId = 1

  // Helper to send request
  const sendRequest = (method: string, params: any) => {
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: messageId++,
      method,
      params,
    })
    console.log('Sending:', request)
    serverProcess.stdin.write(request + '\n')
  }

  // Buffer for incomplete messages
  let buffer = ''

  // Listen for responses
  serverProcess.stdout.on('data', (data) => {
    buffer += data.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line)
          console.log('Received:', JSON.stringify(msg, null, 2))
        } catch (e) {
          console.log('Invalid JSON:', line)
        }
      }
    }
  })

  // Send initialize
  sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  })

  await new Promise((resolve) => setTimeout(resolve, 500))

  // Send tool call
  sendRequest('tools/call', {
    name: 'query_duckdb',
    arguments: { sql: 'SELECT 1 as test' },
  })

  // Wait for response
  await new Promise((resolve) => setTimeout(resolve, 2000))

  serverProcess.kill()
}

testStdioTool().catch(console.error)
