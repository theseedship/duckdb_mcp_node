/**
 * DuckPGQ Syntax Validation Tests
 *
 * Comprehensive test suite to validate which DuckPGQ syntax features
 * actually work in version 7705c5c for DuckDB 1.4.x
 *
 * Focus: Testing syntax variations that may have been incorrectly documented
 */

import { DuckDBService } from '../src/duckdb/service.js'
import { logger } from '../src/utils/logger.js'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

interface SyntaxTestResult {
  category: string
  syntax: string
  works: boolean
  error?: string
  note?: string
  rowCount?: number
}

class DuckPGQSyntaxTester {
  private duckdb: DuckDBService
  private results: SyntaxTestResult[] = []

  constructor() {
    // Set env vars BEFORE creating service
    process.env.ALLOW_UNSIGNED_EXTENSIONS = 'true'
    process.env.ENABLE_DUCKPGQ = 'true'

    this.duckdb = new DuckDBService({
      memory: '2GB',
      threads: 2,
      allowUnsignedExtensions: true,
    })
  }

  private addResult(category: string, syntax: string, works: boolean, details?: { error?: string; note?: string; rowCount?: number }) {
    this.results.push({
      category,
      syntax,
      works,
      ...details
    })
  }

  /**
   * Setup: Initialize DuckDB with DuckPGQ and create test graph
   */
  async setup(): Promise<boolean> {
    try {
      console.log('\n🔧 Setting up test environment...')

      await this.duckdb.initialize()

      // Verify DuckPGQ is loaded
      try {
        const extensionCheck = await this.duckdb.executeQuery(`
          SELECT extension_name, loaded
          FROM duckdb_extensions()
          WHERE extension_name = 'duckpgq'
        `)

        if (extensionCheck.length === 0 || !extensionCheck[0].loaded) {
          console.error('❌ DuckPGQ extension is not loaded!')
          console.error('   Make sure ALLOW_UNSIGNED_EXTENSIONS=true and ENABLE_DUCKPGQ=true')
          return false
        }

        console.log('✅ DuckPGQ extension is loaded')
      } catch (error: any) {
        console.error('❌ Failed to check DuckPGQ status:', error.message)
        return false
      }

      // Create test tables
      await this.duckdb.executeQuery(`
        CREATE TABLE test_persons (
          id INTEGER PRIMARY KEY,
          name VARCHAR,
          age INTEGER
        )
      `)

      await this.duckdb.executeQuery(`
        CREATE TABLE test_knows (
          from_id INTEGER,
          to_id INTEGER,
          since INTEGER
        )
      `)

      // Insert test data - create a path: Alice -> Bob -> Carol -> David
      await this.duckdb.executeQuery(`
        INSERT INTO test_persons VALUES
          (1, 'Alice', 30),
          (2, 'Bob', 25),
          (3, 'Carol', 28),
          (4, 'David', 35),
          (5, 'Eve', 22)
      `)

      await this.duckdb.executeQuery(`
        INSERT INTO test_knows VALUES
          (1, 2, 2020),  -- Alice knows Bob
          (2, 3, 2021),  -- Bob knows Carol
          (3, 4, 2022),  -- Carol knows David
          (1, 5, 2023)   -- Alice knows Eve (alternative path)
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

      console.log('✅ Test environment ready')
      console.log('   Graph: Alice(1) -> Bob(2) -> Carol(3) -> David(4)')
      console.log('          Alice(1) -> Eve(5)')
      return true
    } catch (error: any) {
      console.error('❌ Setup failed:', error.message)
      return false
    }
  }

  /**
   * Category 1: ANY SHORTEST syntax variations
   */
  async testAnyShortest() {
    console.log('\n📊 Testing ANY SHORTEST syntax variations...')

    const tests = [
      {
        name: 'ANY SHORTEST with ->* (correct syntax)',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH p = ANY SHORTEST (a:test_persons WHERE a.id = 1)-[e:test_knows]->*(b:test_persons WHERE b.id = 4)
            COLUMNS (a.name AS from_name, b.name AS to_name, path_length(p) AS length)
          )
        `
      },
      {
        name: 'ANY SHORTEST without path variable',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH ANY SHORTEST (a:test_persons WHERE a.id = 1)-[e:test_knows]->*(b:test_persons WHERE b.id = 4)
            COLUMNS (a.name AS from_name, b.name AS to_name)
          )
        `
      },
      {
        name: 'ANY SHORTEST with *-> (old incorrect syntax)',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH ANY SHORTEST (a:test_persons)-[e:test_knows]*->(b:test_persons)
            COLUMNS (a.name AS from_name, b.name AS to_name)
          )
        `
      },
      {
        name: 'ANY SHORTEST with simpler pattern',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH p = ANY SHORTEST (a)-[e]->*(b)
            WHERE a.id = 1 AND b.id = 4
            COLUMNS (a.name AS from_name, b.name AS to_name, path_length(p) AS length)
          )
        `
      }
    ]

    for (const test of tests) {
      try {
        const result = await this.duckdb.executeQuery(test.query)
        this.addResult('ANY SHORTEST', test.name, true, {
          rowCount: result.length,
          note: result.length > 0 ? `Returned ${result.length} path(s)` : 'Query succeeded but no results'
        })
        console.log(`  ✅ ${test.name}: ${result.length} results`)
      } catch (error: any) {
        this.addResult('ANY SHORTEST', test.name, false, {
          error: error.message
        })
        console.log(`  ❌ ${test.name}: ${error.message.substring(0, 80)}...`)
      }
    }
  }

  /**
   * Category 2: Kleene star (*) - zero or more
   */
  async testKleeneStar() {
    console.log('\n📊 Testing Kleene star (*) syntax...')

    const tests = [
      {
        name: 'Kleene * with ->*',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH p = (a:test_persons WHERE a.id = 1)-[e:test_knows]->*(b:test_persons)
            COLUMNS (a.name AS from_name, b.name AS to_name, path_length(p) AS length)
          )
        `
      },
      {
        name: 'Kleene * with *-> (old syntax)',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH (a:test_persons)-[e:test_knows]*->(b:test_persons)
            COLUMNS (a.name AS from_name, b.name AS to_name)
          )
        `
      },
      {
        name: 'Kleene * without path variable',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH (a:test_persons WHERE a.id = 1)-[e]->*(b:test_persons)
            COLUMNS (a.name AS from_name, b.name AS to_name)
          )
        `
      }
    ]

    for (const test of tests) {
      try {
        const result = await this.duckdb.executeQuery(test.query)
        this.addResult('Kleene Star (*)', test.name, true, {
          rowCount: result.length,
          note: `Zero or more hops: ${result.length} paths found`
        })
        console.log(`  ✅ ${test.name}: ${result.length} results`)
      } catch (error: any) {
        this.addResult('Kleene Star (*)', test.name, false, {
          error: error.message
        })
        console.log(`  ❌ ${test.name}: ${error.message.substring(0, 80)}...`)
      }
    }
  }

  /**
   * Category 3: Kleene plus (+) - one or more
   */
  async testKleenePlus() {
    console.log('\n📊 Testing Kleene plus (+) syntax...')

    const tests = [
      {
        name: 'Kleene + with ->+',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH p = (a:test_persons WHERE a.id = 1)-[e:test_knows]->+(b:test_persons)
            COLUMNS (a.name AS from_name, b.name AS to_name, path_length(p) AS length)
          )
        `
      },
      {
        name: 'Kleene + with +-> (old syntax)',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH (a:test_persons)-[e:test_knows]+->(b:test_persons)
            COLUMNS (a.name AS from_name, b.name AS to_name)
          )
        `
      },
      {
        name: 'Kleene + without edge label',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH (a WHERE a.id = 1)-[e]->+(b)
            COLUMNS (a.name AS from_name, b.name AS to_name)
          )
        `
      }
    ]

    for (const test of tests) {
      try {
        const result = await this.duckdb.executeQuery(test.query)
        this.addResult('Kleene Plus (+)', test.name, true, {
          rowCount: result.length,
          note: `One or more hops: ${result.length} paths found`
        })
        console.log(`  ✅ ${test.name}: ${result.length} results`)
      } catch (error: any) {
        this.addResult('Kleene Plus (+)', test.name, false, {
          error: error.message
        })
        console.log(`  ❌ ${test.name}: ${error.message.substring(0, 80)}...`)
      }
    }
  }

  /**
   * Category 4: Bounded quantifiers {n,m}
   */
  async testBoundedQuantifiers() {
    console.log('\n📊 Testing bounded quantifiers {n,m}...')

    const tests = [
      {
        name: 'Bounded {2,3} with ->{2,3}',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH p = (a WHERE a.id = 1)-[e]->{2,3}(b)
            COLUMNS (a.name AS from_name, b.name AS to_name, path_length(p) AS length)
          )
        `
      },
      {
        name: 'Bounded {1,2} with exact range',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH (a:test_persons)-[e:test_knows]->{1,2}(b:test_persons)
            COLUMNS (a.name AS from_name, b.name AS to_name)
          )
        `
      },
      {
        name: 'Bounded {2,3} old syntax (before arrow)',
        query: `
          FROM GRAPH_TABLE (test_graph
            MATCH (a)-[e]{2,3}->(b)
            COLUMNS (a.name AS from_name, b.name AS to_name)
          )
        `
      }
    ]

    for (const test of tests) {
      try {
        const result = await this.duckdb.executeQuery(test.query)
        this.addResult('Bounded Quantifiers', test.name, true, {
          rowCount: result.length,
          note: `Bounded range: ${result.length} paths found`
        })
        console.log(`  ✅ ${test.name}: ${result.length} results`)
      } catch (error: any) {
        this.addResult('Bounded Quantifiers', test.name, false, {
          error: error.message
        })
        console.log(`  ❌ ${test.name}: ${error.message.substring(0, 80)}...`)
      }
    }
  }

  /**
   * Print summary results
   */
  printSummary() {
    console.log('\n' + '='.repeat(80))
    console.log('📈 SYNTAX VALIDATION SUMMARY')
    console.log('='.repeat(80))

    const byCategory: Record<string, { total: number; working: number }> = {}

    for (const result of this.results) {
      if (!byCategory[result.category]) {
        byCategory[result.category] = { total: 0, working: 0 }
      }
      byCategory[result.category].total++
      if (result.works) {
        byCategory[result.category].working++
      }
    }

    for (const [category, stats] of Object.entries(byCategory)) {
      const percentage = ((stats.working / stats.total) * 100).toFixed(0)
      const status = stats.working === stats.total ? '✅' : stats.working > 0 ? '⚠️' : '❌'
      console.log(`\n${status} ${category}: ${stats.working}/${stats.total} working (${percentage}%)`)

      // Show details
      for (const result of this.results.filter(r => r.category === category)) {
        const icon = result.works ? '  ✓' : '  ✗'
        console.log(`${icon} ${result.syntax}`)
        if (result.works && result.note) {
          console.log(`     ${result.note}`)
        }
        if (!result.works && result.error) {
          console.log(`     Error: ${result.error.substring(0, 60)}...`)
        }
      }
    }

    console.log('\n' + '='.repeat(80))
    console.log('🎯 KEY FINDINGS')
    console.log('='.repeat(80))

    const anyShortest = this.results.filter(r => r.category === 'ANY SHORTEST' && r.works)
    const kleeneStar = this.results.filter(r => r.category === 'Kleene Star (*)' && r.works)
    const kleenePlus = this.results.filter(r => r.category === 'Kleene Plus (+)' && r.works)
    const bounded = this.results.filter(r => r.category === 'Bounded Quantifiers' && r.works)

    if (anyShortest.length > 0) {
      console.log('✅ ANY SHORTEST IS SUPPORTED!')
      console.log(`   Working syntax: ${anyShortest[0].syntax}`)
    } else {
      console.log('❌ ANY SHORTEST not working with any tested syntax')
    }

    if (kleeneStar.length > 0 || kleenePlus.length > 0) {
      console.log('✅ KLEENE OPERATORS ARE SUPPORTED!')
      if (kleeneStar.length > 0) console.log(`   Star (*): ${kleeneStar[0].syntax}`)
      if (kleenePlus.length > 0) console.log(`   Plus (+): ${kleenePlus[0].syntax}`)
    } else {
      console.log('❌ Kleene operators not working with any tested syntax')
    }

    if (bounded.length > 0) {
      console.log('✅ BOUNDED QUANTIFIERS ARE SUPPORTED!')
      console.log(`   Working syntax: ${bounded[0].syntax}`)
    } else {
      console.log('❌ Bounded quantifiers not working with any tested syntax')
    }

    console.log('\n' + '='.repeat(80))
  }

  /**
   * Cleanup
   */
  async cleanup() {
    try {
      await this.duckdb.executeQuery('DROP TABLE IF EXISTS test_persons CASCADE')
      await this.duckdb.executeQuery('DROP TABLE IF EXISTS test_knows CASCADE')
      // DuckDBService doesn't have a close method, cleanup is automatic
      console.log('\n✅ Cleanup complete')
    } catch (error: any) {
      console.error('⚠️  Cleanup error:', error.message)
    }
  }
}

/**
 * Main execution
 */
async function main() {
  const tester = new DuckPGQSyntaxTester()

  try {
    console.log('🧪 DuckPGQ Syntax Validation Tests')
    console.log('Testing DuckPGQ 7705c5c on DuckDB 1.4.x')
    console.log('=' .repeat(80))

    // Setup
    const setupSuccess = await tester.setup()
    if (!setupSuccess) {
      console.error('❌ Setup failed - cannot continue tests')
      process.exit(1)
    }

    // Run all test categories
    await tester.testAnyShortest()
    await tester.testKleeneStar()
    await tester.testKleenePlus()
    await tester.testBoundedQuantifiers()

    // Print summary
    tester.printSummary()

    // Cleanup
    await tester.cleanup()

    process.exit(0)
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message)
    console.error(error.stack)
    await tester.cleanup()
    process.exit(1)
  }
}

main()
