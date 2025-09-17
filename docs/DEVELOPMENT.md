# Development Guide

## Testing

### Quick Test

```bash
# MCP Inspector (GUI)
npm run inspector

# Run all tests
npm test

# Test with coverage
npm run test:coverage
```

### Transport Testing

Each transport requires a server and client in separate terminals:

#### WebSocket (✅ Working)

```bash
# Terminal 1
npm run server:websocket

# Terminal 2
npm run test:websocket
```

#### TCP (✅ Working)

```bash
# Terminal 1
npm run server:tcp

# Terminal 2
npm run test:tcp
```

#### HTTP (⚠️ Issues)

```bash
# Terminal 1
npm run server:http

# Terminal 2
npm run test:http
```

### Integration Testing

```bash
# Auto-starts all servers and runs tests
npm run test:integration
```

### Manual Testing with Tools

```bash
# TCP with netcat
nc localhost 9999
{"jsonrpc":"2.0","method":"initialize","params":{},"id":"1"}

# WebSocket with wscat
npm install -g wscat
wscat -c ws://localhost:8080
> {"jsonrpc":"2.0","method":"resources/list","params":{},"id":"1"}

# HTTP with curl
curl -X POST http://localhost:3001/mcp/request \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"resources/list","params":{},"id":"1"}'
```

## Troubleshooting

### Port Issues

#### Port already in use

```bash
# Check what's using ports
npm run port:status

# Kill specific port
npm run port:clean 8080

# Kill all MCP ports
npm run port:clean
```

#### Inspector stuck

```bash
# MCP Inspector uses TWO ports:
# - Port 6274: Inspector UI
# - Port 6277: Proxy server

# Reset both ports and restart
npm run inspector:reset

# Or manually kill both ports
npm run port:clean 6274
npm run port:clean 6277
```

### Transport Errors

#### `TypeError: this._transport.send is not a function`

- **Cause**: Interface mismatch
- **Fix**: SDKTransportAdapter handles this automatically

#### `Connection refused`

- **Cause**: Server not running
- **Fix**: Start appropriate server (see Transport Testing above)

#### `Protocol version mismatch`

- **Cause**: Wrong protocol version
- **Fix**: Use version `2025-03-26` in all servers

### Federation Issues

#### Resource not found

```typescript
// Ensure server attached
await service.attachMCPServer('github', 'stdio://mcp-server-github')

// Refresh resources
await service.refreshResources('github')

// Check registry
const resources = registry.listResources('github')
```

#### Connection timeout

```typescript
// Increase timeout
const router = new QueryRouter(registry, pool, {
  queryTimeout: 120000, // 2 minutes
})

// Reset connection
await connectionReset.reset('github')
```

### TypeScript Issues

#### Cannot find namespace 'NodeJS'

```typescript
// Use:
private timeout?: ReturnType<typeof setTimeout>
// Instead of: NodeJS.Timeout
```

## Debug Mode

### Enable Logging

```bash
# Environment variable
MCP_DEBUG=true npm run test

# Or in code
process.env.MCP_DEBUG = 'true'
```

### Check Health

```typescript
import { healthCheck } from 'duckdb-mcp-native/utils'

const results = await healthCheck.checkAll()
// { websocket: 'healthy', tcp: 'healthy', http: 'unhealthy' }
```

## Common Scripts

### Development

```bash
npm run dev:server       # Start MCP server
npm run inspector        # MCP Inspector UI
npm run build           # Compile TypeScript
npm run build:watch     # Watch mode compilation
```

### Testing

```bash
npm test                # Run tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
npm run test:integration # Full integration test
```

### Quality

```bash
npm run lint            # Check linting
npm run lint:fix        # Fix linting issues
npm run format          # Format code
npm run typecheck       # Type checking
npm run check:all       # All checks (required for CI)
```

### Port Management

```bash
npm run port:status     # Show port usage
npm run port:clean      # Kill stuck processes
npm run inspector:reset # Reset MCP Inspector
```

### Servers

```bash
npm run server:websocket # Start WebSocket server
npm run server:tcp       # Start TCP server
npm run server:http      # Start HTTP server
```

## Quick Fixes

When something doesn't work:

1. `npm run port:clean` - Clears stuck processes (fixes 80% of issues)
2. Check protocol version is `2025-03-26`
3. Verify capabilities are objects, not booleans
4. Use WebSocket or TCP (both stable)
5. Enable debug: `MCP_DEBUG=true`
6. Reset connections: `npm run connection:reset`

## Architecture Notes

### Server Types

- **MCP Server** (`src/server/mcp-server.ts`): Production server, stdio only
- **Test Servers** (`examples/test-servers/`): Mock servers for transport testing

### Transport Status

- ✅ **stdio**: Production ready
- ✅ **WebSocket**: Working, auto-reconnection
- ✅ **TCP**: Working, keep-alive enabled
- ⚠️ **HTTP**: Initialization issues

### Federation Components

- **ResourceRegistry**: Manages federated resources
- **ConnectionPool**: Reuses MCP client connections
- **QueryRouter**: Routes queries to appropriate servers
- **SDKTransportAdapter**: Bridges transport interfaces

## Adding Features

### New MCP Tool

1. Add tool definition in `setupHandlers()`
2. Add case in CallToolRequestSchema switch
3. Implement using `this.duckdb` service
4. Add tests

### New Transport

1. Extend base `Transport` class
2. Implement `connect()`, `send()`, `disconnect()`
3. Add to MCPClient transport factory
4. Add test servers and clients

## Error Codes

### Transport

- `ECONNREFUSED`: Server not running
- `ETIMEDOUT`: Server not responding
- `EADDRINUSE`: Port already in use

### Federation

- `RESOURCE_NOT_FOUND`: Resource not in registry
- `SERVER_NOT_ATTACHED`: Server not connected
- `QUERY_TIMEOUT`: Query took too long

### Connection Pool

- `MAX_CONNECTIONS_REACHED`: Pool limit hit
- `NEGOTIATION_FAILED`: Transport negotiation failed
- `POOL_EXHAUSTED`: No available connections
