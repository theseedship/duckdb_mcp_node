# DuckDB MCP Node - Troubleshooting Guide

## 🚨 Common Issues & Solutions

### 1. Transport Connection Issues

#### Error: `TypeError: this._transport.send is not a function`

**Cause:** Transport interface mismatch between your implementation and MCP SDK expectations.

**Solution:** The package now includes SDKTransportAdapter that handles this automatically.

```typescript
// This is handled internally, but if you see this error:
import { SDKTransportAdapter } from 'duckdb_mcp_node/protocol'
const adapter = new SDKTransportAdapter(yourTransport)
```

#### Error: `Failed to connect to [transport]: Connection refused`

**Cause:** Server not running or wrong port.

**Solutions:**

```bash
# 1. Check if server is running
npm run port:status

# 2. Start the appropriate server
npm run server:websocket  # Port 8080
npm run server:tcp        # Port 9999
npm run server:http       # Port 3001

# 3. Or use auto server management
npm run test:integration  # Starts servers automatically
```

#### Error: `Proxy Server PORT IS IN USE at port 6277`

**Cause:** MCP Inspector or another process stuck on the port.

**Solutions:**

```bash
# Quick fix - kill the stuck process
npm run port:clean

# Or specifically clean port 6277
npm run port:clean 6277

# Check what's using the port
npm run port:status

# Nuclear option - reset everything
npm run inspector:reset
```

### 2. Protocol Version Issues

#### Error: `Server's protocol version is not supported: 1.0.0`

**Cause:** Server using incorrect MCP protocol version.

**Solution:** Ensure all servers use protocol version `2025-03-26`:

```javascript
// In your server initialization
{
  protocolVersion: '2025-03-26',  // Required version
  capabilities: {
    resources: {},  // Must be object, not boolean
    tools: {}       // Must be object, not boolean
  }
}
```

### 3. HTTP Transport Issues

#### Error: `Failed to attach server 'http-test': Cannot read properties of undefined`

**Cause:** HTTP response format mismatch.

**Current Status:** HTTP transport has initialization issues. Use WebSocket or TCP instead.

```typescript
// Workaround - use working transports
await client.attachServer('ws://localhost:8080', 'server', 'websocket') // ✅ Works
await client.attachServer('tcp://localhost:9999', 'server', 'tcp') // ✅ Works
// await client.attachServer('http://localhost:3001', 'server', 'http')  // ❌ Being fixed
```

### 4. Federation Issues

#### Error: `Resource mcp://server/resource not found`

**Cause:** Server not attached or resources not registered.

**Solutions:**

```typescript
// 1. Ensure server is attached
await service.attachMCPServer('github', 'stdio://mcp-server-github')

// 2. Refresh resources
await service.refreshResources('github')

// 3. Check registry
const resources = registry.listResources('github')
console.log(resources)
```

#### Error: `Federation query timeout`

**Cause:** Remote server slow or unresponsive.

**Solutions:**

```typescript
// 1. Increase timeout
const router = new QueryRouter(registry, pool, {
  queryTimeout: 120000, // 2 minutes
})

// 2. Check server health
const health = await pool.checkHealth('github')

// 3. Use connection reset
const resetManager = new ConnectionResetManager()
await resetManager.reset('github')
```

### 5. TypeScript Compilation Issues

#### Error: `Cannot find namespace 'NodeJS'`

**Cause:** TypeScript type definitions issue.

**Solution:** Use proper timer type:

```typescript
// Instead of: NodeJS.Timeout
// Use:
private timeout?: ReturnType<typeof setTimeout>
private interval?: ReturnType<typeof setInterval>
```

#### Error: `Module not found: '@modelcontextprotocol/sdk'`

**Cause:** Missing dependency.

**Solution:**

```bash
npm install @modelcontextprotocol/sdk
```

### 6. Test Running Issues

#### Tests hang or timeout

**Cause:** Servers not starting properly or ports blocked.

**Solutions:**

```bash
# 1. Clean all ports first
npm run port:clean

# 2. Use the automated test runner
npm run test:integration

# 3. Manually check and kill processes
ps aux | grep "mcp\|inspector"
kill -9 [PID]
```

### 7. Inspector Issues

#### Error: `OAuth quick flow failed`

**Expected behavior:** OAuth resources are expected to fail in Inspector - this is not critical.

#### Inspector stuck or not responding

**Solutions:**

```bash
# Reset Inspector
npm run inspector:reset

# Or manually
kill -9 $(lsof -ti:6277)
npm run inspector
```

## 🔧 Diagnostic Commands

### Port Management

```bash
# Check port usage
npm run port:status

# Clean specific port
npm run port:clean 8080

# Clean all common MCP ports
npm run port:clean
```

### Connection Management

```bash
# Reset all connections
npm run connection:reset

# Test specific transport
npm run test:websocket
npm run test:tcp
npm run test:http
```

### Server Management

```bash
# Start individual servers
npm run server:websocket  # Port 8080
npm run server:tcp        # Port 9999
npm run server:http       # Port 3001

# Auto server management (recommended)
npm run test:integration
```

## 🩺 Health Checks

### Check Transport Health

