/**
 * Query Preprocessor for Virtual Filesystem
 * Transforms SQL queries containing mcp:// URIs into executable DuckDB queries
 */

import { URIParser } from './URIParser.js'
import { FormatDetector } from './FormatDetector.js'
import { logger } from '../utils/logger.js'

/**
 * Represents a URI replacement in a query
 */
export interface URIReplacement {
  uri: string
  startPos: number
  endPos: number
  replacement: string
  needsResolution: boolean
}

/**
 * Query transformation result
 */
export interface TransformResult {
  originalQuery: string
  transformedQuery: string
  replacements: URIReplacement[]
  urisToResolve: string[]
}

/**
 * Preprocesses SQL queries to handle mcp:// URIs
 */
export class QueryPreprocessor {
  /**
   * Transform a SQL query by replacing mcp:// URIs
   * @param sql The original SQL query
   * @param resolver Function to resolve URIs to local paths
   * @returns Transformation result
   */
  static async transform(
    sql: string,
    resolver: (uri: string) => Promise<string | null>
  ): Promise<TransformResult> {
    // Extract all MCP URIs from the query
    const uris = URIParser.extractFromSQL(sql)

    if (uris.length === 0) {
      // No transformation needed
      return {
        originalQuery: sql,
        transformedQuery: sql,
        replacements: [],
        urisToResolve: [],
      }
    }

    logger.debug(`Found ${uris.length} MCP URI(s) in query`)

    // Process each URI
    const replacements: URIReplacement[] = []
    const urisToResolve: string[] = []
    let transformedQuery = sql

    for (const uri of uris) {
      const parsed = URIParser.parse(uri)

      // Get local path from resolver
      const localPath = await resolver(uri)

      if (localPath) {
        // Replace the URI with the local path
        const replacement = this.buildReplacement(localPath, parsed.format || 'unknown')

        // Find all occurrences of this URI in the query
        const occurrences = this.findOccurrences(sql, uri)

        for (const occurrence of occurrences) {
          replacements.push({
            uri,
            startPos: occurrence.start,
            endPos: occurrence.end,
            replacement,
            needsResolution: false,
          })
        }

        // Replace in the transformed query
        transformedQuery = this.replaceURI(transformedQuery, uri, replacement)
      } else {
        // URI needs to be resolved
        urisToResolve.push(uri)

        // Mark for resolution
        const occurrences = this.findOccurrences(sql, uri)
        for (const occurrence of occurrences) {
          replacements.push({
            uri,
            startPos: occurrence.start,
            endPos: occurrence.end,
            replacement: '', // Will be filled later
            needsResolution: true,
          })
        }
      }
    }

    return {
      originalQuery: sql,
      transformedQuery,
      replacements,
      urisToResolve,
    }
  }

  /**
   * Build replacement string for a URI
   * @param localPath The local file path
   * @param format The data format
   * @returns Replacement SQL fragment
   */
  private static buildReplacement(localPath: string, format: string): string {
    const detectedFormat =
      format === 'unknown' ? FormatDetector.fromExtension(localPath) : (format as any)

    return FormatDetector.buildReadQuery(localPath, detectedFormat)
  }

