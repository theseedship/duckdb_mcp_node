import { DuckDBService } from '../duckdb/service.js'
import { MCPConnectionPool } from './ConnectionPool.js'
import { ResourceRegistry } from './ResourceRegistry.js'
import { logger } from '../utils/logger.js'
import { escapeIdentifier, escapeFilePath } from '../utils/sql-escape.js'

/**
 * Represents a federated query plan
 */
export interface QueryPlan {
  requiresFederation: boolean
  localQuery?: string
  remoteQueries: Map<string, string>
  joinStrategy?: 'hash' | 'merge' | 'nested'
  estimatedCost?: number
}

/**
 * Query execution result
 */
export interface QueryResult {
  data: any
  metadata?: {
    rowCount: number
    executionTime: number
    sourcesQueried: string[]
  }
}

/**
 * Query Router for executing federated queries across multiple MCP servers
 * Handles query planning, routing, and result aggregation
 */
export class QueryRouter {
  private duckdb: DuckDBService
  private connectionPool: MCPConnectionPool
  private resourceRegistry: ResourceRegistry
  private tempTableCounter = 0

  constructor(
    duckdb: DuckDBService,
    connectionPool: MCPConnectionPool,
    resourceRegistry: ResourceRegistry
  ) {
    this.duckdb = duckdb
    this.connectionPool = connectionPool
    this.resourceRegistry = resourceRegistry
  }

  /**
   * Analyze a SQL query and create an execution plan
   */
  analyzeQuery(sql: string): QueryPlan {
    const plan: QueryPlan = {
      requiresFederation: false,
      remoteQueries: new Map(),
    }

    // Check for MCP URI references (mcp://server/resource)
    const mcpUriPattern = /mcp:\/\/([^/]+)\/([^)\s]+)/gi
    const matches = sql.matchAll(mcpUriPattern)

    for (const match of matches) {
      const [fullUri, serverAlias, resourcePath] = match
      plan.requiresFederation = true

      // Extract the query portion for this server
      const serverQuery = this.extractServerQuery(sql, fullUri, serverAlias, resourcePath)
      plan.remoteQueries.set(serverAlias, serverQuery)
    }

    // Check for explicit server prefixes (server.table format)
    const serverTablePattern = /\b(\w+)\.(\w+)\b/gi
    const tableMatches = sql.matchAll(serverTablePattern)

    for (const match of tableMatches) {
      const [, possibleServer, table] = match
      const resources = this.resourceRegistry.getServerResources(possibleServer)

      if (resources.length > 0) {
        plan.requiresFederation = true
        const serverQuery = this.extractServerQuery(
          sql,
          `${possibleServer}.${table}`,
          possibleServer,
          table
        )
        plan.remoteQueries.set(possibleServer, serverQuery)
      }
    }

    // Determine join strategy if multiple sources
    if (plan.remoteQueries.size > 1) {
      plan.joinStrategy = this.determineJoinStrategy(sql)
    }

    // Prepare local query with placeholders
    if (plan.requiresFederation) {
      plan.localQuery = this.prepareLocalQuery(sql, plan.remoteQueries)
    } else {
      plan.localQuery = sql
    }

