/**
 * MotherDuck MCP Tools
 * Tools for managing MotherDuck cloud connections
 */

import { z } from 'zod'
import { DuckDBService } from '../duckdb/service.js'
import { MotherDuckService } from '../service/motherduck.js'
import { logger } from '../utils/logger.js'

// Input schemas for MotherDuck tools
const MotherDuckAttachInputSchema = z.object({
  token: z.string().describe('MotherDuck authentication token'),
  database: z.string().optional().describe('Database name to connect to'),
  endpoint: z.string().optional().describe('MotherDuck endpoint (default: app.motherduck.com)'),
})

const MotherDuckQueryInputSchema = z.object({
  sql: z.string().describe('SQL query to execute on MotherDuck'),
  limit: z.number().optional().default(1000).describe('Maximum rows to return'),
})

const MotherDuckShareInputSchema = z.object({
  localTable: z.string().describe('Local table name to share'),
  cloudTable: z
    .string()
    .optional()
    .describe('Target table name in MotherDuck (defaults to local name)'),
})

const MotherDuckImportInputSchema = z.object({
  cloudTable: z.string().describe('MotherDuck table name to import'),
  localTable: z.string().optional().describe('Target local table name (defaults to cloud name)'),
})

const MotherDuckCreateDatabaseInputSchema = z.object({
  name: z.string().describe('Database name to create'),
})

/**
 * MotherDuck tool handlers
 */
export class MotherDuckToolHandlers {
  private motherduck: MotherDuckService

  constructor(duckdb: DuckDBService) {
    this.motherduck = new MotherDuckService(duckdb)
  }

  /**
   * Attach to MotherDuck cloud
   */
  async attach(input: z.infer<typeof MotherDuckAttachInputSchema>) {
    try {
      await this.motherduck.attach({
        token: input.token,
        database: input.database,
        endpoint: input.endpoint,
      })

      const status = await this.motherduck.getStatus()

      return {
        success: true,
        message: `Connected to MotherDuck${input.database ? ` (database: ${input.database})` : ''}`,
        status,
      }
    } catch (error) {
      logger.error('Failed to attach to MotherDuck:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Detach from MotherDuck
   */
  async detach() {
    try {
      await this.motherduck.detach()

      return {
        success: true,
        message: 'Disconnected from MotherDuck',
      }
    } catch (error) {
      logger.error('Failed to detach from MotherDuck:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get MotherDuck status
   */
  async status() {
    try {
      const status = await this.motherduck.getStatus()

      return {
        success: true,
        ...status,
      }
    } catch (error) {
      logger.error('Failed to get MotherDuck status:', error)
      return {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * List databases in MotherDuck
   */
  async listDatabases() {
    try {
      const databases = await this.motherduck.listDatabases()

      return {
        success: true,
        databases,
        count: databases.length,
      }
    } catch (error) {
      logger.error('Failed to list MotherDuck databases:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Create a database in MotherDuck
   */
  async createDatabase(input: z.infer<typeof MotherDuckCreateDatabaseInputSchema>) {
    try {
      await this.motherduck.createDatabase(input.name)

      return {
        success: true,
        message: `Created database '${input.name}' in MotherDuck`,
        database: input.name,
      }
    } catch (error) {
      logger.error('Failed to create MotherDuck database:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Execute query on MotherDuck
   */
  async query(input: z.infer<typeof MotherDuckQueryInputSchema>) {
    try {
      const results = await this.motherduck.query(input.sql)

      // Apply limit if specified
      const limitedResults = input.limit ? results.slice(0, input.limit) : results

      return {
        success: true,
        columns: results.length > 0 ? Object.keys(results[0]) : [],
        rows: limitedResults,
        rowCount: limitedResults.length,
        totalRows: results.length,
      }
    } catch (error) {
      logger.error('MotherDuck query failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Share a local table to MotherDuck
   */
  async shareTable(input: z.infer<typeof MotherDuckShareInputSchema>) {
    try {
      await this.motherduck.shareTable(input.localTable, input.cloudTable)

      return {
        success: true,
        message: `Shared table '${input.localTable}' to MotherDuck${
          input.cloudTable ? ` as '${input.cloudTable}'` : ''
        }`,
        localTable: input.localTable,
        cloudTable: input.cloudTable || input.localTable,
      }
    } catch (error) {
      logger.error('Failed to share table to MotherDuck:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Import a table from MotherDuck
   */
  async importTable(input: z.infer<typeof MotherDuckImportInputSchema>) {
    try {
      await this.motherduck.importTable(input.cloudTable, input.localTable)

      return {
        success: true,
        message: `Imported table '${input.cloudTable}' from MotherDuck${
          input.localTable ? ` as '${input.localTable}'` : ''
        }`,
        cloudTable: input.cloudTable,
        localTable: input.localTable || input.cloudTable,
      }
    } catch (error) {
      logger.error('Failed to import table from MotherDuck:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}

/**
 * Get MotherDuck tool definitions for MCP
 */
export function getMotherDuckToolDefinitions() {
  return [
    {
      name: 'motherduck.attach',
      description: 'Connect to MotherDuck cloud instance',
      inputSchema: MotherDuckAttachInputSchema,
    },
    {
      name: 'motherduck.detach',
      description: 'Disconnect from MotherDuck cloud',
      inputSchema: z.object({}),
    },
    {
      name: 'motherduck.status',
      description: 'Get current MotherDuck connection status',
      inputSchema: z.object({}),
    },
    {
      name: 'motherduck.list_databases',
      description: 'List all databases in MotherDuck',
      inputSchema: z.object({}),
    },
    {
      name: 'motherduck.create_database',
      description: 'Create a new database in MotherDuck',
      inputSchema: MotherDuckCreateDatabaseInputSchema,
    },
    {
      name: 'motherduck.query',
      description: 'Execute a query on MotherDuck cloud',
      inputSchema: MotherDuckQueryInputSchema,
    },
    {
      name: 'motherduck.share_table',
      description: 'Share a local table to MotherDuck cloud',
      inputSchema: MotherDuckShareInputSchema,
    },
    {
      name: 'motherduck.import_table',
      description: 'Import a table from MotherDuck to local',
      inputSchema: MotherDuckImportInputSchema,
    },
  ]
}

/**
 * Create MotherDuck tool handlers with DuckDB service
 */
export function createMotherDuckHandlers(duckdb: DuckDBService) {
  const handlers = new MotherDuckToolHandlers(duckdb)

  return {
    'motherduck.attach': (input: unknown) => handlers.attach(input),
    'motherduck.detach': () => handlers.detach(),
    'motherduck.status': () => handlers.status(),
    'motherduck.list_databases': () => handlers.listDatabases(),
    'motherduck.create_database': (input: unknown) => handlers.createDatabase(input),
    'motherduck.query': (input: unknown) => handlers.query(input),
    'motherduck.share_table': (input: unknown) => handlers.shareTable(input),
    'motherduck.import_table': (input: unknown) => handlers.importTable(input),
  }
}
