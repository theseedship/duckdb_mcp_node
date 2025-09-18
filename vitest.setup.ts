import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env' })

// Global test setup
beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = 'test'
  process.env.MCP_SECURITY_MODE = 'development'
  process.env.SUPPRESS_NO_CONFIG_WARNING = 'true'
})

// Cleanup after each test
afterEach(() => {
  // Clear any mocks
  vi.clearAllMocks()
})

// Global teardown
afterAll(() => {
  // Cleanup any remaining resources
  vi.restoreAllMocks()
})

// Mock console methods to reduce noise in tests
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
}

beforeEach(() => {
  // Suppress console output in tests unless explicitly testing console
  console.log = vi.fn()
  console.error = vi.fn()
  console.warn = vi.fn()
})

afterEach(() => {
  // Restore console
  console.log = originalConsole.log
  console.error = originalConsole.error
  console.warn = originalConsole.warn
})