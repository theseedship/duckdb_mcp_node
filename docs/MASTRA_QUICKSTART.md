# Mastra Phase 1 - Quick Start Guide

**Your branch**: `feature/mastra-phase-1-adapter`
**Your goal**: Make Mastra integration work with DuckDB
**Timeline**: 6-8 weeks (25-35 hours)

---

## Day 1: Setup (2 hours)

### Step 1: Get the code (10 min)

```bash
# Clone if you haven't
git clone https://github.com/theseedship/duckdb_mcp_node.git
cd duckdb_mcp_node

# Checkout your branch
git checkout feature/mastra-phase-1-adapter
git pull origin feature/mastra-phase-1-adapter

# Install dependencies
npm install
```

### Step 2: Verify it works (10 min)

```bash
# Build
npm run build

# Run tests
npm test

# Start server (optional)
npm run dev:server
```

**Expected**: Everything should pass ✅

### Step 3: Install Mastra dependencies (5 min)

```bash
npm install @mastra/core zod-to-json-schema
npm install --save-dev @types/node
```

### Step 4: Read documentation (90 min)

**Read in this order**:

1. `CLAUDE.md` - Project conventions (15 min)
2. `docs/MASTRA_INTEGRATION.md` - Your spec (30 min) ⭐ **MOST IMPORTANT**
3. `src/adapters/mastra-adapter.ts` - Starting point (20 min)
4. `src/tools/native-tools.ts` - Tools to convert (20 min)
5. Skim `src/duckdb/service.ts` - DuckDB service (5 min)

**Done?** You're ready to code! 🎉

---

## Your Tasks (Week by Week)

### Week 1-2: Schema Conversion (6h)

**Goal**: Convert Zod schemas to JSON Schema

**Files to create/modify**:

- `src/adapters/mastra-adapter.ts` (modify)
- `src/adapters/mastra-adapter.test.ts` (create)

**What to do**:

```typescript
// In src/adapters/mastra-adapter.ts

import { zodToJsonSchema } from 'zod-to-json-schema'

// Add this helper function
function convertZodSchema(zodSchema: z.ZodType): JSONSchema {
  return zodToJsonSchema(zodSchema, {
    name: undefined,
    $refStrategy: 'none',
  })
}

// Test it works
export function convertToMastraTools(_config?: MastraAdapterConfig): MastraToolAdapter[] {
  // Start simple - convert 1 tool first
  const queryTool = nativeToolDefinitions.find((t) => t.name === 'query_duckdb')

  if (!queryTool) throw new Error('query_duckdb tool not found')

  return [
    {
      id: queryTool.name,
      description: queryTool.description,
      inputSchema: convertZodSchema(queryTool.inputSchema),
      execute: async (params: unknown) => {
        // For now, just call the handler
        const handler = nativeToolHandlers[queryTool.name]
        return await handler(params)
      },
    },
  ]
}
```

**Test it**:

```typescript
// Create src/adapters/mastra-adapter.test.ts

import { describe, it, expect } from 'vitest'
import { convertToMastraTools } from './mastra-adapter'

describe('Mastra Adapter - Schema Conversion', () => {
  it('should convert query_duckdb schema', () => {
    const tools = convertToMastraTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].id).toBe('query_duckdb')
    expect(tools[0].inputSchema.type).toBe('object')
    expect(tools[0].inputSchema.properties).toHaveProperty('sql')
  })
})
```

```bash
npm test src/adapters/mastra-adapter.test.ts
```

**Milestone**: Schema conversion works for 1 tool ✅

---

### Week 3-4: Complete Tool Adapter (12h)

**Goal**: Convert all 6 native tools

**What to do**:

```typescript
// In src/adapters/mastra-adapter.ts

export function convertToMastraTools(_config?: MastraAdapterConfig): MastraToolAdapter[] {
  // Now convert ALL tools
  return nativeToolDefinitions.map((tool) => ({
    id: tool.name,
    description: tool.description,
    inputSchema: convertZodSchema(tool.inputSchema),
    execute: async (params: unknown) => {
      const handler = nativeToolHandlers[tool.name]

      // Add error handling
      try {
        const result = await handler(params, _config?.duckdb)
        return result
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    },
  }))
}
```

**Add timeout support**:

```typescript
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
  ])
}

// Use it in execute:
execute: async (params: unknown) => {
  const timeout = _config?.timeout || 30000
  return await withTimeout(handler(params), timeout)
}
```

**Test all 6 tools**:

