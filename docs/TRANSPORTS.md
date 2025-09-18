# Transport Layer Documentation

## Overview

The DuckDB MCP Node.js implementation now supports multiple transport protocols for connecting to MCP servers, achieving feature parity with the C++ and Python implementations.

## Supported Transports

### 1. stdio (Standard I/O)

**Status**: ✅ Fully Implemented  
**Use Case**: Local process communication

```typescript
// Example: Connect to a Python MCP server
await mcpClient.attachServer('stdio://python?args=-m,server,--verbose', 'python-server', 'stdio')

// Example: Connect to an executable
await mcpClient.attachServer(
  'stdio:///usr/local/bin/mcp-server?args=--port,8080',
  'local-server',
  'stdio'
)
```

### 2. HTTP

**Status**: ✅ Implemented  
**Use Case**: RESTful communication over HTTP

```typescript
// Basic HTTP connection
await mcpClient.attachServer('http://localhost:8080/mcp', 'http-server', 'http')

// With authentication headers
await mcpClient.attachServer(
  'http://api.example.com/mcp?header_Authorization=Bearer%20token123',
  'api-server',
  'http'
)

// Direct transport usage
const transport = new HTTPTransport('http://localhost:8080', {
  Authorization: 'Bearer token123',
  'X-API-Key': 'secret',
})
await transport.connect()
```

**Features**:

- Request/Response pattern
- Optional polling for server-sent events
- Session management
- Custom headers support

### 3. WebSocket

**Status**: ✅ Implemented  
**Use Case**: Real-time bidirectional communication

```typescript
// Basic WebSocket connection
await mcpClient.attachServer('ws://localhost:8080/mcp', 'ws-server', 'websocket')

// Secure WebSocket with headers
await mcpClient.attachServer(
  'wss://api.example.com/mcp?header_Authorization=Bearer%20token',
  'secure-server',
  'websocket'
)

// Direct transport usage
const transport = new WebSocketTransport('wss://api.example.com', {
  Authorization: 'Bearer token123',
})
await transport.connect()
```

**Features**:

- Real-time message streaming
- Automatic reconnection with exponential backoff
- Ping/pong keep-alive
- Connection state monitoring

### 4. TCP

**Status**: ✅ Implemented  
**Use Case**: Direct network socket communication

```typescript
// Basic TCP connection
await mcpClient.attachServer('tcp://localhost:9999', 'tcp-server', 'tcp')

// Custom host and port
await mcpClient.attachServer('tcp://192.168.1.100:5555', 'remote-server', 'tcp')

// Direct transport usage
const transport = new TCPTransport('192.168.1.100', 5555)
await transport.connect()
```

**Features**:

- Low-latency direct socket communication
- Keep-alive mechanism
- Automatic reconnection support
- Nagle algorithm disabled for better latency

## Transport Features Comparison

| Feature            | stdio         | HTTP     | WebSocket | TCP            |
| ------------------ | ------------- | -------- | --------- | -------------- |
| **Latency**        | Low           | Medium   | Low       | Very Low       |
| **Streaming**      | ✅            | ❌       | ✅        | ✅             |
| **Bidirectional**  | ✅            | ❌       | ✅        | ✅             |
| **Authentication** | Process-based | Headers  | Headers   | Custom         |
| **Reconnection**   | ❌            | ❌       | ✅ Auto   | ✅ Auto        |
| **Keep-Alive**     | N/A           | Polling  | Ping/Pong | TCP Keep-Alive |
| **Proxy Support**  | ❌            | ✅       | ✅        | ❌             |
| **SSL/TLS**        | ❌            | ✅ HTTPS | ✅ WSS    | ✅ TLS         |

## Usage Examples

### Example 1: Multi-Transport Setup

```typescript
import { DuckDBMcpNativeService } from '@seed-ship/duckdb-mcp-native'

const service = new DuckDBMcpNativeService()
await service.initialize()

// Attach multiple servers with different transports
await service.attachMCP('stdio://python', 'local-python')
await service.attachMCP('http://api.company.com/mcp', 'company-api', 'http')
await service.attachMCP('ws://realtime.example.com', 'realtime', 'websocket')
await service.attachMCP('tcp://data-server:9999', 'data', 'tcp')

// Query across all attached servers
const results = await service.query(`
  SELECT * FROM 
    local_python.data AS pd,
    company_api.users AS u,
    realtime.events AS e,
    data.metrics AS m
  WHERE pd.user_id = u.id
    AND u.id = e.user_id
    AND e.metric_id = m.id
`)
```

### Example 2: Error Handling and Reconnection

