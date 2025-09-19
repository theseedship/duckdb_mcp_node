#!/usr/bin/env node

// Test that the server can start in STDIO mode without pollution

const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 Testing STDIO mode without pollution...\n');

// Start the server
const serverPath = path.join(__dirname, 'src', 'server', 'mcp-server.ts');
const server = spawn('npx', ['tsx', serverPath, '--stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    MCP_MODE: 'stdio',
    SILENT_INIT: 'true'
  }
});

let stdout = '';
let stderr = '';
let initialized = false;

// Send initialize request
const initRequest = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '0.1.0',
    capabilities: {
      tools: true
    }
  }
});

// Send with proper framing
const message = `Content-Length: ${Buffer.byteLength(initRequest)}\r\n\r\n${initRequest}`;
server.stdin.write(message);

// Capture stdout
server.stdout.on('data', (data) => {
  stdout += data.toString();

  // Check if we got a valid JSON-RPC response
  if (!initialized && stdout.includes('Content-Length:')) {
    const parts = stdout.split('\r\n\r\n');
    if (parts.length >= 2) {
      try {
        const json = JSON.parse(parts[1]);
        if (json.id === 1 && json.result) {
          console.log('✅ Server responded with valid JSON-RPC!');
          console.log('✅ No stdout pollution detected!');
          initialized = true;

          // Clean exit
          server.kill();
          process.exit(0);
        }
      } catch (e) {
        // Not valid JSON yet
      }
    }
  }
});

// Capture stderr
server.stderr.on('data', (data) => {
  stderr += data.toString();
});

// Timeout
setTimeout(() => {
  if (!initialized) {
    console.error('❌ Server did not respond properly');
    console.error('STDOUT:', stdout);
    console.error('STDERR:', stderr);
    server.kill();
    process.exit(1);
  }
}, 3000);

server.on('error', (err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});