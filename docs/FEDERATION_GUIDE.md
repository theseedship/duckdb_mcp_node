# DuckDB MCP Node - Federation Guide

## 🌐 Overview

The DuckDB MCP Node package provides powerful federation capabilities that allow you to connect and query multiple MCP servers as if they were a single unified data source. This guide explains how to use the federation features effectively.

## 📦 Core Federation Components

### 1. ResourceRegistry

Manages and namespaces resources from multiple MCP servers.

```typescript
import { ResourceRegistry } from 'duckdb_mcp_node'

const registry = new ResourceRegistry()

// Register resources from different servers
registry.register('github', githubResources)
registry.register('motherduck', motherDuckResources)
registry.register('memory', memoryResources)

// Resolve resource URIs
const resource = registry.resolve('mcp://github/issues')
// Returns: { server: 'github', resource: FederatedResource }
```

### 2. MCPConnectionPool

Efficiently manages connections to multiple MCP servers with automatic transport negotiation.

```typescript
import { MCPConnectionPool } from 'duckdb_mcp_node'

const pool = new MCPConnectionPool({
  maxConnections: 50,
  connectionTimeout: 30000,
  retryAttempts: 3,
})

// Get or create a connection (auto-negotiates transport)
const client = await pool.getClient('ws://localhost:8080', 'auto')
// Transport priority: stdio → websocket → tcp → http

// Connection reuse - subsequent calls return same client
const sameClient = await pool.getClient('ws://localhost:8080', 'auto')
console.log(client === sameClient) // true
```

### 3. QueryRouter

Routes queries to appropriate MCP servers based on resource namespaces.

```typescript
import { QueryRouter } from 'duckdb_mcp_node'

const router = new QueryRouter(registry, pool)

// Federated query with mcp:// prefix
const result = await router.query(`
  SELECT u.*, g.issues_count
  FROM local_users u
  JOIN mcp://github/issues g ON u.github_id = g.author_id
  WHERE g.created_at > '2025-01-01'
`)

// Router automatically:
// 1. Detects mcp://github/issues reference
// 2. Fetches data from GitHub MCP server
// 3. Creates temporary table in DuckDB
// 4. Performs the join locally
```

## 🚀 Quick Start

### Basic Federation Setup

```typescript
import {
  DuckDBMcpNativeService,
  ResourceRegistry,
  MCPConnectionPool,
  QueryRouter,
} from 'duckdb_mcp_node'

// 1. Initialize federation components
const registry = new ResourceRegistry()
const pool = new MCPConnectionPool({ maxConnections: 10 })
const router = new QueryRouter(registry, pool)

// 2. Create the main service with federation
const service = new DuckDBMcpNativeService({
  dbPath: ':memory:',
  federation: {
    registry,
    pool,
    router,
  },
})

// 3. Attach MCP servers
await service.attachMCPServer('github', 'stdio://mcp-server-github')
await service.attachMCPServer('motherduck', 'https://api.motherduck.com/mcp')
await service.attachMCPServer('memory', 'ws://localhost:8080/mcp')

// 4. Execute federated queries
const result = await service.query(`
  SELECT * FROM mcp://github/issues 
  WHERE state = 'open'
`)
```

## 🔧 Advanced Usage

### Federation Patterns

#### 1. Gateway Pattern (Recommended)

Your DuckDB MCP node acts as a gateway to multiple data sources:

```typescript
class MCPGateway {
  private federation: MCPFederation

  constructor() {
    this.federation = new MCPFederation({
      registry: new ResourceRegistry(),
      pool: new MCPConnectionPool({ maxConnections: 50 }),
      router: new QueryRouter(),
    })
  }

  async initialize() {
    // Attach all your MCP servers
    await this.federation.attach('github', 'stdio://mcp-server-github')
    await this.federation.attach('analytics', 'https://analytics.api/mcp')
    await this.federation.attach('cache', 'tcp://cache:9999')
  }

  async query(sql: string) {
    // All queries go through the gateway
    return this.federation.router.query(sql)
  }
}
```

#### 2. Mesh Pattern

For complex scenarios with peer-to-peer connections:

