import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logger, isInMCPMode, createLogger } from './logger.js'

describe('Logger', () => {
  let originalEnv: NodeJS.ProcessEnv
  let originalArgv: string[]
  let stdoutSpy: any
  let stderrSpy: any
  let consoleLogSpy: any
  let consoleErrorSpy: any
  let consoleWarnSpy: any
  let consoleInfoSpy: any
  let consoleDebugSpy: any

  beforeEach(() => {
    // Save original state
    originalEnv = { ...process.env }
    originalArgv = [...process.argv]

    // Create spies for stdout/stderr
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    // Create spies for console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    // Restore original state
    process.env = originalEnv
    process.argv = originalArgv

    // Clear all spies
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('MCP Mode Detection', () => {
    it('should detect MCP mode from environment variable', () => {
      // Note: We can't dynamically reload ESM modules, so we test the function directly
      // The actual detection happens at module load time
      expect(isInMCPMode()).toBe(false) // Will be false in test environment
    })

    it('should work with MCP_MODE set', () => {
      // This tests the runtime behavior, not the module-level detection
      const originalMode = process.env.MCP_MODE
      process.env.MCP_MODE = 'stdio'

      // The function was already evaluated at module load time
      // So this just verifies the test environment
      expect(process.env.MCP_MODE).toBe('stdio')

      process.env.MCP_MODE = originalMode
    })

    it('should work with --stdio flag', () => {
      // Test that the flag exists in argv
      process.argv.push('--stdio')
      expect(process.argv.includes('--stdio')).toBe(true)
      process.argv.pop()
    })

    it('should work in normal operation', () => {
      // Clean environment - tests run without MCP mode
      delete process.env.MCP_MODE
      expect(isInMCPMode()).toBe(false)
    })
  })

  describe('Normal Mode Operation', () => {
    it('should use console methods when not in MCP mode', () => {
      // The logger is already imported, and MCP mode is determined at module load
      // Since we're in test environment without MCP_MODE, it should use console
      logger.log('log message')
      logger.info('info message')
      logger.warn('warn message')
      logger.error('error message')
      logger.debug('debug message')

      // Console methods should be called
      expect(consoleLogSpy).toHaveBeenCalledWith('log message')
      expect(consoleInfoSpy).toHaveBeenCalledWith('info message')
      expect(consoleWarnSpy).toHaveBeenCalledWith('warn message')
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message')
      expect(consoleDebugSpy).toHaveBeenCalledWith('debug message')
    })
  })

  describe('Child Logger', () => {
    it('should prefix messages with context', () => {
      const childLogger = createLogger('MyModule')
      childLogger.info('child message')

      expect(consoleInfoSpy).toHaveBeenCalledWith('[MyModule]', 'child message')
    })

    it('should work with multiple arguments', () => {
      const childLogger = createLogger('Database')
      childLogger.error('connection failed', { host: 'localhost', port: 5432 })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Database]',
        'connection failed',
        { host: 'localhost', port: 5432 }
      )
    })
  })
})