    return plan
  }

  /**
   * Execute a query with federation support
   */
  async executeQuery(sql: string): Promise<QueryResult> {
    const startTime = Date.now()
    const plan = this.analyzeQuery(sql)

    if (!plan.requiresFederation) {
      // Simple local query
      const result = await this.duckdb.executeQuery(sql)
      return {
        data: result,
        metadata: {
          rowCount: Array.isArray(result) ? result.length : 0,
          executionTime: Date.now() - startTime,
          sourcesQueried: ['local'],
        },
      }
    }

    // Execute federated query
    const sourcesQueried: string[] = ['local']

    // Fetch data from remote sources in parallel
    const remoteDataPromises: Promise<[string, any]>[] = []

    for (const [serverAlias, serverQuery] of plan.remoteQueries) {
      remoteDataPromises.push(
        this.fetchRemoteData(serverAlias, serverQuery).then(
          (data) => [serverAlias, data] as [string, any]
        )
      )
      sourcesQueried.push(serverAlias)
    }

    const remoteResults = await Promise.all(remoteDataPromises)

    // Create temporary tables for remote data
    const tempTables: Map<string, string> = new Map()

    for (const [serverAlias, data] of remoteResults) {
      const tempTableName = await this.createTempTable(serverAlias, data)
      tempTables.set(serverAlias, tempTableName)
    }

    // Execute the local query with temp tables
    let localQuery = plan.localQuery || sql

    // Replace references with temp table names
    for (const [serverAlias, tempTableName] of tempTables) {
      // Replace mcp:// URIs with properly escaped identifier
      const escapedTableName = escapeIdentifier(tempTableName)
      localQuery = localQuery.replace(
        new RegExp(`mcp://${serverAlias}/\\S+`, 'gi'),
        escapedTableName
      )

      // Replace server.table references with properly escaped identifier
      localQuery = localQuery.replace(
        new RegExp(`\\b${serverAlias}\\.(\\w+)\\b`, 'gi'),
        escapedTableName
      )
    }

    // Execute the final query
    const result = await this.duckdb.executeQuery(localQuery)

    // Clean up temp tables
    await this.cleanupTempTables(Array.from(tempTables.values()))

    return {
      data: result,
      metadata: {
        rowCount: Array.isArray(result) ? result.length : 0,
        executionTime: Date.now() - startTime,
        sourcesQueried,
      },
    }
  }

  /**
   * Execute a federated query with streaming results
   */
  async *executeQueryStream(sql: string): AsyncGenerator<any, void, unknown> {
    const plan = this.analyzeQuery(sql)

    if (!plan.requiresFederation) {
      // Stream local results
      const result = await this.duckdb.executeQuery(sql)
      if (Array.isArray(result)) {
        for (const row of result) {
          yield row
        }
      } else {
        yield result
      }
      return
    }

    // For federated queries, we need to materialize remote data first
    // Then stream the joined results
    const queryResult = await this.executeQuery(sql)

    if (Array.isArray(queryResult.data)) {
      for (const row of queryResult.data) {
        yield row
      }
    } else {
      yield queryResult.data
    }
  }

  /**
   * Fetch data from a remote MCP server
   */
  private async fetchRemoteData(serverAlias: string, query: string): Promise<any> {
    try {
      // Get the client from the connection pool
      const serverResources = this.resourceRegistry.getServerResources(serverAlias)
      if (serverResources.length === 0) {
        throw new Error(`No resources found for server '${serverAlias}'`)
      }

      // Use the first resource to get the server URL (all resources from same server)
      const resource = serverResources[0]
      const resolved = this.resourceRegistry.resolve(resource.fullUri)

      if (!resolved) {
        throw new Error(`Cannot resolve server URL for '${serverAlias}'`)
      }

      // For now, we'll fetch the resource directly
      // In a real implementation, we'd use a query tool if the server supports it
      const client = await this.connectionPool.getClient(
        resource.fullUri.replace(/^mcp:\/\/[^/]+\//, ''), // Extract base URL
        'auto'
      )

      // Try to use a query tool if available
      const tools = await client.listTools()
      const queryTool = tools.tools.find(
        (t) => t.name.toLowerCase().includes('query') || t.name.toLowerCase().includes('sql')
      )

      if (queryTool) {
        // Use the query tool
        const result = await client.callTool({
          name: queryTool.name,
          arguments: { query, sql: query },
        })
        // The result should contain the actual data
        if (result && typeof result === 'object' && 'content' in result) {
          return (result as any).content
        }
        return result
      }

      // Fallback: Read the resource directly
      const resourceUri = query.match(/from\s+(\S+)/i)?.[1] || serverAlias
      const result = await client.readResource({ uri: resourceUri })

      // Parse the content
      const content = result.contents[0]
      if (content && 'text' in content && typeof content.text === 'string') {
        try {
          return JSON.parse(content.text)
        } catch {
          // Return as CSV or raw text
          return content.text
        }
      } else if (content && 'blob' in content && typeof content.blob === 'string') {
        // Handle binary content
        return Buffer.from(content.blob, 'base64')
      }

      return null
    } catch (error) {
      logger.error(`Failed to fetch data from '${serverAlias}':`, error)
      throw new Error(`Failed to fetch remote data from '${serverAlias}': ${error}`)
    }
  }

  /**
   * Create a temporary table from remote data
   */
  private async createTempTable(serverAlias: string, data: any): Promise<string> {
    const tempTableName = `temp_${serverAlias}_${++this.tempTableCounter}`

    if (Array.isArray(data)) {
      // JSON array data
      await this.duckdb.createTableFromJSON(tempTableName, data)
    } else if (typeof data === 'string') {
      // CSV or text data
      const crypto = await import('crypto')
      const randomBytes = crypto.randomBytes(16).toString('hex')
      const tempFile = `/tmp/federation_${Date.now()}_${randomBytes}.csv`
      const fs = await import('fs/promises')

      try {
        await fs.writeFile(tempFile, data)
        const sql = `CREATE TEMP TABLE ${escapeIdentifier(tempTableName)} AS SELECT * FROM read_csv_auto(${escapeFilePath(tempFile)})`
        await this.duckdb.executeQuery(sql)
      } finally {
        try {
          await fs.unlink(tempFile)
        } catch {
          // Ignore cleanup errors
        }
      }
    } else if (Buffer.isBuffer(data)) {
      // Binary data (e.g., Parquet)
      const crypto = await import('crypto')
      const randomBytes = crypto.randomBytes(16).toString('hex')
      const tempFile = `/tmp/federation_${Date.now()}_${randomBytes}.parquet`
      const fs = await import('fs/promises')

      try {
        await fs.writeFile(tempFile, data)
        const sql = `CREATE TEMP TABLE ${escapeIdentifier(tempTableName)} AS SELECT * FROM read_parquet(${escapeFilePath(tempFile)})`
        await this.duckdb.executeQuery(sql)
      } finally {
        try {
          await fs.unlink(tempFile)
        } catch {
          // Ignore cleanup errors
        }
      }
    } else {
      throw new Error(`Unsupported data type for temp table creation`)
    }

    logger.info(`📊 Created temp table '${tempTableName}' for server '${serverAlias}'`)
    return tempTableName
  }

  /**
   * Clean up temporary tables
   */
  private async cleanupTempTables(tables: string[]): Promise<void> {
    for (const table of tables) {
      try {
        await this.duckdb.executeQuery(`DROP TABLE IF EXISTS ${escapeIdentifier(table)}`)
      } catch (error) {
        logger.warn(`Failed to drop temp table '${table}':`, error)
      }
    }
  }

  /**
   * Extract the query portion for a specific server
   */
  private extractServerQuery(
    sql: string,
    reference: string,
    serverAlias: string,
    resourcePath: string
  ): string {
    // This is a simplified extraction
    // In a real implementation, we'd use a SQL parser

    // For now, just return a SELECT * from the resource
    return `SELECT * FROM ${resourcePath}`
  }

  /**
   * Prepare the local query with placeholders for remote data
   */
  private prepareLocalQuery(sql: string, _remoteQueries: Map<string, string>): string {
    // This would replace remote references with temp table names
    // For now, return the original query
    return sql
  }

  /**
   * Determine the best join strategy based on the query
   */
  private determineJoinStrategy(sql: string): 'hash' | 'merge' | 'nested' {
    // Simple heuristic: use hash join by default
    // Could be enhanced with cost-based optimization

    const sqlLower = sql.toLowerCase()

    if (sqlLower.includes('order by')) {
      return 'merge' // Merge join for sorted data
    } else if (sqlLower.includes('where') && sqlLower.includes(' in ')) {
      return 'nested' // Nested loop for IN clauses
    }

    return 'hash' // Default to hash join
  }

  /**
   * Explain a federated query plan
   */
  explainQuery(sql: string): string {
    const plan = this.analyzeQuery(sql)

    let explanation = 'Query Execution Plan:\n'
    explanation += '=====================\n\n'

    if (!plan.requiresFederation) {
      explanation += '• Local query only (no federation required)\n'
      explanation += `• Query: ${sql}\n`
    } else {
      explanation += '• Federated query detected\n'
      explanation += `• Sources involved: ${plan.remoteQueries.size + 1} (${plan.remoteQueries.size} remote + 1 local)\n\n`

      explanation += 'Remote Queries:\n'
      for (const [server, query] of plan.remoteQueries) {
        explanation += `  • ${server}: ${query}\n`
      }

      if (plan.joinStrategy) {
        explanation += `\nJoin Strategy: ${plan.joinStrategy}\n`
      }

      explanation += `\nLocal Query (after federation):\n${plan.localQuery}\n`
    }

    return explanation
  }

  /**
   * Get query router statistics
   */
  getStats(): {
    tempTablesCreated: number
    queriesRouted: number
  } {
    return {
      tempTablesCreated: this.tempTableCounter,
      queriesRouted: this.tempTableCounter, // Approximate
    }
  }
}
