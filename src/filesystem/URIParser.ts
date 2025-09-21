/**
 * URI Parser for Virtual Filesystem
 * Parses mcp:// URIs into components for resource resolution
 */

// import { logger } from '../utils/logger.js' // Disabled to avoid STDIO interference

/**
 * Represents a parsed MCP URI
 */
export interface ParsedURI {
  protocol: 'mcp'
  server: string
  path: string
  filename?: string
  extension?: string
  format?: 'csv' | 'json' | 'parquet' | 'arrow' | 'excel' | 'unknown'
  isGlob: boolean
  queryParams?: Map<string, string>
}

/**
 * Parser for MCP URIs in the format: mcp://server/path/to/resource.ext
 */
export class URIParser {
  private static readonly MCP_PROTOCOL = 'mcp://'
  private static readonly FORMAT_MAP: Record<string, ParsedURI['format']> = {
    csv: 'csv',
    tsv: 'csv',
    json: 'json',
    jsonl: 'json',
    ndjson: 'json',
    parquet: 'parquet',
    pq: 'parquet',
    arrow: 'arrow',
    feather: 'arrow',
    xlsx: 'excel',
    xls: 'excel',
  }

  /**
   * Parse an MCP URI into components
   * @param uri The URI to parse (e.g., mcp://weather-server/data/forecast.csv)
   * @returns Parsed URI components
   */
  static parse(uri: string): ParsedURI {
    if (!uri.startsWith(this.MCP_PROTOCOL)) {
      throw new Error(`Invalid MCP URI: must start with ${this.MCP_PROTOCOL}`)
    }

    // Remove protocol prefix
    const withoutProtocol = uri.slice(this.MCP_PROTOCOL.length)

    // Split by first slash to separate server from path
    const firstSlashIndex = withoutProtocol.indexOf('/')

    let server: string
    let pathWithQuery: string

    if (firstSlashIndex === -1) {
      // No path, just server (e.g., mcp://server)
      server = withoutProtocol
      pathWithQuery = '/'
    } else {
      server = withoutProtocol.slice(0, firstSlashIndex)
      pathWithQuery = withoutProtocol.slice(firstSlashIndex)
    }

    // Check for query parameters
    let path = pathWithQuery
    let queryParams: Map<string, string> | undefined

    const queryIndex = pathWithQuery.indexOf('?')
    if (queryIndex !== -1) {
      path = pathWithQuery.slice(0, queryIndex)
      const queryString = pathWithQuery.slice(queryIndex + 1)
      queryParams = this.parseQueryString(queryString)
    }

    // Validate server name (allow wildcards for glob patterns)
    if (!server || (server !== '*' && (server.includes('/') || server.includes('\\')))) {
      throw new Error(`Invalid server name in MCP URI: ${server}`)
    }

    // Extract filename and extension
    const pathSegments = path.split('/').filter(Boolean)
    const lastSegment = pathSegments[pathSegments.length - 1]

    let filename: string | undefined
    let extension: string | undefined
    let format: ParsedURI['format'] = 'unknown'

    if (lastSegment && !lastSegment.endsWith('/')) {
      filename = lastSegment

      // Extract extension
      const lastDotIndex = filename.lastIndexOf('.')
      if (lastDotIndex > 0 && lastDotIndex < filename.length - 1) {
        extension = filename.slice(lastDotIndex + 1).toLowerCase()
        format = this.FORMAT_MAP[extension] || 'unknown'
      }
    }

    // Check if it's a glob pattern (in server or path)
    const isGlob =
      server === '*' ||
      server.includes('*') ||
      path.includes('*') ||
      path.includes('?') ||
      path.includes('[')

    const parsed: ParsedURI = {
      protocol: 'mcp',
      server,
      path,
      filename,
      extension,
      format,
      isGlob,
      queryParams,
    }

    // logger.debug(`Parsed URI: ${uri} → ${JSON.stringify(parsed)}`) // Disabled to avoid STDIO interference
    return parsed
  }

  /**
   * Parse a query string into key-value pairs
   */
  private static parseQueryString(queryString: string): Map<string, string> {
    const params = new Map<string, string>()

    if (!queryString) return params

    const pairs = queryString.split('&')
    for (const pair of pairs) {
      const [key, value] = pair.split('=')
      if (key) {
        params.set(decodeURIComponent(key), value ? decodeURIComponent(value) : '')
      }
    }

    return params
  }

  /**
   * Validate if a string is a valid MCP URI
   */
  static isValid(uri: string): boolean {
    try {
      this.parse(uri)
      return true
    } catch {
      return false
    }
  }

  /**
   * Extract all MCP URIs from a SQL query
   * @param sql The SQL query to scan
   * @returns Array of found MCP URIs
   */
  static extractFromSQL(sql: string): string[] {
    const uris: string[] = []

    // Patterns to match:
    // 1. Single quotes: 'mcp://...'
    // 2. Double quotes: "mcp://..."
    // 3. Backticks: `mcp://...`
    // 4. Function calls: read_*(mcp://...)

    const patterns = [
      /'(mcp:\/\/[^']+)'/g,
      /"(mcp:\/\/[^"]+)"/g,
      /`(mcp:\/\/[^`]+)`/g,
      /\b(?:read_csv|read_json_auto|read_parquet|read_json|read_excel)\s*\(\s*['"`]?(mcp:\/\/[^'"`)]+)['"`]?\s*\)/gi,
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(sql)) !== null) {
        const uri = match[1]
        if (!uris.includes(uri)) {
          uris.push(uri)
        }
      }
    }

    return uris
  }

  /**
   * Build an MCP URI from components
   */
  static build(components: {
    server: string
    path: string
    queryParams?: Record<string, string>
  }): string {
    let uri = `${this.MCP_PROTOCOL}${components.server}`

    // Ensure path starts with /
    if (!components.path.startsWith('/')) {
      uri += '/'
    }
    uri += components.path

    // Add query parameters if present
    if (components.queryParams && Object.keys(components.queryParams).length > 0) {
      const queryString = Object.entries(components.queryParams)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&')
      uri += `?${queryString}`
    }

    return uri
  }

  /**
   * Check if a path matches a glob pattern
   */
  static matchesGlob(pattern: string, path: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\[([^\]]+)\]/g, '[$1]')

    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(path)
  }

  /**
   * Expand a glob pattern to multiple URIs
   * @param globURI The glob URI pattern with wildcards
   * @param availableResources List of available resources
   * @returns Array of matching URIs
   */
  static expandGlob(
    globURI: string,
    availableResources: Array<{ server: string; path: string }>
  ): string[] {
    const parsed = this.parse(globURI)

    if (!parsed.isGlob) {
      return [globURI]
    }

    const matchingURIs: string[] = []

    for (const resource of availableResources) {
      // Check if server matches
      const serverMatches =
        parsed.server === '*' ||
        this.matchesGlob(parsed.server, resource.server) ||
        parsed.server === resource.server

      if (!serverMatches) continue

      // Check if path matches
      const pathMatches = this.matchesGlob(parsed.path, resource.path)

      if (pathMatches) {
        matchingURIs.push(
          this.build({
            server: resource.server,
            path: resource.path,
          })
        )
      }
    }

    return matchingURIs
  }
}
