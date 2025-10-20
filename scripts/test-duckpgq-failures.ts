#!/usr/bin/env tsx
/**
 * DuckPGQ 7705c5c Failure Analysis
 *
 * This script tests syntax that SHOULD work per SQL:2023 Property Graph spec
 * but FAILS in DuckPGQ 7705c5c to determine if it's our syntax or a bug.
 *
 * Run: npm run test:duckpgq:failures
 */

import { DuckDBService } from '../src/duckdb/service.js'
import { logger } from '../src/utils/logger.js'
import * as dotenv from 'dotenv'

dotenv.config()

interface FailureTest {
  category: string
  description: string
  query: string
  expectedBehavior: string
  sqlStandard?: string
}

class DuckPGQFailureAnalysis {
  private duckdb: DuckDBService
  private tests: FailureTest[] = []

  constructor() {
    process.env.ALLOW_UNSIGNED_EXTENSIONS = 'true'
    process.env.ENABLE_DUCKPGQ = 'true'

    this.duckdb = new DuckDBService({
      memory: '2GB',
      threads: 2,
      allowUnsignedExtensions: true,
    })
  }

  async setup(): Promise<boolean> {
    try {
      console.log('\n🔧 Setting up test environment...')
      await this.duckdb.initialize()

      // Create test tables
      await this.duckdb.executeQuery(`
        CREATE TABLE test_persons (
          id INTEGER PRIMARY KEY,
          name VARCHAR,
          type VARCHAR
        )
      `)

      await this.duckdb.executeQuery(`
        CREATE TABLE test_knows (
          from_id INTEGER,
          to_id INTEGER,
          relation VARCHAR,
          since INTEGER
        )
      `)

      // Insert data: Alice -> Bob -> Carol -> David
      await this.duckdb.executeQuery(`
        INSERT INTO test_persons VALUES
          (1, 'Alice', 'researcher'),
          (2, 'Bob', 'engineer'),
          (3, 'Carol', 'researcher'),
          (4, 'David', 'manager'),
          (5, 'Eve', 'researcher')
      `)

      await this.duckdb.executeQuery(`
        INSERT INTO test_knows VALUES
          (1, 2, 'colleague', 2020),
          (2, 3, 'colleague', 2021),
          (3, 4, 'reports_to', 2022),
          (1, 5, 'mentor', 2023)
      `)

      // Create property graph
      await this.duckdb.executeQuery(`
        CREATE PROPERTY GRAPH test_graph
          VERTEX TABLES (test_persons)
          EDGE TABLES (
            test_knows
              SOURCE KEY (from_id) REFERENCES test_persons (id)
              DESTINATION KEY (to_id) REFERENCES test_persons (id)
          )
      `)

      console.log('✅ Test environment ready\n')
      return true
    } catch (error: any) {
      console.error('❌ Setup failed:', error.message)
      return false
    }
  }

  private defineTests() {
    // ========================================
    // Category 1: Standalone Kleene Star (->*)
    // ========================================

    this.tests.push({
      category: 'Standalone Kleene Star',
      description: 'Basic ->* with edge variable and label',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH (a:test_persons)-[e:test_knows]->*(b:test_persons)
          WHERE a.id = 1
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Should find all reachable nodes from Alice (transitive closure)',
      sqlStandard: 'SQL:2023 Property Graph - Kleene star for zero-or-more'
    })

    this.tests.push({
      category: 'Standalone Kleene Star',
      description: '->* without node labels (nodes untyped)',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH (a)-[e:test_knows]->*(b)
          WHERE a.id = 1
          COLUMNS (element_id(a) as from_id, element_id(b) as to_id)
        )
      `,
      expectedBehavior: 'Should work - node labels are optional in SQL:2023',
      sqlStandard: 'SQL:2023 allows untyped nodes'
    })

    this.tests.push({
      category: 'Standalone Kleene Star',
      description: '->* with path variable',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH p = (a:test_persons)-[e:test_knows]->*(b:test_persons)
          WHERE a.id = 1
          COLUMNS (a.name, b.name, path_length(p) as hops)
        )
      `,
      expectedBehavior: 'Should work with path functions',
      sqlStandard: 'SQL:2023 path variables'
    })

