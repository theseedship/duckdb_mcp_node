#!/usr/bin/env tsx
/**
 * Test script to verify STDIO mode doesn't pollute stdout
 * This ensures MCP protocol integrity
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

console.log('🔍 Testing STDIO pollution prevention...\n')

// Start the MCP server in STDIO mode
const serverPath = join(__dirname, 'src/server/mcp-server.ts')
const mcp = spawn('npx', ['tsx', serverPath], {
  env: { ...process.env, MCP_MODE: 'stdio' },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stdoutData = ''
let stderrData = ''
let hasError = false

// Capture stdout (should only contain JSON-RPC)
mcp.stdout.on('data', (data) => {
  stdoutData += data.toString()
})

// Capture stderr (should contain logs)
mcp.stderr.on('data', (data) => {
  stderrData += data.toString()
})

// Send an initialize request
const initRequest = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '0.1.0',
    capabilities: {
      roots: { uri: 'file:///test' },
    },
    clientInfo: {
      name: 'test-client',
      version: '1.0.0',
    },
  },
})

// Send with proper Content-Length header
const contentLength = Buffer.byteLength(initRequest, 'utf8')
mcp.stdin.write(`Content-Length: ${contentLength}\r\n\r\n${initRequest}`)

// Give it time to respond
setTimeout(() => {
  mcp.kill()

  console.log('=== STDOUT Analysis ===')
  const stdoutLines = stdoutData.split('\n').filter((l) => l.trim())

  // Check each line of stdout
  let pollutionFound = false
  const pollutedLines: string[] = []

  for (const line of stdoutLines) {
    // Skip Content-Length headers and empty lines
    if (line.startsWith('Content-Length:') || line.trim() === '' || line === '\x1E') {
      continue
    }

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(line)
      // Should be valid JSON-RPC
      if (!parsed.jsonrpc || parsed.jsonrpc !== '2.0') {
        pollutedLines.push(`Invalid JSON-RPC: ${line}`)
        pollutionFound = true
      }
    } catch (e) {
      // Not valid JSON = pollution
      pollutedLines.push(`Not JSON: ${line}`)
      pollutionFound = true
    }
  }

  if (pollutionFound) {
    console.log('❌ POLLUTION DETECTED in stdout!')
    console.log('Polluted lines:')
    pollutedLines.forEach((l) => console.log(`  - ${l}`))
    hasError = true
  } else if (stdoutData.trim()) {
    console.log('✅ stdout is clean - only JSON-RPC protocol')
    console.log(`   Found ${stdoutLines.length} valid protocol lines`)
  } else {
    console.log('⚠️  No stdout output received')
  }

  console.log('\n=== STDERR Analysis ===')
  if (stderrData) {
    const logLines = stderrData.split('\n').filter((l) => l.trim())
    console.log(`✅ Logs properly routed to stderr (${logLines.length} lines)`)

    // Show first few log lines as example
    const preview = logLines.slice(0, 3)
    if (preview.length > 0) {
      console.log('   Sample logs:')
      preview.forEach((line) => {
        const truncated = line.length > 60 ? line.substring(0, 60) + '...' : line
        console.log(`     ${truncated}`)
      })
    }
  } else {
    console.log('⚠️  No stderr output (logs may be suppressed)')
  }

  console.log('\n=== Test Result ===')
  if (hasError) {
    console.log('❌ FAILED: stdout pollution detected')
    console.log('   The MCP server is writing non-protocol data to stdout')
    process.exit(1)
  } else {
    console.log('✅ PASSED: No stdout pollution detected')
    console.log('   The MCP server correctly isolates logs to stderr')
    process.exit(0)
  }
}, 2000)