```typescript
// Each node can query others
const nodeA = new MCPFederationNode('nodeA')
const nodeB = new MCPFederationNode('nodeB')

// Establish mesh connections
await nodeA.connect('nodeB', 'ws://nodeB:8080')
await nodeB.connect('nodeA', 'ws://nodeA:8080')

// Query across the mesh
const result = await nodeA.query(`
  SELECT * FROM mcp://nodeB/data
  UNION ALL
  SELECT * FROM local_data
`)
```

### Connection Reset Utility

When connections get stuck or need to be reset:

```typescript
import { ConnectionResetManager } from 'duckdb_mcp_node'

const resetManager = new ConnectionResetManager()

// Reset all connections
await resetManager.resetAll()

// Reset specific server connection
await resetManager.reset('github')

// Force reset with cleanup
await resetManager.forceReset('github', {
  clearCache: true,
  killProcesses: true,
})
```

### Transport Auto-Negotiation

The connection pool automatically tries transports in order of efficiency:

```typescript
const pool = new MCPConnectionPool({
  transportPriority: ['stdio', 'websocket', 'tcp', 'http'],
  negotiationTimeout: 5000,
})

// Auto-negotiation example
const client = await pool.getClient('mcp://some-server', 'auto')
// Tries: stdio → fails → websocket → success!
console.log(client.transport) // 'websocket'
```

## 📊 Federation Query Examples

### 1. Simple Federation

```sql
-- Query GitHub issues directly
SELECT * FROM mcp://github/issues
WHERE state = 'open' AND labels LIKE '%bug%'
```

### 2. Cross-Server Join

```sql
-- Join local users with GitHub issues
SELECT
  u.username,
  COUNT(g.id) as issue_count,
  AVG(g.comments) as avg_comments
FROM users u
LEFT JOIN mcp://github/issues g ON u.github_id = g.author_id
GROUP BY u.username
ORDER BY issue_count DESC
```

### 3. Multi-Source Aggregation

```sql
-- Combine data from multiple MCP servers
WITH github_data AS (
  SELECT author_id, COUNT(*) as github_issues
  FROM mcp://github/issues
  GROUP BY author_id
),
analytics_data AS (
  SELECT user_id, SUM(events) as total_events
  FROM mcp://analytics/events
  GROUP BY user_id
)
SELECT
  u.username,
  g.github_issues,
  a.total_events
FROM users u
LEFT JOIN github_data g ON u.github_id = g.author_id
LEFT JOIN analytics_data a ON u.id = a.user_id
```

### 4. Federated CTEs

```sql
-- Use CTEs with federated sources
WITH remote_issues AS (
  SELECT * FROM mcp://github/issues
  WHERE created_at > CURRENT_DATE - INTERVAL '7 days'
),
remote_prs AS (
  SELECT * FROM mcp://github/pull_requests
  WHERE state = 'open'
)
SELECT
  'issues' as type, COUNT(*) as count FROM remote_issues
UNION ALL
SELECT
  'prs' as type, COUNT(*) as count FROM remote_prs
```

## 🔌 Integration with deposium_MCPs

### Direct Integration (No Wrapper Needed)

```typescript
// In your deposium_MCPs package
import { DuckDBMcpNativeService } from 'duckdb_mcp_node'

export class DeposiumServices {
  private duckdb: DuckDBMcpNativeService

  constructor() {
    // DuckDB service with federation capabilities
    this.duckdb = new DuckDBMcpNativeService({
      federation: {
        registry: new ResourceRegistry(),
        pool: new MCPConnectionPool({ maxConnections: 50 }),
        router: new QueryRouter(),
      },
    })

    // Your existing 53 tools remain unchanged
    this.tools = [...existingTools, ...this.duckdb.getTools()]
  }

  async initialize() {
    // Connect to other MCP servers
    await this.duckdb.attachMCPServer('github', process.env.GITHUB_MCP_URL)
    await this.duckdb.attachMCPServer('memory', process.env.MEMORY_MCP_URL)
  }
}
```

## 🛠️ Configuration Options

### Federation Configuration

