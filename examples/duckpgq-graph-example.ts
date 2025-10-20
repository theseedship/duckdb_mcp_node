#!/usr/bin/env tsx
/**
 * DuckPGQ Property Graph Examples
 *
 * This example demonstrates various DuckPGQ features including:
 * - Property graph creation from relational tables
 * - Pattern matching with GRAPH_TABLE syntax
 * - Shortest path queries
 * - Variable-length path traversal
 * - Kleene operators and bounded quantifiers
 *
 * Prerequisites:
 * - DuckPGQ extension must be loaded successfully
 * - Set ENABLE_DUCKPGQ=true and configure appropriate source
 *
 * Usage:
 *   tsx examples/duckpgq-graph-example.ts
 */

import { DuckDBService } from '../src/duckdb/service.js'
import { logger } from '../src/utils/logger.js'
import * as dotenv from 'dotenv'

dotenv.config()

async function runExample() {
  console.log('🔷 DuckPGQ Property Graph Examples\n')

  // Initialize DuckDB with unsigned extensions enabled
  const duckdb = new DuckDBService({
    memory: '2GB',
    threads: 2,
    allowUnsignedExtensions: true,
  })

  try {
    await duckdb.initialize()
    console.log('✅ DuckDB initialized\n')

    // Check if DuckPGQ is loaded
    const extensions = await duckdb.executeQuery<{ extension_name: string; loaded: boolean }>(
      "SELECT extension_name, loaded FROM duckdb_extensions() WHERE extension_name = 'duckpgq'"
    )

    if (!extensions[0]?.loaded) {
      console.log('⚠️  DuckPGQ extension is not loaded.')
      console.log('   This is expected for DuckDB 1.4.x with community source.')
      console.log('   To run this example, configure a compatible build:')
      console.log('   DUCKPGQ_SOURCE=custom')
      console.log('   DUCKPGQ_CUSTOM_REPO=<url-to-compatible-build>')
      console.log('\nExiting example.')
      await duckdb.close()
      process.exit(0)
    }

    console.log('✅ DuckPGQ extension loaded successfully\n')

    // =========================================================================
    // Example 1: Social Network Graph
    // =========================================================================
    console.log('📊 Example 1: Social Network Graph\n')

    // Create tables
    console.log('Creating Person and Knows tables...')
    await duckdb.executeQuery(`
      CREATE TABLE Person (
        id INTEGER PRIMARY KEY,
        name VARCHAR,
        age INTEGER,
        city VARCHAR
      );
    `)

    await duckdb.executeQuery(`
      CREATE TABLE Knows (
        from_id INTEGER,
        to_id INTEGER,
        since DATE,
        relation_type VARCHAR
      );
    `)

    // Insert sample data
    console.log('Inserting sample data...')
    await duckdb.executeQuery(`
      INSERT INTO Person VALUES
        (1, 'Alice', 30, 'New York'),
        (2, 'Bob', 35, 'San Francisco'),
        (3, 'Carol', 28, 'New York'),
        (4, 'David', 32, 'Seattle'),
        (5, 'Eve', 27, 'San Francisco'),
        (6, 'Frank', 40, 'New York');
    `)

    await duckdb.executeQuery(`
      INSERT INTO Knows VALUES
        (1, 2, '2020-01-15', 'friend'),
        (1, 3, '2019-06-20', 'friend'),
        (2, 4, '2021-03-10', 'colleague'),
        (3, 5, '2020-11-05', 'friend'),
        (4, 5, '2021-08-22', 'friend'),
        (5, 6, '2019-02-14', 'family'),
        (1, 4, '2022-05-30', 'colleague');
    `)

    // Create property graph
    console.log('Creating social network property graph...')
    await duckdb.executeQuery(`
      CREATE PROPERTY GRAPH social_network
        VERTEX TABLES (Person)
        EDGE TABLES (
          Knows
            SOURCE KEY (from_id) REFERENCES Person (id)
            DESTINATION KEY (to_id) REFERENCES Person (id)
        );
    `)

    // Graph created successfully
    console.log('✅ Created social_network graph\n')

    // =========================================================================
    // Query 1: Direct Connections
    // =========================================================================
    console.log('🔍 Query 1: Direct connections between people\n')

    const directConnections = await duckdb.executeQuery<{
      from_name: string
      to_name: string
      relation: string
      since: string
    }>(`
      FROM GRAPH_TABLE (social_network
        MATCH (p1:Person)-[k:Knows]->(p2:Person)
        COLUMNS (
          p1.name AS from_name,
          p2.name AS to_name,
          k.relation_type AS relation,
          k.since AS since
        )
      )
    `)

    console.log('Direct connections:')
    directConnections.forEach((row) => {
      console.log(`  ${row.from_name} --[${row.relation}]--> ${row.to_name} (since ${row.since})`)
    })
    console.log()

    // =========================================================================
    // Query 2: Friends of Friends
    // =========================================================================
    console.log('🔍 Query 2: Friends of friends (2-hop paths)\n')

    const friendsOfFriends = await duckdb.executeQuery<{
      person: string
      friend_of_friend: string
    }>(`
      FROM GRAPH_TABLE (social_network
        MATCH (p1:Person)-[e1:Knows]->(p2:Person)-[e2:Knows]->(p3:Person)
        WHERE p1.name = 'Alice' AND p1.id != p3.id
        COLUMNS (
          p1.name AS person,
          p3.name AS friend_of_friend
        )
      )
    `)

    console.log("Alice's friends of friends:")
    friendsOfFriends.forEach((row) => {
      console.log(`  ${row.person} -> ... -> ${row.friend_of_friend}`)
    })
    console.log()

    // =========================================================================
    // Query 3: Paths up to 5 hops (using bounded quantifier)
    // Note: This DuckPGQ version supports {n,m} quantifiers but not + or *
    // =========================================================================
    console.log('🔍 Query 3: Finding paths from Alice to Eve (1-5 hops)\n')

    const pathsToEve = await duckdb.executeQuery<{
      start: string
      end: string
      hops: number
    }>(`
      FROM GRAPH_TABLE (social_network
        MATCH (p1:Person)-[e:Knows]{1,5}->(p2:Person)
        WHERE p1.name = 'Alice' AND p2.name = 'Eve'
        COLUMNS (
          p1.name AS start,
          p2.name AS end,
          path_length AS hops
        )
      )
      ORDER BY hops
      LIMIT 1
    `)

    if (pathsToEve.length > 0) {
      const path = pathsToEve[0]
      console.log(`Shortest path found: ${path.start} -> ... -> ${path.end}`)
      console.log(`Path length: ${path.hops} hops\n`)
    } else {
      console.log('No path found\n')
    }

    // =========================================================================
    // Query 4: Variable-Length Paths (Bounded)
    // =========================================================================
    console.log('🔍 Query 4: Connections within 1-3 hops from Alice\n')

    const variablePaths = await duckdb.executeQuery<{
      from: string
      to: string
      hops: number
    }>(`
      FROM GRAPH_TABLE (social_network
        MATCH (p1:Person)-[e:Knows]{1,3}->(p2:Person)
        WHERE p1.name = 'Alice' AND p1.id != p2.id
        COLUMNS (
          p1.name AS from,
          p2.name AS to,
          path_length AS hops
        )
      )
      ORDER BY hops, to
    `)

    console.log('People reachable from Alice (1-3 hops):')
    variablePaths.forEach((row) => {
      console.log(`  ${row.from} --[${row.hops} hops]--> ${row.to}`)
    })
    console.log()

    // =========================================================================
    // Query 5: Filter by Properties (using bounded quantifier)
    // =========================================================================
    console.log('🔍 Query 5: People in New York connected to Alice (within 3 hops)\n')

    const cityFilter = await duckdb.executeQuery<{
      from: string
      to: string
      city: string
    }>(`
      FROM GRAPH_TABLE (social_network
        MATCH (p1:Person)-[e:Knows]{1,3}->(p2:Person)
        WHERE p1.name = 'Alice' AND p2.city = 'New York' AND p1.id != p2.id
        COLUMNS (
          p1.name AS from,
          p2.name AS to,
          p2.city AS city
        )
      )
    `)

    console.log('New York connections:')
    cityFilter.forEach((row) => {
      console.log(`  ${row.from} -> ${row.to} (${row.city})`)
    })
    console.log()

    // =========================================================================
    // Query 6: All reachable people (using bounded quantifier 1-10)
    // Note: This DuckPGQ version does not support + or * operators
    // =========================================================================
    console.log('🔍 Query 6: All reachable people from Alice (within 10 hops)\n')

    const allReachable = await duckdb.executeQuery<{
      from: string
      to: string
      hops: number
    }>(`
      FROM GRAPH_TABLE (social_network
        MATCH (p1:Person)-[e:Knows]{1,10}->(p2:Person)
        WHERE p1.name = 'Alice'
        COLUMNS (
          p1.name AS from,
          p2.name AS to,
          path_length AS hops
        )
      )
      ORDER BY hops, to
    `)

    console.log('All reachable people (1-10 hops):')
    allReachable.forEach((row) => {
      console.log(`  ${row.from} -> ${row.to} (${row.hops} hops)`)
    })
    console.log()

    // =========================================================================
    // Example 2: Company Hierarchy Graph
    // =========================================================================
    console.log('📊 Example 2: Company Hierarchy Graph\n')

    // Create tables
    console.log('Creating Employee and ReportsTo tables...')
    await duckdb.executeQuery(`
      CREATE TABLE Employee (
        id INTEGER PRIMARY KEY,
        name VARCHAR,
        title VARCHAR,
        department VARCHAR
      );
    `)

    await duckdb.executeQuery(`
      CREATE TABLE ReportsTo (
        employee_id INTEGER,
        manager_id INTEGER
      );
    `)

    // Insert sample data
    console.log('Inserting sample data...')
    await duckdb.executeQuery(`
      INSERT INTO Employee VALUES
        (1, 'Alice', 'CEO', 'Executive'),
        (2, 'Bob', 'CTO', 'Engineering'),
        (3, 'Carol', 'VP Engineering', 'Engineering'),
        (4, 'David', 'Senior Engineer', 'Engineering'),
        (5, 'Eve', 'Engineer', 'Engineering'),
        (6, 'Frank', 'CFO', 'Finance');
    `)

    await duckdb.executeQuery(`
      INSERT INTO ReportsTo VALUES
        (2, 1),  -- Bob reports to Alice
        (3, 2),  -- Carol reports to Bob
        (4, 3),  -- David reports to Carol
        (5, 3),  -- Eve reports to Carol
        (6, 1);  -- Frank reports to Alice
    `)

    // Create property graph
    console.log('Creating company hierarchy graph...')
    await duckdb.executeQuery(`
      CREATE PROPERTY GRAPH company_hierarchy
        VERTEX TABLES (Employee)
        EDGE TABLES (
          ReportsTo
            SOURCE KEY (employee_id) REFERENCES Employee (id)
            DESTINATION KEY (manager_id) REFERENCES Employee (id)
        );
    `)

    console.log('✅ Created company hierarchy graph\n')

    // =========================================================================
    // Query 7: Direct Reports
    // =========================================================================
    console.log('🔍 Query 7: Direct reports of Bob (CTO)\n')

    const directReports = await duckdb.executeQuery<{
      manager: string
      employee: string
      title: string
    }>(`
      FROM GRAPH_TABLE (company_hierarchy
        MATCH (m:Employee)<-[r:ReportsTo]-(e:Employee)
        WHERE m.name = 'Bob'
        COLUMNS (
          m.name AS manager,
          e.name AS employee,
          e.title AS title
        )
      )
    `)

    console.log("Bob's direct reports:")
    directReports.forEach((row) => {
      console.log(`  ${row.employee} (${row.title})`)
    })
    console.log()

    // =========================================================================
    // Query 8: Organizational Depth (using bounded quantifier)
    // =========================================================================
    console.log('🔍 Query 8: All employees and their distance from CEO\n')

    const orgDepth = await duckdb.executeQuery<{
      employee: string
      title: string
      depth: number
    }>(`
      FROM GRAPH_TABLE (company_hierarchy
        MATCH (e:Employee)-[r:ReportsTo]{1,10}->(ceo:Employee)
        WHERE ceo.title = 'CEO'
        COLUMNS (
          e.name AS employee,
          e.title AS title,
          path_length AS depth
        )
      )
      ORDER BY depth, employee
    `)

    console.log('Organizational depth:')
    orgDepth.forEach((row) => {
      console.log(`  ${row.employee} (${row.title}) - ${row.depth} levels from CEO`)
    })
    console.log()

    // =========================================================================
    // Cleanup
    // =========================================================================
    console.log('🧹 Cleaning up...')
    // Note: DROP PROPERTY GRAPH not available in DuckPGQ 7705c5c - just drop tables
    await duckdb.executeQuery('DROP TABLE IF EXISTS Knows')
    await duckdb.executeQuery('DROP TABLE IF EXISTS Person')
    await duckdb.executeQuery('DROP TABLE IF EXISTS ReportsTo')
    await duckdb.executeQuery('DROP TABLE IF EXISTS Employee')

    console.log('✅ Cleanup complete\n')

    // Close database
    await duckdb.close()

    console.log('✅ Example completed successfully!')
  } catch (error: any) {
    console.error('\n❌ Error running example:', error.message)
    logger.error('Example error:', error)
    await duckdb.close()
    process.exit(1)
  }
}

// Run example
runExample().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
