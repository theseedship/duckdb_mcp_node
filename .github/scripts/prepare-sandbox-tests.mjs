import assert from 'node:assert/strict'
import { DuckDBInstance } from '@duckdb/node-api'

// Use the installed native engine to select the matching version and platform.
// Provisioning is a required CI prerequisite: download/load failures must fail.
const instance = await DuckDBInstance.create(':memory:')
let connection
try {
  connection = await instance.connect()
  await connection.run("FORCE INSTALL httpfs FROM 'https://extensions.duckdb.org'")
  await connection.run('LOAD httpfs')
  const result = await connection.runAndReadAll(
    "SELECT loaded FROM duckdb_extensions() WHERE extension_name = 'httpfs'"
  )
  assert.equal(result.getRowObjects()[0]?.loaded, true, 'httpfs must be loaded')
  const engine = await connection.runAndReadAll('SELECT version() AS version')
  console.log(`Prepared official httpfs for DuckDB ${engine.getRowObjects()[0].version}`)
} finally {
  connection?.closeSync()
  instance.closeSync()
}
