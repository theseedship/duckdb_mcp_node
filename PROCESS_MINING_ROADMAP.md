# **PROCESS MINING INTEGRATION ROADMAP**

## **Executive Summary**

This roadmap outlines the implementation of **process mining capabilities** for the existing `@seed-ship/duckdb-mcp-native` package. The implementation will expose process-related parquet resources, create specialized tools for process analysis, and provide LLM-optimized templates.

**Current State**: DuckDB MCP server (v0.9.1) with 14 tools, federation support, virtual tables, and parquet/CSV/JSON reading capabilities.

**Target State**: Enhanced MCP server with process mining tools that can analyze workflow steps, find similar processes via embeddings, and compose action plans.

---

## **PHASE 1: Resources Declaration (Parquet Views)**

### **1.1 Resource Schema Definition**

**Objective**: Define strict Zod schemas for all process-related parquet resources.

**Files to Create**:

- `src/types/process-schemas.ts` - Zod schemas for validation
- `src/types/process-types.ts` - TypeScript types

**Schemas Required**:

```typescript
// Core process views
- ProcessSummarySchema (doc_id, process_id, type, one_liner, steps_count, confidence, mermaid)
- ProcessStepSchema (doc_id, process_id, step_id, order, step_key, label, evidence, embedding[N])
- ProcessEdgeSchema (doc_id, process_id, from_step_id, to_step_id, relation, evidence)
- ProcessSignatureSchema (doc_id, process_id, signature_emb[N])

// Existing graph views (already supported)
- VertexSchema (reuse existing)
- EdgeSchema (reuse existing)

// Optional temporal views
- EventSchema (date, doc_id, label, evidence)
- IntervalSchema (start, end, doc_id, type, evidence)
- MetricTimeSchema (ts, metric, val, doc_id, unit)
- StateDeadlineSchema (date, type, info, doc_id)
```

**Confidence**: 95% (straightforward schema definition work)

---

### **1.2 Resource Registry Integration**

**Objective**: Register process parquet resources in the MCP server's resource list.

**Files to Modify**:

- `src/server/mcp-server.ts:1226` - `ListResourcesRequestSchema` handler

**Implementation**:

```typescript
// Add to ListResourcesRequestSchema handler
resources.push({
  uri: `duckdb://parquet/process_summary`,
  name: 'Process Summary',
  description: 'High-level process metadata with confidence scores',
  mimeType: 'application/x-parquet',
})
// ... repeat for process_steps, process_edges, process_signature
```

**Confidence**: 90% (follows existing pattern for table resources)

---

## **PHASE 2: Tools Implementation**

### **2.1 Core Process Tools**

**Objective**: Implement 3 core process tools as specified in the plan.

**Files to Create**:

- `src/tools/process-tools.ts` - Tool handlers
- `src/tools/process-queries.ts` - SQL query builders

**Tools to Implement**:

#### **Tool: `process.describe`**

```typescript
Input: { topN?: number }
Output: { doc_id, process_id, type, one_liner, steps_count, confidence }[]
SQL: SELECT * FROM read_parquet(:summary) ORDER BY confidence DESC LIMIT :topN
```

#### **Tool: `process.similar`**

```typescript
Input: { signature_emb: number[], k?: number }
Output: { doc_id, process_id, distance }[]
SQL: SELECT *, list_distance(signature_emb, :q) AS d
     FROM read_parquet(:signatures)
     ORDER BY d ASC LIMIT :k
```

#### **Tool: `process.compose`**

```typescript
Input: { doc_ids: string[] }
Output: { steps: ProcessStep[], edges: ProcessEdge[] }
Logic:
  1. Load process_steps for each doc_id
  2. Order by `order` field
  3. Deduplicate by step_key
  4. Return merged steps + edges
