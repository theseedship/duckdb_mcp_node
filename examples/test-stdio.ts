#!/usr/bin/env tsx

import { spawn } from 'child_process'

async function testStdio() {
  console.log('Testing stdio communication...\n')

  const serverProcess = spawn('npx', ['tsx', 'src/server/mcp-server.ts'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      MCP_MODE: 'stdio',
    },
  })

  // Send initialize request
  const initRequest = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test',
        version: '1.0.0',
      },
    },
  })

  console.log('Sending:', initRequest)
  serverProcess.stdin.write(initRequest + '\n')

  // Listen for response
  serverProcess.stdout.on('data', (data) => {
    console.log('Received:', data.toString())
  })

  // Wait a bit
  await new Promise((resolve) => setTimeout(resolve, 2000))

  serverProcess.kill()
}

testStdio().catch(console.error)
