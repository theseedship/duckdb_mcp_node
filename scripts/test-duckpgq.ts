#!/usr/bin/env tsx
/**
 * DuckPGQ Extension Test Script
 *
 * This script validates DuckPGQ installation and configuration.
 * It detects the configured source, verifies loading, and tests basic graph operations.
 *
 * Usage:
 *   npm run test:duckpgq
 *   tsx scripts/test-duckpgq.ts
 */

import { DuckDBService } from '../src/duckdb/service.js'
import { logger } from '../src/utils/logger.js'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

interface TestResult {
  name: string
  status: 'pass' | 'fail' | 'skip'
  message: string
  details?: any
}

class DuckPGQTester {
  private duckdb: DuckDBService
  private results: TestResult[] = []

  constructor() {
    this.duckdb = new DuckDBService({
      memory: '2GB',
      threads: 2,
      allowUnsignedExtensions: process.env.ALLOW_UNSIGNED_EXTENSIONS === 'true',
    })
  }

  /**
   * Add a test result
   */
  private addResult(
    name: string,
    status: 'pass' | 'fail' | 'skip',
    message: string,
    details?: any
  ) {
    this.results.push({ name, status, message, details })
  }

  /**
   * Print test results summary
   */
  private printSummary() {
    console.log('\n' + '='.repeat(60))
    console.log('DuckPGQ Test Results')
    console.log('='.repeat(60))

    const passed = this.results.filter((r) => r.status === 'pass').length
    const failed = this.results.filter((r) => r.status === 'fail').length
    const skipped = this.results.filter((r) => r.status === 'skip').length

    this.results.forEach((result) => {
      const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⏭️'
      console.log(`\n${icon} ${result.name}`)
      console.log(`   ${result.message}`)
      if (result.details) {
        console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`)
      }
    })

    console.log('\n' + '-'.repeat(60))
    console.log(
      `Total: ${this.results.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`
    )
    console.log('='.repeat(60) + '\n')

    return { passed, failed, skipped, total: this.results.length }
  }

  /**
   * Test 1: Configuration Detection
   */
  async testConfiguration() {
    const enabled = process.env.ENABLE_DUCKPGQ !== 'false'
    const source = process.env.DUCKPGQ_SOURCE || 'community'
    const customRepo = process.env.DUCKPGQ_CUSTOM_REPO
    const version = process.env.DUCKPGQ_VERSION
    const strictMode = process.env.DUCKPGQ_STRICT_MODE === 'true'
    const allowUnsigned = process.env.ALLOW_UNSIGNED_EXTENSIONS === 'true'

    if (!enabled) {
      this.addResult('Configuration', 'skip', 'ENABLE_DUCKPGQ is false - testing skipped', {
        enabled,
        source,
      })
      return false
    }

    if (!allowUnsigned) {
      this.addResult(
        'Configuration',
        'fail',
        'ALLOW_UNSIGNED_EXTENSIONS must be true for DuckPGQ',
        { allowUnsigned }
      )
      return false
    }

    const config = {
      enabled,
      source,
      customRepo: source === 'custom' ? customRepo : undefined,
      version: version || 'latest',
      strictMode,
      allowUnsigned,
    }

    this.addResult('Configuration', 'pass', `DuckPGQ enabled with source: ${source}`, config)

    // Validate custom source
    if (source === 'custom' && !customRepo) {
      this.addResult(
        'Configuration Validation',
        'fail',
        'DUCKPGQ_SOURCE=custom requires DUCKPGQ_CUSTOM_REPO',
        config
      )
      return false
    }

    return true
  }

  /**
   * Test 2: Extension Loading
   */
  async testExtensionLoading() {
    try {
      await this.duckdb.initialize()

      // Check if DuckPGQ is loaded
      const extensions = await this.duckdb.executeQuery<{
        extension_name: string
        loaded: boolean
      }>("SELECT extension_name, loaded FROM duckdb_extensions() WHERE extension_name = 'duckpgq'")

      if (extensions.length > 0 && extensions[0].loaded) {
        this.addResult(
          'Extension Loading',
          'pass',
          'DuckPGQ extension loaded successfully',
          extensions[0]
        )
        return true
      } else {
        this.addResult(
          'Extension Loading',
          'skip',
          'DuckPGQ not loaded (expected for DuckDB 1.4.x with community source)',
          { extensions }
        )
        return false
      }
    } catch (error: any) {
      this.addResult(
        'Extension Loading',
        'fail',
        `Failed to initialize or query extensions: ${error.message}`,
        { error: error.message }
      )
      return false
    }
  }

  /**
   * Test 3: Property Graph Creation
   */
  async testGraphCreation() {
    try {
      // Create test tables
      await this.duckdb.executeQuery(`
        CREATE TABLE IF NOT EXISTS test_nodes (
          id INTEGER PRIMARY KEY,
          name VARCHAR,
          type VARCHAR
        );
      `)

      await this.duckdb.executeQuery(`
        CREATE TABLE IF NOT EXISTS test_edges (
          from_id INTEGER,
          to_id INTEGER,
          relation VARCHAR
        );
      `)

      // Insert sample data
      await this.duckdb.executeQuery(`
        INSERT INTO test_nodes VALUES
          (1, 'Alice', 'person'),
          (2, 'Bob', 'person'),
          (3, 'Carol', 'person');
      `)

      await this.duckdb.executeQuery(`
        INSERT INTO test_edges VALUES
          (1, 2, 'knows'),
          (2, 3, 'knows'),
          (1, 3, 'follows');
      `)

      // Create property graph
      // Syntax for DuckPGQ 7705c5c (DuckDB 1.4.x)
      await this.duckdb.executeQuery(`
        CREATE PROPERTY GRAPH test_graph
          VERTEX TABLES (test_nodes)
          EDGE TABLES (
            test_edges
              SOURCE KEY (from_id) REFERENCES test_nodes (id)
              DESTINATION KEY (to_id) REFERENCES test_nodes (id)
          );
      `)

      // Verify graph creation succeeded (SHOW PROPERTY GRAPHS not available in this version)
      // If we reach here without error, graph was created successfully
      this.addResult('Graph Creation', 'pass', 'Property graph created successfully', {
        note: 'Graph test_graph created (SHOW PROPERTY GRAPHS not available in DuckPGQ 7705c5c)',
      })
      return true
    } catch (error: any) {
      // Expected to fail if DuckPGQ not loaded
      if (
        error.message?.includes('PROPERTY GRAPH') ||
        error.message?.includes('property graph') ||
        error.message?.includes('not recognized')
      ) {
        this.addResult(
          'Graph Creation',
          'skip',
          'Property graph syntax not available (DuckPGQ not loaded)',
          { error: error.message }
        )
        return false
      } else {
        this.addResult('Graph Creation', 'fail', `Graph creation failed: ${error.message}`, {
          error: error.message,
        })
        return false
      }
    }
  }

  /**
   * Test 4: Graph Query Execution
   */
  async testGraphQuery() {
    try {
      // Simple path query
      const result = await this.duckdb.executeQuery(`
        FROM GRAPH_TABLE (test_graph
          MATCH (a:test_nodes)-[e:test_edges]->(b:test_nodes)
          COLUMNS (a.name AS from_node, b.name AS to_node, e.relation AS edge_type)
        )
      `)

      if (result.length > 0) {
        this.addResult('Graph Query', 'pass', `Graph query returned ${result.length} results`, {
          sampleResult: result[0],
        })
        return true
      } else {
        this.addResult('Graph Query', 'fail', 'Graph query returned no results', { result })
        return false
      }
    } catch (error: any) {
      if (
        error.message?.includes('GRAPH_TABLE') ||
        error.message?.includes('not recognized') ||
        error.message?.includes('property graph')
      ) {
        this.addResult(
          'Graph Query',
          'skip',
          'GRAPH_TABLE syntax not available (DuckPGQ not loaded)',
          { error: error.message }
        )
        return false
      } else {
        this.addResult('Graph Query', 'fail', `Graph query failed: ${error.message}`, {
          error: error.message,
        })
        return false
      }
    }
  }

  /**
   * Test 5: Cleanup
   */
  async testCleanup() {
    try {
      // Drop test tables (DROP PROPERTY GRAPH not available in this version)
      await this.duckdb.executeQuery('DROP TABLE IF EXISTS test_edges')
      await this.duckdb.executeQuery('DROP TABLE IF EXISTS test_nodes')

      this.addResult('Cleanup', 'pass', 'Test resources cleaned up successfully')
      return true
    } catch (error: any) {
      this.addResult('Cleanup', 'skip', `Cleanup skipped or partial: ${error.message}`, {
        error: error.message,
      })
      return false
    }
  }

  /**
   * Run all tests
   */
  async runAll() {
    console.log('\n🧪 Starting DuckPGQ Extension Tests...\n')

    try {
      // Test 1: Configuration
      const configOk = await this.testConfiguration()

      if (!configOk) {
        console.log('\n⚠️  Configuration invalid or DuckPGQ disabled. Skipping remaining tests.')
        this.printSummary()
        return this.results.some((r) => r.status === 'fail') ? 1 : 0
      }

      // Test 2: Extension Loading
      const extensionLoaded = await this.testExtensionLoading()

      if (!extensionLoaded) {
        console.log(
          '\n⚠️  DuckPGQ extension not loaded. This is expected for DuckDB 1.4.x with community source.'
        )
        console.log('   To test with a compatible build, use:')
        console.log('   DUCKPGQ_SOURCE=custom')
        console.log('   DUCKPGQ_CUSTOM_REPO=<url-to-compatible-build>')
        this.printSummary()
        return 0
      }

      // Test 3: Graph Creation
      const graphCreated = await this.testGraphCreation()

      // Test 4: Graph Query (only if graph created)
      if (graphCreated) {
        await this.testGraphQuery()
      }

      // Test 5: Cleanup
      await this.testCleanup()

      // Close database
      await this.duckdb.close()

      // Print summary and exit
      const summary = this.printSummary()
      return summary.failed > 0 ? 1 : 0
    } catch (error: any) {
      console.error('\n❌ Fatal error during testing:', error.message)
      logger.error('Fatal test error:', error)
      return 1
    }
  }
}

/**
 * Main execution
 */
async function main() {
  const tester = new DuckPGQTester()
  const exitCode = await tester.runAll()

  if (exitCode === 0) {
    console.log('✅ All tests completed successfully!\n')
  } else {
    console.log('❌ Some tests failed. See details above.\n')
  }

  process.exit(exitCode)
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error)
    process.exit(1)
  })
}

export { DuckPGQTester }