```

**Files to Modify**:

- `src/server/mcp-server.ts:141` - Add tools to `ListToolsRequestSchema`
- `src/server/mcp-server.ts:530` - Add cases to `CallToolRequestSchema`

**Dependencies**:

- DuckDB vector distance functions (list_distance, l2_distance)
- Parquet reading via read_parquet()

**Confidence**: 75% (vector distance functions need validation, embedding format must match)

---

### **2.2 SQL Query Tool Enhancement**

**Objective**: Ensure `sql.query` tool supports multi-resource parquet queries with parameters.

**Files to Modify**:

- `src/server/mcp-server.ts:544` - `query_duckdb` case

**Enhancement**:

```typescript
case 'query_duckdb': {
  const sql = args.sql as string
  const params = args.params as Record<string, any> || {}

  // Parameterized query support (DuckDB style)
  // Example: SELECT * FROM read_parquet($summary) WHERE confidence > $threshold
  // Convert params to DuckDB prepared statement format

  const safeSql = replaceParams(sql, params) // Implement safe parameter substitution
  const results = await this.duckdb.executeQueryWithVFS(safeSql)

  return { success: true, data: results }
}
```

**Security Requirements**:

- Always use parameterized queries
- Validate parquet URLs (whitelist S3/MinIO/HTTP sources)
- Apply LIMIT clause by default (100 rows)

**Confidence**: 85% (parameter substitution needs careful implementation)

---

## **PHASE 3: Templates (Prompts)**

### **3.1 Process Templates**

**Objective**: Create LLM-optimized prompt templates for common process tasks.

**Files to Modify**:

- `src/server/mcp-server.ts:1323` - `ListPromptsRequestSchema` handler
- `src/server/mcp-server.ts:1417` - `GetPromptRequestSchema` handler

**Templates to Add**:

#### **Template: `process_describe`**

```typescript
{
  name: 'process_describe',
  description: 'Describe the top-N processes by confidence',
  arguments: [{ name: 'topN', required: false, default: 5 }],
  messages: [{
    role: 'user',
    content: `Use the process.describe tool with topN=${topN}.
              For each process, summarize:
              1. Type and one-liner description
              2. Number of steps
              3. Confidence score
              4. First 3 steps (use process_steps parquet)`
  }]
}
```

#### **Template: `process_find_similar`**

```typescript
{
  name: 'process_find_similar',
  description: 'Find similar processes using embeddings',
  arguments: [{ name: 'query', required: true }, { name: 'k', required: false, default: 5 }],
  messages: [{
    role: 'user',
    content: `1. Embed the query: "${query}" (use external embedding service)
              2. Call process.similar with signature_emb and k=${k}
              3. For each result, show doc_id, process type, and distance
              4. Fetch full details from process_summary`
  }]
}
```

#### **Template: `process_compose_plan`**

```typescript
{
  name: 'process_compose_plan',
  description: 'Compose an action plan from multiple processes',
  arguments: [{ name: 'doc_ids', required: true }],
  messages: [{
    role: 'user',
    content: `Use process.compose with doc_ids=${doc_ids}.
              Generate a unified action plan:
              1. List merged steps in order
              2. Show decision points (branches in edges)
              3. Highlight duplicates (same step_key)
              4. Render as mermaid flowchart`
  }]
}
```

**Confidence**: 80% (templates are mostly descriptive, success depends on LLM following instructions)

---

## **PHASE 4: Integration & Testing**

### **4.1 Environment Configuration**

**Files to Create**:

- `.env.process` - Example configuration

**Required Environment Variables**:

```bash
# Process parquet URLs (S3/MinIO/HTTP)
PROCESS_SUMMARY_URL=s3://bucket/parquet/{doc_uuid}/process_summary.parquet
PROCESS_STEPS_URL=s3://bucket/parquet/{doc_uuid}/process_steps.parquet
PROCESS_EDGES_URL=s3://bucket/parquet/{doc_uuid}/process_edges.parquet
PROCESS_SIGNATURE_URL=s3://bucket/parquet/{doc_uuid}/process_signature.parquet

# Optional: Embedding service
EMBEDDING_SERVICE_URL=http://localhost:8000/embed
EMBEDDING_MODEL=all-MiniLM-L6-v2
```

**Confidence**: 90%

---

### **4.2 Unit Tests**

**Files to Create**:

- `src/tools/process-tools.test.ts` - Tool unit tests
- `tests/integration/process-flow.test.ts` - End-to-end tests

**Test Coverage**:

```typescript
describe('process.describe', () => {
  it('should return top-N processes by confidence')
  it('should handle empty parquet files')
  it('should validate topN parameter')
})

describe('process.similar', () => {
  it('should find similar processes using L2 distance')
  it('should handle invalid embeddings')
  it('should respect k parameter')
})

describe('process.compose', () => {
  it('should merge steps from multiple docs')
  it('should deduplicate by step_key')
  it('should preserve edge relationships')
})
```

**Target Coverage**: 80% (per project CLAUDE.md requirements)

**Confidence**: 70% (integration tests require real parquet data)

---

### **4.3 MCP Inspector Testing**

**Objective**: Validate tools using MCP Inspector UI.

**Commands**:

```bash
npm run inspector  # Start Inspector on port 6277