```typescript
import { healthCheck } from 'duckdb_mcp_node/utils'

// Check all transports
const results = await healthCheck.checkAll()
console.log(results)
// {
//   websocket: { status: 'healthy', latency: 12 },
//   tcp: { status: 'healthy', latency: 8 },
//   http: { status: 'unhealthy', error: 'Initialization failed' }
// }
```

### Check Federation Health

```typescript
const federation = service.getFederation()

// Check all connected servers
const status = await federation.checkHealth()
status.forEach((server) => {
  console.log(`${server.name}: ${server.status} (${server.latency}ms)`)
})
```

## 📝 Debug Logging

### Enable Verbose Logging

```typescript
// Set environment variable
process.env.MCP_DEBUG = 'true'

// Or in code
import { setDebugMode } from 'duckdb_mcp_node/utils'
setDebugMode(true)
```

### Log Categories

```typescript
// Enable specific log categories
setLogLevel({
  transport: 'debug',
  federation: 'info',
  query: 'warn',
  connection: 'debug',
})
```

## 🔄 Recovery Procedures

### Full System Reset

When nothing else works:

```bash
#!/bin/bash
# Full reset script

# 1. Kill all MCP-related processes
npm run port:clean

# 2. Clear any cache
rm -rf .mcp-cache/
rm -rf node_modules/.cache/

# 3. Reset connections
npm run connection:reset

# 4. Restart servers
npm run test:integration
```

### Connection Recovery

```typescript
class RecoveryManager {
  async recoverConnection(serverName: string) {
    try {
      // 1. Force disconnect
      await pool.disconnect(serverName)

      // 2. Clear from registry
      registry.clearServer(serverName)

      // 3. Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // 4. Reconnect
      const client = await pool.getClient(serverUrl, 'auto')

      // 5. Re-register resources
      const resources = await client.listResources()
      registry.register(serverName, resources)

      return true
    } catch (error) {
      console.error(`Recovery failed for ${serverName}:`, error)
      return false
    }
  }
}
```

## 🐛 Debugging Tips

### 1. Check Transport Compatibility

```typescript
// Test each transport individually
const transports = ['websocket', 'tcp', 'http', 'stdio']
for (const transport of transports) {
  try {
    await testTransport(transport)
    console.log(`✅ ${transport} working`)
  } catch (error) {
    console.log(`❌ ${transport} failed:`, error.message)
  }
}
```

### 2. Trace Federation Queries

```typescript
// Enable query tracing
router.enableTracing(true)

// Execute query
const result = await router.query(sql)

// Get trace
const trace = router.getLastTrace()
console.log(trace)
// Shows: query plan, server calls, timing, temp tables created
```

### 3. Monitor Connection Pool

```typescript
// Get pool statistics
const stats = pool.getStats()
console.log(stats)
// {
//   totalConnections: 5,
//   activeConnections: 2,
//   idleConnections: 3,
//   failedConnections: 0,
//   averageLatency: 15
// }
```

## 📚 Error Reference

### Transport Errors

- `ECONNREFUSED`: Server not running
- `ETIMEDOUT`: Server not responding
- `EADDRINUSE`: Port already in use
- `PROTOCOL_VERSION_MISMATCH`: Wrong protocol version
- `CAPABILITY_ERROR`: Incorrect capability format

### Federation Errors

- `RESOURCE_NOT_FOUND`: Resource not in registry
- `SERVER_NOT_ATTACHED`: Server not connected
- `QUERY_TIMEOUT`: Query took too long
- `FEDERATION_ERROR`: General federation failure
- `TEMP_TABLE_ERROR`: Failed to create temp table

### Connection Pool Errors

- `MAX_CONNECTIONS_REACHED`: Pool limit hit
- `CONNECTION_TIMEOUT`: Connection took too long
- `NEGOTIATION_FAILED`: Transport negotiation failed
- `POOL_EXHAUSTED`: No available connections

## 🆘 Getting Help

### Before Asking for Help

1. Check this troubleshooting guide
2. Run diagnostic commands
3. Check logs with debug mode enabled
4. Try the recovery procedures

### Information to Provide

When reporting issues, include:

```bash
# System info
node --version
npm --version
npm list @modelcontextprotocol/sdk

# Port status
npm run port:status

# Test results
npm run test:integration 2>&1 | tee test-output.log

# Debug logs
MCP_DEBUG=true npm run test:integration
```

### Where to Get Help

- GitHub Issues: [Report bugs](https://github.com/anthropics/claude-code/issues)
- Documentation: Check `/docs` directory
- Examples: Review `/examples` directory

## ✅ Quick Fixes Checklist

When something doesn't work:

- [ ] Run `npm run port:clean` to clear stuck processes
- [ ] Check protocol version is `2025-03-26`
- [ ] Verify capabilities are objects, not booleans
- [ ] Use WebSocket or TCP transport (both work)
- [ ] Run `npm run test:integration` for auto setup
- [ ] Enable debug logging with `MCP_DEBUG=true`
- [ ] Try connection reset with `npm run connection:reset`
- [ ] Check server is actually running on expected port

👨 **Daddy says:** When in doubt, run `npm run port:clean` first - it fixes 80% of connection issues by clearing stuck processes