```typescript
// WebSocket with auto-reconnection
const wsTransport = new WebSocketTransport('wss://api.example.com')
wsTransport.on('disconnect', () => {
  console.log('Disconnected, will auto-reconnect...')
})
wsTransport.on('reconnect', () => {
  console.log('Reconnected successfully')
})

// TCP with custom reconnection handling
const tcpTransport = new TCPTransport('localhost', 9999)
try {
  await tcpTransport.connect()
} catch (error) {
  console.error('Connection failed:', error)
  // Implement custom retry logic
}
```

### Example 3: MotherDuck Cloud Integration (Future)

```typescript
// Future implementation for MotherDuck cloud
await mcpClient.attachServer(
  'motherduck://my-database?token=secret',
  'cloud-db',
  'motherduck' // Custom transport for MotherDuck
)
```

## Implementation Details

### Transport Interface

All transports implement the base `Transport` abstract class:

```typescript
export abstract class Transport {
  abstract connect(): Promise<void>
  abstract disconnect(): Promise<void>
  abstract send(message: MCPMessage): Promise<void>
  abstract receive(): AsyncIterator<MCPMessage>
  abstract isConnected(): boolean
}
```

### Message Format

All transports use JSON-RPC 2.0 message format:

```typescript
interface MCPMessage {
  jsonrpc: '2.0'
  method?: string
  params?: any
  result?: any
  error?: { code: number; message: string; data?: any }
  id?: string | number
}
```

### Security Considerations

1. **stdio**: Inherits process permissions
2. **HTTP**: Use HTTPS in production, implement authentication headers
3. **WebSocket**: Use WSS in production, validate origin headers
4. **TCP**: Implement TLS for production, consider VPN for internal networks

## Limitations and Future Work

### Current Limitations

- HTTP transport doesn't support true streaming (uses polling)
- No built-in SSL/TLS for TCP transport (must be added)
- No proxy configuration for WebSocket/TCP
- Limited authentication mechanisms

### Future Enhancements

- [ ] SSL/TLS support for TCP transport
- [ ] HTTP/2 support for better streaming
- [ ] Unix domain sockets for local communication
- [ ] gRPC transport for high-performance RPC
- [ ] QUIC transport for better network resilience
- [ ] MotherDuck-specific transport with cloud optimizations

## Compatibility Matrix

| Transport   | C++ duckdb_mcp | Python mcp-server-motherduck | Node.js (This) |
| ----------- | -------------- | ---------------------------- | -------------- |
| stdio       | ✅             | ✅                           | ✅             |
| HTTP        | ❌             | ✅                           | ✅             |
| WebSocket   | ❌             | ✅                           | ✅             |
| TCP         | ✅             | ❌                           | ✅             |
| Unix Socket | ✅             | ❌                           | ❌             |
| MotherDuck  | ❌             | ✅                           | 🚧 Planned     |

## Testing

Run transport tests:

```bash
npm test -- tests/transports.test.ts
```

Test with real servers:

```bash
# Start test servers (in separate terminals)
python examples/test-servers/http-server.py
python examples/test-servers/websocket-server.py
nc -l 9999  # Simple TCP listener

# Run integration tests
npm run test:integration
```

## Migration Guide

### From C++ Implementation

```cpp
// C++ TCP connection
ATTACH 'tcp://localhost:9999' AS server (TYPE mcp);
```

Equivalent in Node.js:

```typescript
await service.attachMCP('tcp://localhost:9999', 'server', 'tcp')
```

### From Python Implementation

```python
# Python HTTP connection
client = MCPClient()
await client.connect_http("http://api.example.com", headers={"Authorization": "Bearer token"})
```

Equivalent in Node.js:

```typescript
await mcpClient.attachServer(
  'http://api.example.com?header_Authorization=Bearer%20token',
  'api-server',
  'http'
)
```

## Troubleshooting

### Connection Issues

1. **stdio**: Check command exists and is executable
2. **HTTP**: Verify endpoint is accessible, check CORS if browser-based
3. **WebSocket**: Ensure WebSocket endpoint supports the protocol version
4. **TCP**: Check firewall rules, verify port is open

### Performance Tips

1. Use TCP for lowest latency on local network
2. Use WebSocket for real-time updates over internet
3. Use HTTP when behind corporate proxies
4. Use stdio for local development and testing

### Debug Logging

Enable debug logging for transports:

```typescript
process.env.DEBUG = 'mcp:transport:*'
```

---

This completes the transport layer implementation for the Node.js DuckDB MCP extension, achieving feature parity with both C++ and Python implementations while adding unique Node.js capabilities.