```typescript
// In mastra-adapter.test.ts

describe('Tool Conversion', () => {
  it('should convert all 6 native tools', () => {
    const tools = convertToMastraTools()
    expect(tools).toHaveLength(6)

    const toolNames = tools.map((t) => t.id)
    expect(toolNames).toContain('query_duckdb')
    expect(toolNames).toContain('list_tables')
    expect(toolNames).toContain('describe_table')
    expect(toolNames).toContain('load_csv')
    expect(toolNames).toContain('load_parquet')
    expect(toolNames).toContain('export_data')
  })

  it('should handle errors gracefully', async () => {
    const tools = convertToMastraTools()
    const queryTool = tools.find((t) => t.id === 'query_duckdb')

    // Test with invalid params
    const result = await queryTool.execute({ invalid: 'params' })
    expect(result.success).toBe(false)
  })
})
```

**Milestone**: All 6 tools converted and tested ✅

---

### Week 5-6: Example Agent (8h)

**Goal**: Create working SQL Analytics Agent

**Files to create**:

- `examples/mastra-sql-agent.ts`
- `examples/README.md` (update)

**What to do**:

```typescript
// Create examples/mastra-sql-agent.ts

import { Agent } from '@mastra/core'
import { convertToMastraTools } from '../src/adapters/mastra-adapter'
import { getDuckDBService } from '../src/duckdb/service'

// Get API key from environment
const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  throw new Error('ANTHROPIC_API_KEY environment variable required')
}

// Create DuckDB service
const duckdb = getDuckDBService({ memory: '512MB' })

// Create agent
const sqlAgent = new Agent({
  name: 'SQL Analytics Agent',
  instructions: `You are a SQL expert assistant.

  When given a natural language question:
  1. Use list_tables to see available tables
  2. Use describe_table to understand the schema
  3. Construct an optimized SQL query
  4. Execute with query_duckdb
  5. Explain the results in business terms

  Always be clear about any assumptions you make.`,

  tools: convertToMastraTools({ duckdb }),

  model: {
    provider: 'ANTHROPIC',
    name: 'claude-3-5-sonnet-20241022',
  },
})

// Example usage
async function main() {
  console.log('🤖 SQL Analytics Agent\n')

  // Create sample data
  await duckdb.query(`
    CREATE TABLE products (
      id INTEGER,
      name VARCHAR,
      price DECIMAL,
      category VARCHAR
    )
  `)

  await duckdb.query(`
    INSERT INTO products VALUES
      (1, 'Laptop', 999.99, 'Electronics'),
      (2, 'Mouse', 29.99, 'Electronics'),
      (3, 'Desk', 299.99, 'Furniture')
  `)

  // Ask agent
  const result = await sqlAgent.generate({
    messages: [
      {
        role: 'user',
        content: 'What products do we have and what are their prices?',
      },
    ],
  })

  console.log('Agent response:', result.text)
  console.log('\nData returned:', result.data)
}

main().catch(console.error)
```

**Test it**:

```bash
# Set your API key
export ANTHROPIC_API_KEY="your-key-here"

# Run the example
npx tsx examples/mastra-sql-agent.ts
```

**Expected output**:

```
🤖 SQL Analytics Agent

Agent response: We have 3 products in our inventory:
1. Laptop (Electronics) - $999.99
2. Mouse (Electronics) - $29.99
3. Desk (Furniture) - $299.99

The products span two categories: Electronics and Furniture,
with prices ranging from $29.99 to $999.99.

Data returned: [
  { id: 1, name: 'Laptop', price: 999.99, category: 'Electronics' },
  { id: 2, name: 'Mouse', price: 29.99, category: 'Electronics' },
  { id: 3, name: 'Desk', price: 299.99, category: 'Furniture' }
]
```

**Milestone**: Example agent works end-to-end ✅

---

### Week 7: Documentation (6h)

**Goal**: Update docs with your results

**Files to update**:

- `README.md` (Mastra section)
- `docs/MASTRA_INTEGRATION.md` (Phase 1 results)
- `examples/README.md` (new examples)

**What to add to README.md**:

```markdown
## 🤖 Mastra AI Integration (v0.11.0+)

### Quick Example

\`\`\`typescript
import { Agent } from '@mastra/core'
import { convertToMastraTools } from '@seed-ship/duckdb-mcp-native/mastra'

const agent = new Agent({
name: 'SQL Analytics Agent',
tools: convertToMastraTools(),
model: { provider: 'ANTHROPIC', name: 'claude-3-5-sonnet' }
})

const result = await agent.generate({
messages: [{
role: 'user',
content: 'Show me the top 5 products by sales'
}]
})
\`\`\`

### Available Tools

All 6 native DuckDB tools are available to Mastra agents:

- `query_duckdb` - Execute SQL queries
- `list_tables` - List all tables
- `describe_table` - Get table schema
- `load_csv` - Import CSV files
- `load_parquet` - Import Parquet files
- `export_data` - Export query results

See [examples/mastra-sql-agent.ts](examples/mastra-sql-agent.ts) for complete example.
```

