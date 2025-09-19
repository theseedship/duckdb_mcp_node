/**
 * Centralized logger for DuckDB MCP Node
 *
 * Prevents stdout pollution in MCP/STDIO mode by routing all logs to stderr.
 * In normal mode, uses console methods as usual.
 *
 * @packageDocumentation
 */

// Detect if running in MCP/STDIO mode
// Check both environment variable and command line arguments
const isMCPMode =
  process.env.MCP_MODE === 'stdio' ||
  process.argv.includes('--stdio') ||
  process.argv.some((arg) => arg.includes('mcp-inspector')) ||
  process.argv.some((arg) => arg.includes('@modelcontextprotocol/inspector'))

// In test environments, suppress logs unless DEBUG is set
const isTestMode = process.env.NODE_ENV === 'test' && !process.env.DEBUG

/**
 * Logger interface matching console methods
 */
export interface Logger {
  debug: (...args: any[]) => void
  info: (...args: any[]) => void
  warn: (...args: any[]) => void
  error: (...args: any[]) => void
  log: (...args: any[]) => void
}

/**
 * Create a logger function that respects MCP mode
 */
function createLogFunction(level: string): (...args: any[]) => void {
  return (...args: any[]) => {
    // Suppress logs in test mode unless DEBUG is set
    if (isTestMode) {
      return
    }

    // In MCP mode, all output must go to stderr to avoid polluting stdout
    if (isMCPMode) {
      // Format the message with level prefix for clarity
      const prefix = `[${level.toUpperCase()}]`
      const timestamp = new Date().toISOString()

      // Write to stderr with timestamp and level
      process.stderr.write(
        `${timestamp} ${prefix} ${args
          .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
          .join(' ')}\n`
      )
    } else {
      // In normal mode, use console methods as usual
      switch (level) {
        case 'debug':
          console.debug(...args)
          break
        case 'info':
          console.info(...args)
          break
        case 'warn':
          console.warn(...args)
          break
        case 'error':
          console.error(...args)
          break
        default:
          console.log(...args)
      }
    }
  }
}

/**
 * Main logger instance
 *
 * Usage:
 * ```typescript
 * import { logger } from './utils/logger.js'
 *
 * logger.info('Server started')
 * logger.error('Connection failed', error)
 * ```
 */
export const logger: Logger = {
  debug: createLogFunction('debug'),
  info: createLogFunction('info'),
  warn: createLogFunction('warn'),
  error: createLogFunction('error'),
  log: createLogFunction('log'),
}

/**
 * Check if running in MCP mode
 */
export function isInMCPMode(): boolean {
  return isMCPMode
}

/**
 * Create a child logger with a specific context
 * Useful for module-specific logging
 */
export function createLogger(context: string): Logger {
  return {
    debug: (...args: any[]) => logger.debug(`[${context}]`, ...args),
    info: (...args: any[]) => logger.info(`[${context}]`, ...args),
    warn: (...args: any[]) => logger.warn(`[${context}]`, ...args),
    error: (...args: any[]) => logger.error(`[${context}]`, ...args),
    log: (...args: any[]) => logger.log(`[${context}]`, ...args),
  }
}

// Export default for convenience
export default logger