```typescript
interface FederationConfig {
  registry: {
    cacheEnabled: boolean
    cacheTTL: number // seconds
    namespacePrefix: string // default: 'mcp://'
  }

  pool: {
    maxConnections: number // default: 10
    connectionTimeout: number // ms, default: 30000
    retryAttempts: number // default: 3
    retryDelay: number // ms, default: 1000
    keepAlive: boolean // default: true
  }

  router: {
    queryTimeout: number // ms, default: 60000
    parallelQueries: boolean // default: true
    maxParallelQueries: number // default: 5
    tempTablePrefix: string // default: 'mcp_temp_'
  }
}
```

### Example with Full Configuration

```typescript
const service = new DuckDBMcpNativeService({
  dbPath: './my-database.db',
  federation: {
    registry: {
      cacheEnabled: true,
      cacheTTL: 300,
      namespacePrefix: 'mcp://',
    },
    pool: {
      maxConnections: 100,
      connectionTimeout: 60000,
      retryAttempts: 5,
      retryDelay: 2000,
      keepAlive: true,
    },
    router: {
      queryTimeout: 120000,
      parallelQueries: true,
      maxParallelQueries: 10,
      tempTablePrefix: 'fed_temp_',
    },
  },
})
```

## 🧪 Testing Federation

### Unit Testing

```typescript
import { ResourceRegistry, MCPConnectionPool } from 'duckdb_mcp_node'
import { mockMCPServer } from './test-utils'

describe('Federation', () => {
  it('should register and resolve resources', () => {
    const registry = new ResourceRegistry()
    registry.register('test', [{ uri: 'data.json', name: 'Test Data' }])

    const resolved = registry.resolve('mcp://test/data.json')
    expect(resolved.server).toBe('test')
  })

  it('should pool connections', async () => {
    const pool = new MCPConnectionPool()
    const server = await mockMCPServer(8080)

    const client1 = await pool.getClient('ws://localhost:8080')
    const client2 = await pool.getClient('ws://localhost:8080')

    expect(client1).toBe(client2) // Same instance
    expect(pool.getActiveConnections()).toBe(1)
  })
})
```

### Integration Testing

```bash
# Run federation tests with auto server management
npm run test:federation

# Test specific transport federation
npm run test:federation:websocket
npm run test:federation:tcp

# Test with real MCP servers
npm run test:federation:real
```

## 📈 Performance Considerations

### Connection Pooling Benefits

- **Reuse**: Connections are reused across queries
- **Warmup**: Pool can pre-connect to frequently used servers
- **Limits**: Prevents connection exhaustion
- **Monitoring**: Track connection health and performance

### Query Optimization

- **Pushdown**: WHERE clauses are pushed to remote servers when possible
- **Caching**: Results can be cached based on TTL
- **Parallel**: Multiple remote queries execute in parallel
- **Streaming**: Large results are streamed, not loaded entirely in memory

### Best Practices

1. **Use connection pooling** for all federated queries
2. **Namespace resources properly** with clear server aliases
3. **Monitor connection health** with the pool's status methods
4. **Cache frequently accessed data** to reduce remote calls
5. **Use appropriate timeouts** based on your network conditions
6. **Implement retry logic** for transient failures

## 🐛 Troubleshooting

### Common Issues

#### 1. Transport Connection Failures

```typescript
// Problem: "Failed to connect: transport not supported"
// Solution: Use auto-negotiation
const client = await pool.getClient(url, 'auto')
```

#### 2. Resource Not Found

```typescript
// Problem: "Resource mcp://server/resource not found"
// Solution: Ensure server is attached and resources are registered
await service.attachMCPServer('server', 'ws://server:8080')
await service.refreshResources('server')
```

#### 3. Stuck Connections

```bash
# Reset all connections
npm run connection:reset

# Kill stuck processes on specific port
npm run port:clean 8080
```

## 📚 Additional Resources

- [Architecture Federation Patterns](./Architecture-federation-patterns.md)
- [Transport Documentation](./TRANSPORT_GUIDE.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
- [API Reference](./API.md)

## 🎯 Next Steps

1. **Start Simple**: Begin with single-server federation
2. **Add Servers**: Gradually add more MCP servers
3. **Optimize**: Use pooling and caching for performance
4. **Monitor**: Track connection health and query performance
5. **Scale**: Implement advanced patterns as needed

👨 **Daddy says:** Start with the gateway pattern and two MCP servers - it's the easiest way to see federation in action before adding complexity