# Test sequence:
1. List resources → verify parquet.process_* appears
2. Call process.describe → validate JSON response
3. Call process.similar with mock embedding → check distance sorting
4. Call process.compose with 2+ doc_ids → verify merged steps
5. Use GetPrompt → validate template rendering
```

**Confidence**: 85% (Inspector is already working)

---

## **PHASE 5: Documentation**

### **5.1 API Documentation**

**Files to Create**:

- `docs/PROCESS_MINING.md` - Complete API reference

**Sections**:

1. Overview
2. Parquet Schema Reference
3. Tool API (process.describe, process.similar, process.compose)
4. Template Usage Examples
5. Embedding Integration Guide
6. Performance Tuning (parquet partitioning, vector indexing)

**Confidence**: 95%

---

### **5.2 Example Notebooks**

**Files to Create**:

- `examples/process-analysis.ts` - TypeScript example
- `examples/process-notebook.ipynb` - Jupyter notebook (optional)

**Confidence**: 80%

---

## **RISKS & MITIGATION**

### **Risk 1: DuckDB Vector Distance Functions**

**Issue**: DuckDB's vector distance functions (list_distance, l2_distance) may not support FLOAT[] arrays directly.

**Mitigation**:

- Test with mock data first (Phase 4.2)
- Fallback: Implement distance calculation in TypeScript
- Alternative: Use DuckDB's array_distance() if available

**Impact**: Medium (could require custom distance function)

---

### **Risk 2: Embedding Format Mismatch**

**Issue**: Parquet embedding columns must match DuckDB's FLOAT[] type exactly.

**Mitigation**:

- Define strict schema validation in Zod
- Add embedding format tests
- Document required parquet column type: `FLOAT[N]` where N is fixed

**Impact**: High (breaks process.similar if wrong)

---

### **Risk 3: Parquet URL Resolution**

**Issue**: Dynamic `{doc_uuid}` placeholders in URLs need runtime substitution.

**Mitigation**:

- Implement URL template resolver in process-tools.ts
- Support glob patterns: `s3://bucket/parquet/*/process_summary.parquet`
- Cache resolved URLs per session

**Impact**: Medium (affects all tools)

---

### **Risk 4: Performance with Large Parquet Files**

**Issue**: Loading full parquet files for every query may be slow.

**Mitigation**:

- Always use LIMIT clauses (default 100)
- Implement parquet metadata caching
- Use DuckDB's partition pruning
- Consider materialized views for hot queries

**Impact**: Medium (UX degradation if slow)

---

## **REVISED TASK SEQUENCING**

```
WEEK 1: Foundation
├─ Day 1-2: Phase 1.1 (Schemas) → Phase 1.2 (Resources)
├─ Day 3-4: Phase 2.1 (process.describe + process.similar)
└─ Day 5: Risk mitigation (test vector distance functions)

WEEK 2: Implementation
├─ Day 6-7: Phase 2.1 (process.compose)
├─ Day 8-9: Phase 2.2 (sql.query enhancements)
└─ Day 10: Phase 3.1 (Templates)

WEEK 3: Testing & Docs
├─ Day 11-12: Phase 4.2 (Unit tests)
├─ Day 13: Phase 4.3 (Inspector testing)
├─ Day 14: Phase 5.1 (Documentation)
└─ Day 15: Phase 5.2 (Examples)
```

---

## **SUCCESS CRITERIA**

**Must Have**:

- ✅ All 3 process tools working (describe, similar, compose)
- ✅ 80%+ test coverage
- ✅ MCP Inspector validation passes
- ✅ Documentation complete

**Nice to Have**:

- ⭐ Jupyter notebook examples
- ⭐ Performance benchmarks (>1000 rows/sec)
- ⭐ Embedding service integration example

**Blocked By**:

- 🚫 Availability of real process parquet data (can use mock data for now)
- 🚫 Embedding service for process.similar (can use random vectors for testing)

---

## **CONFIDENCE SCORES**

| Component           | Confidence | Rationale                              |
| ------------------- | ---------- | -------------------------------------- |
| Resource schemas    | 95%        | Straightforward Zod definitions        |
| process.describe    | 90%        | Simple SQL query                       |
| process.compose     | 75%        | Complex merging logic                  |
| process.similar     | 70%        | **Depends on vector functions**        |
| Templates           | 80%        | LLM-dependent, but testable            |
| Integration tests   | 70%        | **Requires real parquet data**         |
| Documentation       | 95%        | Existing docs are well-structured      |
| **Overall Project** | **78%**    | **High-risk areas: embeddings & perf** |

---

## **FINAL RECOMMENDATIONS**

1. **Start with Phase 1 + Phase 2.1 (process.describe)** → Low-risk, high-value
2. **Defer process.similar until vector functions are validated** → De-risk early
3. **Use mock parquet data for testing** → Don't block on data pipeline
4. **Parallel track: Document as you code** → Avoid last-minute doc rush
5. **Weekly checkpoints with opinion agent** → Course-correct early

---

**Confidence Score: 78% (Good but with identified risks)**

**Key Dependencies**:

- ✅ DuckDB vector distance functions (needs validation)
- ⚠️ Real process parquet data (can use mocks)
- ✅ Existing MCP server infrastructure (already solid)
- ⚠️ Embedding service integration (optional for MVP)

---

**Status**: Ready to implement. Starting with Phase 1.1 (Schema Definition).
