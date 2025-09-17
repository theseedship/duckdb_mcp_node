#!/usr/bin/env tsx

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

/**
 * Basic MCP connection test
 */
async function testBasicMCP() {
  console.log('🧪 Basic MCP Connection Test\n')

  const client = new Client(
    {
      name: 'basic-test-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  )

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['./node_modules/.bin/tsx', 'src/server/mcp-server.ts'],
    env: {
      ...process.env,
      MCP_MODE: 'stdio',
      MCP_SECURITY_MODE: 'development',
    },
  })

  try {
    console.log('Connecting to server...')
    await client.connect(transport)
    console.log('✅ Connected\n')

    console.log('Listing tools...')
    const tools = await client.listTools()
    console.log(`✅ Found ${tools.tools.length} tools\n`)

    console.log('Testing simple SELECT query...')
    const result = await client.callTool('query_duckdb', {
      sql: 'SELECT 1 as test',
    })
    const data = JSON.parse(result.content[0].text)
    console.log('✅ Query result:', data)
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await client.close()
  }
}

testBasicMCP().catch(console.error)