**What to update in MASTRA_INTEGRATION.md**:

Add Phase 1 results section:

```markdown
## Phase 1 Results ✅ COMPLETE (January 2026)

**Delivered**:

- `convertToMastraTools()` implemented for 6 native tools
- Schema conversion (Zod → JSON Schema) working
- Error handling and timeout support
- SQL Analytics Agent example
- Unit tests (85% adapter coverage)
- Integration tests with real Mastra agents

**Release**: v0.11.0 (January 28, 2026)

**What works**:

- All 6 tools callable from Mastra agents
- Natural language → SQL translation
- Error handling and timeouts
- Example agent runs successfully

**Known limitations** (to fix in Phase 2):

- Only 6 native tools (14 total exist)
- No process mining tools yet
- No MCPServer wrapper yet
```

**Milestone**: Documentation complete ✅

---

### Week 8: Release (3h)

**Goal**: Ship v0.11.0 with your work

**Tasks**:

1. **Final tests** (30 min)

   ```bash
   npm test
   npm run build
   npm run typecheck
   ```

2. **Create PR** (30 min)

   ```bash
   gh pr create \
     --title "feat(mastra): implement Phase 1 - tool adapter and examples" \
     --body "See CHANGELOG.md for details"
   ```

3. **Address review feedback** (1h)
   - User will review interface/API
   - Make changes as requested

4. **Celebrate** 🎉
   - Your code is merged!
   - v0.11.0 published to npm
   - Community can use Mastra + DuckDB!

---

## Helpful Commands

### Daily workflow

```bash
# Morning: sync your branch
git pull origin feature/mastra-phase-1-adapter

# Work on your code
# (edit files, run tests, commit)

# Evening: push your work
git add .
git commit -m "feat(mastra): implement schema conversion"
git push origin feature/mastra-phase-1-adapter
```

### Testing

```bash
# Run all tests
npm test

# Run only adapter tests
npm test src/adapters/mastra-adapter.test.ts

# Watch mode (re-run on changes)
npm test -- --watch

# Coverage
npm run test:coverage
```

### Debugging

```bash
# Type check (finds type errors)
npm run typecheck

# Lint check
npm run lint

# Fix lint issues automatically
npm run lint:fix
```

---

## Common Issues

### Issue 1: "Module not found: @mastra/core"

**Solution**: Install dependencies

```bash
npm install @mastra/core zod-to-json-schema
```

### Issue 2: "Cannot find module './native-tools'"

**Solution**: Build the project first

```bash
npm run build
```

### Issue 3: Tests fail with "DuckDB connection error"

**Solution**: Tests use mocked DuckDB, check your test setup

```typescript
// In your test file
import { vi } from 'vitest'

const mockDuckDB = {
  query: vi.fn().mockResolvedValue({ success: true, data: [] }),
}

const tools = convertToMastraTools({ duckdb: mockDuckDB })
```

### Issue 4: Example agent times out

**Solution**: Increase timeout in config

```typescript
const tools = convertToMastraTools({
  duckdb,
  timeout: 60000, // 60 seconds instead of 30
})
```

---

## External Resources

**Mastra Documentation**:

- Docs: https://mastra.ai/docs
- GitHub: https://github.com/mastra-ai/mastra
- Examples: https://github.com/mastra-ai/mastra/tree/main/examples
- Discord: https://mastra.ai/discord (ask questions here!)

**DuckDB Documentation**:

- Main docs: https://duckdb.org/docs/
- SQL reference: https://duckdb.org/docs/sql/introduction

**Zod to JSON Schema**:

- GitHub: https://github.com/StefanTerdell/zod-to-json-schema
- API docs: https://github.com/StefanTerdell/zod-to-json-schema#api

---

## Need Help?

1. **Check docs first**: `docs/MASTRA_INTEGRATION.md` has all the details
2. **Ask Mastra Discord**: https://mastra.ai/discord - Very helpful community
3. **Ask teammate**: Schedule quick 15 min sync
4. **Check GitHub issues**: Maybe someone else had the same problem

---

## Success Checklist

Before you consider Phase 1 done:

- [ ] All 6 tools converted to Mastra format
- [ ] Schema conversion working (Zod → JSON Schema)
- [ ] Error handling in place
- [ ] Timeout support implemented
- [ ] At least 1 example agent working
- [ ] Unit tests passing (aim for 80%+ adapter coverage)
- [ ] Documentation updated
- [ ] PR created and reviewed

**When all checked**: You've completed Mastra Phase 1! 🚀

---

**Questions?** See `docs/WORK_DISTRIBUTION.md` for coordination details.

**Let's make DuckDB + Mastra awesome!** 💪
