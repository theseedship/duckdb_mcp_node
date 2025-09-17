/**
 * SQL escaping utilities to prevent SQL injection attacks
 */

/**
 * Escape a SQL identifier (table name, column name, schema name)
 * DuckDB uses double quotes for identifiers
 */
export function escapeIdentifier(identifier: string): string {
  if (!identifier) {
    throw new Error('Identifier cannot be empty')
  }

  // Check for invalid characters (only allow alphanumeric, underscore, and dash)
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(identifier)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Only alphanumeric characters, underscore, and dash are allowed.`
    )
  }

  // Double quote the identifier and escape any existing quotes
  return `"${identifier.replace(/"/g, '""')}"`
}

/**
 * Escape a SQL string value
 * DuckDB uses single quotes for strings
 */
export function escapeString(value: string): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }

  // Escape single quotes by doubling them
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Escape a file path for use in DuckDB file functions
 * File paths need special handling to prevent directory traversal
 */
export function escapeFilePath(path: string): string {
  if (!path) {
    throw new Error('File path cannot be empty')
  }

  // Prevent directory traversal attacks
  if (path.includes('../') || path.includes('..\\')) {
    throw new Error('Directory traversal not allowed in file paths')
  }

  // Escape the path as a string
  return escapeString(path)
}

/**
 * Build a safe qualified table name (schema.table)
 */
export function buildQualifiedName(schema: string, table: string): string {
  return `${escapeIdentifier(schema)}.${escapeIdentifier(table)}`
}

/**
 * Validate and escape a limit value
 */
export function escapeLimit(limit: number | string): number {
  const numLimit = typeof limit === 'string' ? parseInt(limit, 10) : limit

  if (isNaN(numLimit) || numLimit < 0) {
    throw new Error('Invalid LIMIT value')
  }

  // Cap at a reasonable maximum
  return Math.min(numLimit, 100000)
}

/**
 * Create a parameterized query placeholder
 * Note: DuckDB Node.js API may not support prepared statements yet,
 * so this is for future use
 */
export function createPlaceholder(index: number): string {
  return `$${index}`
}
