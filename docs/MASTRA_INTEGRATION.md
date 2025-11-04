# Mastra AI Framework Integration

**Status**: Phase 0 - Preparation (November 2025)
**Timeline**: Q1 2026 (Phase 1), Q2 2026 (Phase 2), Q3 2026 (Phase 3)
**Integration Type**: Progressive enhancement with adapter pattern

---

## Overview

This document outlines the phased integration of [Mastra AI Framework](https://mastra.ai) with DuckDB MCP Native, enabling powerful AI agents powered by DuckDB's analytical capabilities.

### Why Mastra?

- **TypeScript-Native**: If you know TypeScript, you already know 90% of Mastra
- **MCP First-Class Support**: `@mastra/mcp` provides bidirectional MCP integration
- **Production-Ready**: Batteries included (workflows, HITL, observability, state management)
- **Rapid Growth**: Y Combinator W25 backed, 7.5K+ GitHub stars
- **Perfect Synergy**: DuckDB (analytics) + Mastra (orchestration) = Process mining agents

### Strategic Value

1. **Process Mining Agents**: Workflow discovery, similarity search, composition agents
2. **Natural Language Queries**: NL-to-SQL translation with SLMs
3. **Multi-Agent Orchestration**: Complex analytical workflows
4. **Ecosystem Positioning**: Reference implementation for DuckDB + AI agents

---

## Integration Phases

### Phase 0: Preparation (CURRENT - November 2025)

**Status**: ✅ IN PROGRESS
**Effort**: ~10 hours
**Deliverables**:

- [x] Export path `/mastra` in package.json
- [x] Adapter skeleton `src/adapters/mastra-adapter.ts`
- [x] Documentation (this file)
- [ ] README.md updated with "Coming Soon" section
- [ ] API stability guarantees documented

**Timeline**: Week of November 4-8, 2025

---

### Phase 1: Amorçage - Proof of Concept (December 2025 - January 2026)

**Status**: 🔜 PLANNED
**Effort**: ~25-35 hours
**Goal**: Create minimal working Mastra integration, validate concept

#### Deliverables

1. **Mastra Tool Adapter** (12h)
   - Implement `convertToMastraTools()` function
   - Zod schema → JSON Schema conversion
   - Wrapper for 6 native tools (query_duckdb, list_tables, etc.)
   - Error handling and timeout support

2. **Example Agent** (6h)
   - `examples/mastra-agent-example.ts` - SQL Analytics Agent
   - Uses Claude 3.5 Sonnet + DuckDB tools
   - Natural language → SQL execution
   - Documentation with use cases

3. **Validation Tests** (8h)
   - Unit tests for schema conversion
   - Integration tests with real Mastra agents
   - Example agent validation
   - 80%+ coverage for adapter layer

4. **Community Announcement** (4h)
   - Blog post: "DuckDB + Mastra: AI Agents for Data Analysis"
   - Share on Twitter, Mastra Discord, Reddit
   - Collect community feedback

**Success Criteria**:

- ✅ Mastra agent can call `query_duckdb` tool
- ✅ Schema conversion works for all 6 tools
- ✅ Example is reproducible and documented
- ✅ Positive community feedback

**Release**: v0.11.0 - Mastra Integration (Experimental)

---

### Phase 2: Full Integration (February - April 2026)

**Status**: 📅 PLANNED
**Effort**: ~50-60 hours
**Goal**: Production-ready Mastra integration with advanced features

#### Deliverables

1. **Mastra MCPServer** (16h)
   - Wrap DuckDBMCPServer for Mastra compatibility
   - Expose all 14 server tools via Mastra's MCPServer
   - Resources and prompts integration
   - Bidirectional MCP communication

2. **Process Mining Agents** (24h)
   - **Workflow Discovery Agent**: Analyze process_steps parquet
   - **Similarity Search Agent**: Find analogous workflows
   - **Composition Agent**: Merge processes with QA validation
   - Agent coordination patterns

3. **Multi-Agent Orchestration** (16h)
   - Complex workflows: Discovery → Similarity → Composition
   - State management with Mastra workflows
   - Example: `examples/multi-agent-process-analysis.ts`
   - Performance optimization

4. **Documentation & Training** (12h)
   - Complete Mastra integration guide
   - Video tutorial (15-20 minutes)
   - API reference with examples
   - Migration guide from v0.x to v1.0

**Success Criteria**:

- ✅ MCPServer exposes all 14 tools
- ✅ 3 process mining agents implemented
- ✅ Multi-agent workflow validated E2E
- ✅ Performance acceptable (<2s latency)
- ✅ Production deployments successful

**Release**: v1.0.0 - Production Mastra Integration

---

### Phase 3: Advanced Features (May - September 2026)

**Status**: 💡 VISION
**Effort**: ~40-50 hours
**Goal**: Leverage Mastra's cutting-edge capabilities

#### Deliverables

1. **SLM Integration** (20h) 🔒 INTERNAL FEATURE
   - Space-aware SLM agents (qwen2.5:0.5b via Ollama)
   - Natural language → SQL translation per space
   - Context building with SpaceContext
   - **Note**: Internal/hidden strategic feature initially

2. **DuckDB Vector Store** (16h)
   - Integration with @mastra/duckdb vector store (if available)
   - Custom adapter if needed (DuckDB VSS extension)
   - Semantic search on process embeddings
   - Performance benchmarks (<500ms latency)

3. **Human-in-the-Loop Workflows** (12h)
   - Suspend/resume capability
   - QA validation with human approval
   - State persistence for long workflows
   - Example: Process validation workflow

**Success Criteria**:

- ✅ SLM NL-to-SQL accuracy >80%
- ✅ Vector search latency <500ms
- ✅ HITL workflows production-ready

**Release**: v1.2.0 - Advanced Mastra Capabilities

---

## API Reference (Phase 0 - Skeleton)

### Module: `@seed-ship/duckdb-mcp-native/mastra`

```typescript
import {
  convertToMastraTools,
  convertProcessToolsToMastra,
  createMastraMCPServer,
  type MastraToolAdapter,
  type MastraAdapterConfig,
} from '@seed-ship/duckdb-mcp-native/mastra'
```

#### Functions

##### `convertToMastraTools(config?: MastraAdapterConfig): MastraToolAdapter[]`

Converts 6 native DuckDB tools to Mastra-compatible format.

**Status**: Phase 1 implementation
**Throws**: `Error` - Not yet implemented (Phase 0)

**Example** (Phase 1):

```typescript
import { Mastra, Agent } from '@mastra/core'
import { convertToMastraTools } from '@seed-ship/duckdb-mcp-native/mastra'

const agent = new Agent({
  name: 'SQL Analytics Agent',
  tools: convertToMastraTools({ duckdb: myDuckDBInstance }),
  model: { provider: 'ANTHROPIC', name: 'claude-3-5-sonnet-20241022' },
})

const result = await agent.generate({
  messages: [{ role: 'user', content: 'Show me top 5 users by order count' }],
})
```

##### `convertProcessToolsToMastra(config?: MastraAdapterConfig): MastraToolAdapter[]`

Converts 3 process mining tools to Mastra format.

**Status**: Phase 2 implementation
**Throws**: `Error` - Not yet implemented (Phase 0)

**Example** (Phase 2):

```typescript
const processAgent = new Agent({
  name: 'Process Mining Agent',
  tools: [...convertToMastraTools(), ...convertProcessToolsToMastra()],
  instructions: `You analyze process mining data...`,
})
```

##### `createMastraMCPServer(config?: MastraAdapterConfig): unknown`

Creates Mastra MCPServer exposing DuckDB tools.

**Status**: Phase 2 implementation
**Throws**: `Error` - Not yet implemented (Phase 0)

---

## Use Cases

### Use Case 1: SQL Analytics Agent (Phase 1)

**Problem**: Business analysts need to query data but don't know SQL.

**Solution**: Mastra agent translates natural language to SQL using DuckDB tools.

```typescript
const analyticsAgent = new Agent({
  name: 'Business Intelligence Agent',
  tools: convertToMastraTools(),
  instructions: `You are a SQL expert. Convert natural language questions into SQL queries...`,
  model: { provider: 'ANTHROPIC', name: 'claude-3-5-sonnet' },
})

await analyticsAgent.generate({
  messages: [{ role: 'user', content: 'What were our top selling products last quarter?' }],
})
```

### Use Case 2: Process Mining Workflow (Phase 2)

**Problem**: Analyzing workflows across multiple documents is complex.

**Solution**: Multi-agent workflow for comprehensive process analysis.

```typescript
const analysisWorkflow = new Workflow({
  name: 'Process Mining Analysis',
  steps: [
    { id: 'discover', agent: workflowDiscoveryAgent },
    {
      id: 'similar',
      agent: similaritySearchAgent,
      input: ({ discover }) => ({ ref: discover.top }),
    },
    { id: 'compose', agent: compositionAgent, input: ({ similar }) => ({ docs: similar.top5 }) },
  ],
})

const result = await analysisWorkflow.execute({
  data_source: 's3://bucket/process_steps.parquet',
})
```

### Use Case 3: Human-in-the-Loop Validation (Phase 3)

**Problem**: Process composition needs human review for critical workflows.

**Solution**: HITL workflow with suspend/resume.

```typescript
const validationWorkflow = new Workflow({
  steps: [
    { id: 'compose', execute: async () => processCompose(...) },
    { id: 'review', execute: async ({ composed }) => {
      if (composed.qa.warnings.length > 0) {
        return await workflow.waitForHuman({
          message: 'QA warnings detected. Approve?',
          actions: ['approve', 'reject', 'modify']
        })
      }
    }},
    { id: 'finalize', execute: async ({ approved }) => ... }
  ]
})
```

---

## Testing Strategy

### Local Development Testing

**Test Environment**: localhost:3003/search
**Purpose**: Rapid iteration on features before integration

```bash
# Start test server (if available)
npm run dev:test-server

# Open browser
open http://localhost:3003/search
```

### Unit Tests (Phase 1+)

```bash
npm run test:mastra
```

**Coverage Target**: 80%+ for adapter layer

### Integration Tests (Phase 2+)

```bash
npm run test:mastra:integration
```

**Tests**: Real Mastra agents with LLM calls (sample only, CI skip for cost)

---

## Dependencies

### Phase 1 Dependencies

```json
{
  "dependencies": {
    "@mastra/core": "^0.x.x",
    "zod-to-json-schema": "^3.x.x"
  },
  "devDependencies": {
    "@types/node": "^22.x.x"
  }
}
```

### Phase 2 Additional Dependencies

```json
{
  "dependencies": {
    "@mastra/mcp": "^0.x.x"
  }
}
```

### Phase 3 Additional Dependencies (If needed)

```json
{
  "dependencies": {
    "@mastra/duckdb": "^0.x.x"
  }
}
```

---

## API Stability Guarantee

### Experimental Phase (v0.x)

- **Versions**: v0.10.x - v0.99.x
- **Stability**: EXPERIMENTAL
- **Breaking Changes**: Possible between minor versions
- **Recommendation**: Pin exact versions, test before upgrading

### Stable Phase (v1.x+)

- **Versions**: v1.0.0+
- **Stability**: STABLE
- **Semantic Versioning**: Strict adherence
  - **Major (v1 → v2)**: Breaking changes
  - **Minor (v1.0 → v1.1)**: New features, backward compatible
  - **Patch (v1.0.0 → v1.0.1)**: Bug fixes, backward compatible
- **Recommendation**: Use `^1.0.0` range for auto-updates

---

## Contributing

### Mastra Integration Contributions Welcome!

**GitHub Issue**: [Epic: Mastra Integration](#) (TBD)

**Areas Needing Help**:

- [ ] Phase 1: Mastra tool adapter implementation
- [ ] Phase 1: Example agents and use cases
- [ ] Phase 2: Process mining agent patterns
- [ ] Phase 3: Vector store optimization
- [ ] Documentation improvements
- [ ] Community examples and tutorials

**How to Contribute**:

1. Comment on GitHub issue expressing interest
2. Fork repository, create feature branch
3. Implement feature with tests
4. Submit PR with clear description
5. Participate in code review

---

## Resources

### Mastra Documentation

- **Official Docs**: https://mastra.ai/docs
- **GitHub**: https://github.com/mastra-ai/mastra
- **Discord**: https://mastra.ai/discord
- **Examples**: https://github.com/mastra-ai/mastra/tree/main/examples

### DuckDB MCP Native

- **Main README**: ../README.md
- **Process Mining**: PROCESS_MINING_ROADMAP.md
- **Architecture**: ARCHITECTURE.md
- **API Docs**: https://github.com/theseedship/duckdb_mcp_node

### Related Resources

- **Model Context Protocol**: https://modelcontextprotocol.io
- **Anthropic MCP SDK**: https://github.com/anthropics/mcp-sdk
- **Mastra MCP Integration**: https://mastra.ai/docs/mcp

---

## FAQ

### Q: When will Mastra integration be production-ready?

**A**: Phase 1 (experimental) is planned for Q1 2026 (December 2025 - January 2026). Phase 2 (production-ready) is targeted for Q2 2026 (v1.0.0 release).

### Q: Can I use Mastra integration before v1.0.0?

**A**: Yes, but be aware it's experimental (v0.x). API changes are possible. Recommended for early adopters and testing only.

### Q: Will Mastra integration work with my existing tools?

**A**: Yes! Phase 0 preparation ensures backward compatibility. Mastra integration is additive - existing tools continue working as before.

### Q: What LLM providers are supported?

**A**: Mastra supports 40+ providers (OpenAI, Anthropic, Google, Llama, Ollama, etc.). You can use any provider Mastra supports with DuckDB tools.

### Q: How does this relate to the SLM integration mentioned in internal docs?

**A**: Phase 3 includes SLM (Small Language Models) integration with Ollama for space-aware NL-to-SQL. This is initially an internal feature and will be publicly released when ready.

### Q: What's the performance impact?

**A**: Phase 1 benchmarks will provide data. Initial estimates: <2s latency for tool calls (primarily LLM latency), negligible adapter overhead (<50ms).

### Q: Can I help with development?

**A**: Absolutely! See [Contributing](#contributing) section above. Community contributions are welcome and encouraged.

---

## Changelog

### November 4, 2025 - Phase 0 Started

- Created export path `/mastra` in package.json
- Created adapter skeleton `src/adapters/mastra-adapter.ts`
- Created this integration guide
- Set up project structure for phased rollout

### Planned: December 2025 - Phase 1 Kickoff

- Implement `convertToMastraTools()` function
- Create example SQL Analytics Agent
- Publish blog post and announce to community
- Release v0.11.0 (Mastra Integration - Experimental)

### Planned: February 2026 - Phase 2 Kickoff

- Implement Mastra MCPServer wrapper
- Create 3 process mining agents
- Multi-agent orchestration examples
- Release v1.0.0 (Mastra Integration - Production)

---

**Last Updated**: November 4, 2025
**Next Review**: December 1, 2025 (Phase 1 kickoff)
**Maintainer**: duckdb-mcp-native core team

**Questions? Open an issue on GitHub or join our Discord!**
