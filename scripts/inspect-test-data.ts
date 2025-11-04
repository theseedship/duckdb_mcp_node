#!/usr/bin/env tsx
/**
 * Inspect process mining test data structure
 */

import { DuckDBService } from '../src/duckdb/service.js'

async function inspectParquetFile(duckdb: DuckDBService, filePath: string, tableName: string) {
  console.log(`\n📊 ${tableName}:`)
  console.log('='.repeat(60))

  // Get schema
  const schema = await duckdb.executeQuery(`
    SELECT column_name, column_type
    FROM (
      DESCRIBE SELECT * FROM read_parquet('${filePath}')
    )
  `)

  console.log('\nSchema:')
  schema.forEach((col: any) => {
    console.log(`  - ${col.column_name}: ${col.column_type}`)
  })

  // Get row count
  const countResult = await duckdb.executeQuery<{ count: number }>(`
    SELECT COUNT(*) as count
    FROM read_parquet('${filePath}')
  `)

  console.log(`\nRow Count: ${countResult[0].count}`)

  // Sample data (first 2 rows)
  const sample = await duckdb.executeQuery(`
    SELECT * FROM read_parquet('${filePath}') LIMIT 2
  `)

  console.log('\nSample Data:')
  sample.forEach((row: any, idx: number) => {
    console.log(`\n  Row ${idx + 1}:`)
    Object.entries(row).forEach(([key, value]) => {
      if (key === 'embedding' && Array.isArray(value)) {
        console.log(
          `    ${key}: FLOAT[${value.length}] (first 3: [${value.slice(0, 3).join(', ')}...])`
        )
      } else if (key === 'signature_emb' && Array.isArray(value)) {
        console.log(
          `    ${key}: FLOAT[${value.length}] (first 3: [${value.slice(0, 3).join(', ')}...])`
        )
      } else if (typeof value === 'string' && value.length > 50) {
        console.log(`    ${key}: "${value.substring(0, 50)}..."`)
      } else {
        console.log(`    ${key}: ${JSON.stringify(value)}`)
      }
    })
  })
}

async function main() {
  const duckdb = new DuckDBService()
  await duckdb.initialize()

  try {
    console.log('🔍 Inspecting Process Mining Test Data\n')

    await inspectParquetFile(duckdb, 'test-data/process/process_summary.parquet', 'process_summary')
    await inspectParquetFile(duckdb, 'test-data/process/process_steps.parquet', 'process_steps')
    await inspectParquetFile(duckdb, 'test-data/process/process_edges.parquet', 'process_edges')

    // Check if signatures exist
    try {
      await inspectParquetFile(
        duckdb,
        'test-data/process/process_signatures.parquet',
        'process_signatures'
      )
    } catch (error) {
      console.log('\n⚠️  process_signatures.parquet not found - need to create')
    }
  } finally {
    await duckdb.close()
  }
}

main().catch(console.error)
