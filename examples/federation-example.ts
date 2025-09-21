#!/usr/bin/env tsx

/**
 * Federation Example - Demonstrating distributed queries across MCP servers
 *
 * This example shows how to:
 * 1. Create a federation manager
 * 2. Register multiple MCP servers
 * 3. Execute federated queries using mcp:// URIs
 * 4. Join data from multiple sources
 */

import { DuckDBService } from '../src/duckdb/service.js'
import { FederationManager, createFederationRouter } from '../src/federation/index.js'
import { logger } from '../src/utils/logger.js'

async function main() {
  logger.info('🌐 Federation Example Started')

  try {
    // Initialize DuckDB service
    const duckdb = new DuckDBService({
      dbPath: ':memory:',
      readOnly: false,
    })
    await duckdb.initialize()

    // Create some local test data
    await duckdb.executeQuery(`
      CREATE TABLE local_users (
        id INTEGER PRIMARY KEY,
        name VARCHAR,
        department VARCHAR,
        github_username VARCHAR
      )
    `)

    await duckdb.executeQuery(`
      INSERT INTO local_users VALUES
        (1, 'Alice Smith', 'Engineering', 'asmith'),
        (2, 'Bob Jones', 'Product', 'bjones'),
        (3, 'Charlie Brown', 'Engineering', 'cbrown'),
        (4, 'Diana Prince', 'Design', 'dprince')
    `)

    logger.info('✅ Created local test data')

    // Initialize federation manager
    const federation = new FederationManager({
      duckdb,
      enableCache: true,
      cacheTTL: 60000, // 1 minute cache
    })

    // Register mock MCP servers (in production, these would be real servers)
    await federation.registerServer('github', 'stdio://github-mcp-server', {
      description: 'GitHub data source',
      resources: ['issues', 'pull_requests', 'commits'],
    })

    await federation.registerServer('jira', 'http://localhost:8080/jira-mcp', {
      description: 'Jira issue tracking',
      resources: ['tickets', 'sprints', 'boards'],
    })

    await federation.registerServer('slack', 'ws://localhost:9090/slack-mcp', {
      description: 'Slack workspace data',
      resources: ['messages', 'channels', 'users'],
    })

    logger.info('📝 Registered MCP servers:', federation.listServers())

    // Example 1: Simple federated query
    console.log('\n=== Example 1: Simple Federated Query ===')
    const simpleQuery = `
      SELECT * FROM 'mcp://github/issues.json'
      WHERE status = 'open'
      LIMIT 10
    `

    const plan1 = federation.analyzeQuery(simpleQuery)
    console.log('Query Plan:', plan1)
    console.log('Explanation:', federation.explainQuery(simpleQuery))

    // Note: Actual execution would require real MCP servers
    // const result1 = await federation.federateQuery(simpleQuery)
    // console.log('Results:', result1)

    // Example 2: Multi-source JOIN
    console.log('\n=== Example 2: Multi-Source JOIN ===')
    const joinQuery = `
      SELECT
        u.name,
        u.department,
        COUNT(g.id) as github_issues,
        COUNT(j.id) as jira_tickets
      FROM local_users u
      LEFT JOIN 'mcp://github/issues.json' g ON u.github_username = g.assignee
      LEFT JOIN 'mcp://jira/tickets.json' j ON u.name = j.assignee_name
      GROUP BY u.name, u.department
    `

    const plan2 = federation.analyzeQuery(joinQuery)
    console.log('Query Plan:', plan2)
    console.log('Explanation:', federation.explainQuery(joinQuery))

    // Example 3: Aggregation across federated sources
    console.log('\n=== Example 3: Cross-Source Aggregation ===')
    const aggregationQuery = `
      WITH all_issues AS (
        SELECT 'github' as source, status, created_at
        FROM 'mcp://github/issues.json'
        UNION ALL
        SELECT 'jira' as source, status, created_at
        FROM 'mcp://jira/tickets.json'
      )
      SELECT
        source,
        status,
        COUNT(*) as count,
        MIN(created_at) as oldest,
        MAX(created_at) as newest
      FROM all_issues
      GROUP BY source, status
      ORDER BY source, count DESC
    `

    const plan3 = federation.analyzeQuery(aggregationQuery)
    console.log('Query Plan:', plan3)
    console.log('Explanation:', federation.explainQuery(aggregationQuery))

    // Example 4: Using the quick helper function
    console.log('\n=== Example 4: Quick Federation Helper ===')

    // Create a standalone router for one-off queries
    const router = createFederationRouter(duckdb)
    const quickPlan = router.analyzeQuery(
      "SELECT * FROM 'mcp://slack/messages.json' WHERE channel = 'engineering'"
    )
    console.log('Quick Query Plan:', quickPlan)

    // Get federation statistics
    console.log('\n=== Federation Statistics ===')
    console.log(JSON.stringify(federation.getStats(), null, 2))

    // Cleanup
    await federation.cleanup()
    await duckdb.close()

    logger.info('✨ Federation example completed successfully!')
  } catch (error) {
    logger.error('Federation example failed:', error)
    process.exit(1)
  }
}

// Run the example
main().catch((error) => {
  logger.error('Unhandled error:', error)
  process.exit(1)
})