  /**
   * Find all occurrences of a URI in the query
   * @param sql The SQL query
   * @param uri The URI to find
   * @returns Array of positions
   */
  private static findOccurrences(sql: string, uri: string): Array<{ start: number; end: number }> {
    const occurrences: Array<{ start: number; end: number }> = []

    // Patterns to search for the URI
    const patterns = [
      // Single quotes: 'mcp://...'
      new RegExp(`'(${this.escapeRegex(uri)})'`, 'g'),
      // Double quotes: "mcp://..."
      new RegExp(`"(${this.escapeRegex(uri)})"`, 'g'),
      // Backticks: `mcp://...`
      new RegExp(`\`(${this.escapeRegex(uri)})\``, 'g'),
      // In function calls without quotes
      new RegExp(`\\b(read_[a-z_]+)\\s*\\(\\s*(${this.escapeRegex(uri)})\\s*\\)`, 'gi'),
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(sql)) !== null) {
        const uriStart = match.index + match[0].indexOf(uri)
        const uriEnd = uriStart + uri.length

        // Check if this occurrence is already recorded
        const exists = occurrences.some((o) => o.start === uriStart && o.end === uriEnd)

        if (!exists) {
          occurrences.push({ start: uriStart, end: uriEnd })
        }
      }
    }

    // Sort by position
    occurrences.sort((a, b) => a.start - b.start)

    return occurrences
  }

  /**
   * Replace URI in query with replacement
   * @param query The SQL query
   * @param uri The URI to replace
   * @param replacement The replacement string
   * @returns Modified query
   */
  private static replaceURI(query: string, uri: string, replacement: string): string {
    // Handle different quoting styles
    const patterns = [
      // FROM 'mcp://...'
      {
        pattern: new RegExp(`FROM\\s+['"\`]${this.escapeRegex(uri)}['"\`]`, 'gi'),
        replace: `FROM ${replacement}`,
      },

      // JOIN 'mcp://...'
      {
        pattern: new RegExp(`JOIN\\s+['"\`]${this.escapeRegex(uri)}['"\`]`, 'gi'),
        replace: `JOIN ${replacement}`,
      },

      // read_* functions
      {
        pattern: new RegExp(
          `(read_[a-z_]+)\\s*\\(\\s*['"\`]?${this.escapeRegex(uri)}['"\`]?\\s*\\)`,
          'gi'
        ),
        replace: replacement,
      },

      // General string replacement
      { pattern: new RegExp(`['"\`]${this.escapeRegex(uri)}['"\`]`, 'g'), replace: replacement },
    ]

    let result = query
    for (const { pattern, replace } of patterns) {
      result = result.replace(pattern, replace)
    }

    return result
  }

  /**
   * Escape special regex characters
   */
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * Apply replacements to a query
   * @param sql The original SQL query
   * @param replacements The replacements to apply
   * @returns Transformed query
   */
  static applyReplacements(sql: string, replacements: URIReplacement[]): string {
    // Sort replacements by position (reverse order to maintain positions)
    const sorted = [...replacements].sort((a, b) => b.startPos - a.startPos)

    let result = sql
    for (const replacement of sorted) {
      if (!replacement.needsResolution && replacement.replacement) {
        // Extract the part to replace (including quotes if present)
        const before = result.slice(0, replacement.startPos)
        const after = result.slice(replacement.endPos)

        // Check if the URI is quoted
        const hasQuotesBefore = before.match(/['"`]$/)
        const hasQuotesAfter = after.match(/^['"`]/)

        if (hasQuotesBefore && hasQuotesAfter) {
          // Remove the quotes around the URI
          const beforeWithoutQuote = before.slice(0, -1)
          const afterWithoutQuote = after.slice(1)
          result = beforeWithoutQuote + replacement.replacement + afterWithoutQuote
        } else {
          result = before + replacement.replacement + after
        }
      }
    }

    return result
  }

  /**
   * Validate a transformed query
   * @param query The transformed query
   * @returns True if valid, false otherwise
   */
  static validate(query: string): boolean {
    // Check for any remaining mcp:// URIs
    const remainingURIs = URIParser.extractFromSQL(query)
    if (remainingURIs.length > 0) {
      logger.warn(`Query still contains ${remainingURIs.length} unresolved MCP URI(s)`)
      return false
    }

    // Basic SQL syntax validation (very simple)
    const upperQuery = query.toUpperCase()

    // Check if it has at least SELECT and FROM
    if (
      !upperQuery.includes('SELECT') &&
      !upperQuery.includes('CREATE') &&
      !upperQuery.includes('INSERT')
    ) {
      return false
    }

    return true
  }

  /**
   * Expand glob patterns in a query
   * @param sql The SQL query
   * @param availableResources List of available resources
   * @returns Expanded query with all matching resources
   */
  static async expandGlobs(
    sql: string,
    availableResources: Array<{ server: string; path: string }>
  ): Promise<string> {
    const uris = URIParser.extractFromSQL(sql)
    let expandedQuery = sql

    for (const uri of uris) {
      const parsed = URIParser.parse(uri)

      if (parsed.isGlob) {
        // Expand the glob pattern
        const expandedURIs = URIParser.expandGlob(uri, availableResources)

        if (expandedURIs.length > 0) {
          // Build a UNION query for multiple files
          const unionParts = expandedURIs.map((expandedURI) => {
            const format = FormatDetector.fromExtension(expandedURI)
            return FormatDetector.buildReadQuery(expandedURI, format)
          })

          // Replace the glob with a UNION of all matching files
          const replacement =
            unionParts.length === 1 ? unionParts[0] : `(${unionParts.join(' UNION ALL ')})`

          expandedQuery = this.replaceURI(expandedQuery, uri, replacement)
        } else {
          logger.warn(`No resources match glob pattern: ${uri}`)
        }
      }
    }

    return expandedQuery
  }

  /**
   * Extract table references from a query
   * @param sql The SQL query
   * @returns List of table names referenced
   */
  static extractTableReferences(sql: string): string[] {
    const tables: string[] = []

    // Simple regex patterns for table extraction
    const patterns = [
      /FROM\s+([a-z_][a-z0-9_]*)/gi,
      /JOIN\s+([a-z_][a-z0-9_]*)/gi,
      /INTO\s+([a-z_][a-z0-9_]*)/gi,
      /UPDATE\s+([a-z_][a-z0-9_]*)/gi,
      /TABLE\s+([a-z_][a-z0-9_]*)/gi,
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(sql)) !== null) {
        const table = match[1]
        if (!tables.includes(table) && !this.isKeyword(table)) {
          tables.push(table)
        }
      }
    }

    return tables
  }

  /**
   * Check if a word is a SQL keyword
   */
  private static isKeyword(word: string): boolean {
    const keywords = [
      'SELECT',
      'FROM',
      'WHERE',
      'JOIN',
      'LEFT',
      'RIGHT',
      'INNER',
      'OUTER',
      'GROUP',
      'ORDER',
      'BY',
      'HAVING',
      'LIMIT',
      'OFFSET',
      'UNION',
      'ALL',
      'AS',
      'ON',
      'AND',
      'OR',
      'NOT',
      'IN',
      'EXISTS',
      'BETWEEN',
      'LIKE',
      'CREATE',
      'TABLE',
      'VIEW',
      'INDEX',
      'INSERT',
      'UPDATE',
      'DELETE',
      'VALUES',
      'SET',
      'WITH',
      'TEMP',
      'TEMPORARY',
    ]

    return keywords.includes(word.toUpperCase())
  }
}
