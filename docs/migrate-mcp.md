# Migration duckdb_mcp : C++ → TypeScript

## 🔗 Ressources

- **duckdb_mcp C++ repository**: https://github.com/teaguesterling/duckdb_mcp
- **DuckDB MCP extension docs**: https://duckdb.org/community_extensions/extensions/duckdb_mcp.html
- **DuckDB Node Neo**: https://github.com/duckdb/duckdb-node-neo

- **duckdb_mcp python**
  https://github.com/motherduckdb/mcp-server-motherduck

## 📂 Analyse du code C++ source

### Structure duckdb_mcp

```
duckdb_mcp/
├── src/
│   ├── protocol/         # Protocole MCP
│   │   ├── types.hpp     # Types JSON-RPC
│   │   ├── messages.cpp  # Format messages
│   │   └── transport.hpp # Transports stdio/TCP
│   ├── server/           # Serveur MCP
│   │   ├── resource_handler.cpp # Expose tables
│   │   └── tool_handler.cpp     # SQL queries
│   ├── client/           # Client MCP
│   │   └── resource_fetcher.cpp # Consomme ressources
│   └── mcpfs/            # Virtual filesystem
│       └── virtual_table.cpp    # Tables virtuelles
```

### Composants clés à porter

1. **Protocol** - Messages JSON-RPC 2.0
2. **ResourceHandler** - Expose tables/vues DuckDB
3. **ToolHandler** - Exécute queries SQL
4. **ResourceFetcher** - Consomme ressources externes
5. **VirtualTable** - Mappe ressources MCP → tables

## 🏗️ Architecture TypeScript cible

```
src/services/duckdb-mcp-native/
├── protocol/
│   ├── types.ts          # Types MCP JSON-RPC
│   ├── messages.ts       # Format/parse messages
│   └── transport.ts      # Stdio/HTTP transports
├── server/
│   ├── MCPServer.ts      # Classe serveur principale
│   ├── ResourceHandler.ts # Expose ressources
│   └── ToolHandler.ts    # Handle SQL tools
├── client/
│   ├── MCPClient.ts      # Client pour ressources
│   └── ResourceMapper.ts # Map → tables virtuelles
└── index.ts              # API publique

```

## 📝 Phase 1: Extraction des interfaces C++ (2 jours)

### Analyser les types C++

```bash
# Clone pour analyse
git clone https://github.com/teaguesterling/duckdb_mcp /tmp/duckdb_mcp
cd /tmp/duckdb_mcp

# Identifier les structures de données
grep -r "struct\|class" src/protocol/
grep -r "json::" src/  # Format JSON
```

### Mapper C++ → TypeScript

```cpp
// C++ (protocol/types.hpp)
struct MCPRequest {
    std::string method;
    json params;
    int id;
};
```

↓

```typescript
// TypeScript (protocol/types.ts)
interface MCPRequest {
  method: string
  params: Record<string, any>
  id: number
}
```

## 📦 Phase 2: Implementation TypeScript (5 jours)

### 2.1 Protocol Layer

```typescript
// protocol/messages.ts
import { z } from 'zod'

export const MCPRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.record(z.any()).optional(),
  id: z.union([z.string(), z.number()]),
})

export class MessageFormatter {
  static formatRequest(method: string, params?: any): MCPRequest {
    return {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    }
  }
}
```

### 2.2 Server Implementation

```typescript
// server/MCPServer.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { getDuckDBService } from '../../duckdb.js'

export class DuckDBMCPServer {
  private server: Server
  private duckdb: any

  constructor() {
    this.server = new Server({
      name: 'duckdb-mcp-native',
      version: '1.0.0',
    })
    this.setupHandlers()
  }

  private async setupHandlers() {
    // Resource listing
    this.server.setRequestHandler('resources/list', async () => {
      const tables = await this.duckdb.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'main'
      `)

      return {
        resources: tables.map((t) => ({
          uri: `duckdb://table/${t.table_name}`,
          name: t.table_name,
          mimeType: 'application/json',
        })),
      }
    })

    // Resource read
    this.server.setRequestHandler('resources/read', async (req) => {
      const tableName = req.uri.replace('duckdb://table/', '')
      const data = await this.duckdb.query(`SELECT * FROM ${tableName}`)
      return { contents: data }
    })

    // SQL tool
    this.server.setRequestHandler('tools/call', async (req) => {
      if (req.name === 'query') {
        const result = await this.duckdb.query(req.arguments.sql)
        return { result }
      }
    })
  }

  async start(transport: 'stdio' | 'http' = 'stdio') {
    if (transport === 'stdio') {
      const transport = new StdioServerTransport()
      await this.server.connect(transport)
    } else {
      // HTTP transport implementation
    }
  }
}
```

### 2.3 Client Implementation

```typescript
// client/MCPClient.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