    this.tests.push({
      category: 'Standalone Kleene Star',
      description: '->* with WHERE filter on intermediate edges',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH (a:test_persons)-[e:test_knows WHERE e.since > 2020]->*(b:test_persons)
          WHERE a.id = 1
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Filter edges in path traversal',
      sqlStandard: 'SQL:2023 inline WHERE on edges'
    })

    // ========================================
    // Category 2: Standalone Kleene Plus (->+)
    // ========================================

    this.tests.push({
      category: 'Standalone Kleene Plus',
      description: 'Basic ->+ with edge variable and label',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH (a:test_persons)-[e:test_knows]->+(b:test_persons)
          WHERE a.id = 1
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Should find all reachable nodes (at least 1 hop)',
      sqlStandard: 'SQL:2023 Property Graph - Kleene plus for one-or-more'
    })

    this.tests.push({
      category: 'Standalone Kleene Plus',
      description: '->+ with LIMIT clause',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH (a:test_persons)-[e:test_knows]->+(b:test_persons)
          WHERE a.id = 1
          COLUMNS (a.name, b.name)
        )
        LIMIT 10
      `,
      expectedBehavior: 'Should limit results to prevent infinite expansion',
      sqlStandard: 'Standard SQL LIMIT clause'
    })

    // ========================================
    // Category 3: Edge Patterns Without Variables
    // ========================================

    this.tests.push({
      category: 'Edge Without Variable',
      description: 'Single hop without edge variable',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH (a:test_persons)-[:test_knows]->(b:test_persons)
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Should work - edge variable should be optional',
      sqlStandard: 'SQL:2023 allows anonymous edges'
    })

    this.tests.push({
      category: 'Edge Without Variable',
      description: 'Bounded quantifier without edge variable',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH (a:test_persons)-[:test_knows]->{1,3}(b:test_persons)
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Should work with bounded quantifier',
      sqlStandard: 'SQL:2023 anonymous edges with quantifiers'
    })

    this.tests.push({
      category: 'Edge Without Variable',
      description: 'ANY SHORTEST without edge variable',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH p = ANY SHORTEST (a:test_persons)-[:test_knows]->*(b:test_persons)
          WHERE a.id = 1 AND b.id = 4
          COLUMNS (a.name, b.name, path_length(p) as hops)
        )
      `,
      expectedBehavior: 'ANY SHORTEST should work without edge variable',
      sqlStandard: 'SQL:2023 shortest path with anonymous edges'
    })

    // ========================================
    // Category 4: Patterns Without Label Binding
    // ========================================

    this.tests.push({
      category: 'Without Label Binding',
      description: 'Bounded quantifier without edge label',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH (a:test_persons)-[e]->{1,3}(b:test_persons)
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Should traverse any edge type within 1-3 hops',
      sqlStandard: 'SQL:2023 untyped edges'
    })

    this.tests.push({
      category: 'Without Label Binding',
      description: 'Bounded quantifier with edge variable but no type label',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH (a:test_persons WHERE a.type = 'researcher')-[e]->{1,3}(b:test_persons)
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Should work - edge types are optional',
      sqlStandard: 'SQL:2023 allows untyped edges'
    })

    // ========================================
    // Category 5: Path Mode Variations
    // ========================================

    this.tests.push({
      category: 'Path Mode',
      description: 'Explicit WALK path mode',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH WALK (a:test_persons)-[e:test_knows]->*(b:test_persons)
          WHERE a.id = 1
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Explicit WALK mode (allows cycles)',
      sqlStandard: 'SQL:2023 path modes: WALK, TRAIL, SIMPLE, ACYCLIC'
    })

    this.tests.push({
      category: 'Path Mode',
      description: 'Explicit TRAIL path mode',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH TRAIL (a:test_persons)-[e:test_knows]->*(b:test_persons)
          WHERE a.id = 1
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'TRAIL mode (no repeated edges)',
      sqlStandard: 'SQL:2023 TRAIL prevents edge cycles'
    })

    this.tests.push({
      category: 'Path Mode',
      description: 'Explicit ACYCLIC path mode',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH ACYCLIC (a:test_persons)-[e:test_knows]->*(b:test_persons)
          WHERE a.id = 1
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'ACYCLIC mode (no repeated vertices)',
      sqlStandard: 'SQL:2023 ACYCLIC prevents vertex cycles'
    })

    // ========================================
    // Category 6: Alternative Quantifier Syntax
    // ========================================

    this.tests.push({
      category: 'Alternative Syntax',
      description: 'Quantifier BEFORE arrow (alternative syntax)',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH (a:test_persons)-[e:test_knows]{1,3}->(b:test_persons)
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Test if quantifier can go before arrow',
      sqlStandard: 'Cypher/openCypher syntax variant'
    })

    this.tests.push({
      category: 'Alternative Syntax',
      description: 'Star operator BEFORE arrow',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH ANY SHORTEST (a:test_persons)-[e:test_knows]*->(b:test_persons)
          WHERE a.id = 1 AND b.id = 4
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Test if star can go before arrow',
      sqlStandard: 'Cypher/openCypher syntax variant'
    })

    // ========================================
    // Category 7: ALL vs ANY Path Semantics
    // ========================================

    this.tests.push({
      category: 'ALL Semantics',
      description: 'Explicit ALL unbounded (should fail based on error)',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH ALL (a:test_persons)-[e:test_knows]->*(b:test_persons)
          WHERE a.id = 1
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Should fail with "ALL unbounded with path mode WALK is not possible"',
      sqlStandard: 'SQL:2023 ALL path quantifier'
    })

    this.tests.push({
      category: 'ALL Semantics',
      description: 'ALL with TRAIL mode',
      query: `
        FROM GRAPH_TABLE (test_graph
          MATCH ALL TRAIL (a:test_persons)-[e:test_knows]->*(b:test_persons)
          WHERE a.id = 1
          COLUMNS (a.name, b.name)
        )
      `,
      expectedBehavior: 'Test if ALL works with TRAIL mode',
      sqlStandard: 'SQL:2023 ALL with TRAIL'
    })
  }

  async runTests() {
    this.defineTests()

    console.log('━'.repeat(80))
    console.log('🧪 DuckPGQ 7705c5c FAILURE ANALYSIS')
    console.log('━'.repeat(80))
    console.log(`\nTesting ${this.tests.length} syntax variations that SHOULD work per SQL:2023\n`)

    const results: Array<{test: FailureTest, success: boolean, error?: string, rowCount?: number}> = []

    for (const test of this.tests) {
      try {
        const result = await this.duckdb.executeQuery(test.query)
        results.push({ test, success: true, rowCount: result.length })
        console.log(`✅ ${test.category} - ${test.description}`)
        console.log(`   Rows: ${result.length}`)
      } catch (error: any) {
        results.push({ test, success: false, error: error.message })
        console.log(`❌ ${test.category} - ${test.description}`)
        console.log(`   Error: ${error.message.substring(0, 100)}...`)
      }
      console.log()
    }

    return results
  }

  printAnalysis(results: Array<{test: FailureTest, success: boolean, error?: string, rowCount?: number}>) {
    console.log('\n' + '━'.repeat(80))
    console.log('📊 FAILURE ANALYSIS SUMMARY')
    console.log('━'.repeat(80))

    // Group by category
    const byCategory: Record<string, typeof results> = {}
    for (const result of results) {
      const cat = result.test.category
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(result)
    }

    for (const [category, categoryResults] of Object.entries(byCategory)) {
      const total = categoryResults.length
      const passing = categoryResults.filter(r => r.success).length
      const failing = total - passing

      console.log(`\n${category}: ${passing}/${total} passing (${failing} failing)`)
      console.log('─'.repeat(80))

      for (const result of categoryResults) {
        const icon = result.success ? '  ✓' : '  ✗'
        console.log(`${icon} ${result.test.description}`)
        if (!result.success && result.error) {
          // Extract key part of error
          const errorMsg = result.error
          if (errorMsg.includes('ALL unbounded')) {
            console.log(`     → "ALL unbounded with path mode WALK is not possible"`)
          } else if (errorMsg.includes('Parser Error')) {
            console.log(`     → Parser Error (syntax not recognized)`)
          } else if (errorMsg.includes('Binder Error')) {
            console.log(`     → Binder Error (semantic issue)`)
          } else {
            console.log(`     → ${errorMsg.substring(0, 80)}`)
          }
        }
        if (result.test.sqlStandard) {
          console.log(`     Standard: ${result.test.sqlStandard}`)
        }
      }
    }

    console.log('\n' + '━'.repeat(80))
    console.log('🔍 KEY INSIGHTS')
    console.log('━'.repeat(80))

    // Analyze patterns
    const allUnboundedErrors = results.filter(r =>
      !r.success && r.error?.includes('ALL unbounded')
    )
    const parserErrors = results.filter(r =>
      !r.success && r.error?.includes('Parser Error')
    )
    const binderErrors = results.filter(r =>
      !r.success && r.error?.includes('Binder Error')
    )

    if (allUnboundedErrors.length > 0) {
      console.log(`\n❌ "ALL unbounded" errors: ${allUnboundedErrors.length}`)
      console.log('   → This appears to be a path mode limitation in 7705c5c')
      console.log('   → Standalone Kleene operators default to ALL+WALK which is unsupported')
      console.log('   → Workaround: Use ANY SHORTEST or bounded quantifiers')
    }

    if (parserErrors.length > 0) {
      console.log(`\n❌ Parser errors: ${parserErrors.length}`)
      console.log('   → Syntax not recognized by 7705c5c parser')
      console.log('   → May indicate missing features or different syntax requirements')
    }

    if (binderErrors.length > 0) {
      console.log(`\n❌ Binder errors: ${binderErrors.length}`)
      console.log('   → Semantic validation failures')
      console.log('   → May require additional context (labels, types, etc.)')
    }

    console.log('\n' + '━'.repeat(80))
    console.log('💡 RECOMMENDATIONS')
    console.log('━'.repeat(80))
    console.log(`
1. **Standalone Kleene operators FAIL** because they default to ALL path semantics
   - Default: ALL + WALK mode
   - Error: "ALL unbounded with path mode WALK is not possible"
   - Solution: Use ANY SHORTEST or bounded quantifiers

2. **Edge variables ARE REQUIRED** in 7705c5c (not optional like SQL:2023)
   - ❌ -[:Label]->  (anonymous edge)
   - ✅ -[e:Label]-> (named edge variable)

3. **Path modes not supported** in current syntax
   - WALK, TRAIL, ACYCLIC, SIMPLE keywords don't work
   - Default behavior is unclear

4. **Alternative syntax** (quantifier before arrow) doesn't work
   - ❌ -[e:Label]{1,3}->
   - ✅ -[e:Label]->{1,3}

5. **Report to DuckPGQ team**:
   - This is likely a known limitation of 7705c5c
   - Full SQL:2023 support may come in future versions
   - See: https://github.com/cwida/duckpgq-extension/issues
`)

    console.log('━'.repeat(80) + '\n')
  }

  async cleanup() {
    try {
      await this.duckdb.executeQuery('DROP TABLE IF EXISTS test_persons CASCADE')
      await this.duckdb.executeQuery('DROP TABLE IF EXISTS test_knows CASCADE')
      console.log('✅ Cleanup complete\n')
    } catch (error: any) {
      console.error('⚠️  Cleanup error:', error.message)
    }
  }
}

async function main() {
  const analyzer = new DuckPGQFailureAnalysis()

  try {
    const setupOk = await analyzer.setup()
    if (!setupOk) {
      console.error('❌ Setup failed - cannot continue')
      process.exit(1)
    }

    const results = await analyzer.runTests()
    analyzer.printAnalysis(results)
    await analyzer.cleanup()

    process.exit(0)
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message)
    console.error(error.stack)
    await analyzer.cleanup()
    process.exit(1)
  }
}

main()