export class DuckDBMCPClient {
  private client: Client
  private connected = false

  async connect(url: string) {
    this.client = new Client({
      name: 'duckdb-mcp-client',
      version: '1.0.0',
    })

    // Connect via stdio or HTTP
    await this.client.connect(/* transport */)
    this.connected = true
  }

  async listResources(): Promise<any[]> {
    const response = await this.client.request({
      method: 'resources/list',
    })
    return response.resources
  }

  async readResource(uri: string): Promise<any> {
    const response = await this.client.request({
      method: 'resources/read',
      params: { uri },
    })
    return response.contents
  }

  async createVirtualTable(resource: string, tableName: string) {
    const data = await this.readResource(resource)

    // Create temporary table in DuckDB
    const duckdb = await getDuckDBService()
    await duckdb.query(
      `
      CREATE OR REPLACE TABLE ${tableName} AS 
      SELECT * FROM read_json_auto(?)
    `,
      [JSON.stringify(data)]
    )
  }
}
```

## 🔧 Phase 3: Intégration avec infrastructure existante (3 jours)

### 3.1 Service unifié

```typescript
// services/duckdb-mcp-native/index.ts
export class DuckDBMcpNativeService {
  private servers = new Map<string, DuckDBMCPServer>()
  private clients = new Map<string, DuckDBMCPClient>()

  // Réutiliser cache existant
  private cache = await getCacheService()

  // Réutiliser auth existant
  private auth = getAuthProxyService()

  async startServer(name: string, config?: ServerConfig) {
    const server = new DuckDBMCPServer()
    await server.start(config?.transport || 'stdio')
    this.servers.set(name, server)
  }

  async attachMCP(url: string, alias: string) {
    const client = new DuckDBMCPClient()
    await client.connect(url)

    // Liste ressources avec cache
    const cacheKey = `mcp:resources:${url}`
    let resources = await this.cache.get(cacheKey)

    if (!resources) {
      resources = await client.listResources()
      await this.cache.set(cacheKey, resources, 300) // 5min TTL
    }

    this.clients.set(alias, client)
    return resources
  }
}
```

### 3.2 Intégration avec tools existants

```typescript
// tools/duckdb-mcp-native.ts
export async function mcpServe(params: { name: string; transport?: string }) {
  const service = getDuckDBMcpNativeService()
  await service.startServer(params.name, { transport: params.transport })
  return { status: 'server_started', name: params.name }
}

export async function mcpAttach(params: { url: string; alias: string }) {
  const service = getDuckDBMcpNativeService()
  const resources = await service.attachMCP(params.url, params.alias)
  return { status: 'attached', resources: resources.length }
}
```

## 🚀 Phase 4: Tests et validation (2 jours)

### Tests unitaires

```typescript
// tests/duckdb-mcp-native.test.ts
describe('DuckDBMcpNative', () => {
  it('should start MCP server', async () => {
    const service = new DuckDBMcpNativeService()
    await service.startServer('test')
    // Verify server is running
  })

  it('should attach remote MCP', async () => {
    const service = new DuckDBMcpNativeService()
    const resources = await service.attachMCP('mcp://remote', 'remote')
    expect(resources).toBeDefined()
  })

  it('should work with existing 53 tools', async () => {
    // Test interoperability
    const searchResult = await searchHub({
      tenant_id: 'test',
      space_id: 'default',
      query_text: 'test',
    })
    expect(searchResult).toBeDefined()
  })
})
```

## 📅 Timeline détaillé

### Semaine 1

- **Jour 1-2**: Analyse code C++, extraction interfaces
- **Jour 3**: Protocol layer TypeScript
- **Jour 4-5**: MCPServer basique

### Semaine 2

- **Jour 1-2**: MCPClient implementation
- **Jour 3**: Virtual table mapping
- **Jour 4-5**: Intégration cache/auth

### Semaine 3

- **Jour 1**: Tests unitaires
- **Jour 2**: Tests interopérabilité 53 tools
- **Jour 3-4**: Documentation
- **Jour 5**: Optimisations finales

## ✅ Checklist migration

- [ ] Analyser repo C++ duckdb_mcp
- [ ] Extraire interfaces protocole MCP
- [ ] Implémenter MessageFormatter
- [ ] Créer DuckDBMCPServer
- [ ] Créer DuckDBMCPClient
- [ ] Mapper ressources → tables virtuelles
- [ ] Intégrer cache existant
- [ ] Intégrer auth-proxy
- [ ] Tester avec 53 tools existants
- [ ] Documenter API publique

## 🎯 Livrables finaux

1. **Package npm** `duckdb-mcp-native` autonome
2. **Zero dépendance** C++ ou binaire externe
3. **API compatible** avec tools existants
4. **Documentation** complète TypeDoc
5. **Tests** > 90% coverage
