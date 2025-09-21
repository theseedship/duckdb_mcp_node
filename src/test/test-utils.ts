/**
 * Test utilities and helpers for CI environment detection
 */

/**
 * Check if running in CI environment
 */
export function isCI(): boolean {
  return (
    process.env.CI === 'true' ||
    process.env.GITHUB_ACTIONS === 'true' ||
    process.env.JENKINS === 'true' ||
    process.env.TRAVIS === 'true' ||
    process.env.CIRCLECI === 'true'
  )
}

/**
 * Check if network tests should be skipped
 */
export function shouldSkipNetworkTests(): boolean {
  return process.env.SKIP_NETWORK_TESTS === 'true' || isCI()
}

/**
 * Get appropriate test timeout based on environment
 */
export function getTestTimeout(): number {
  if (isCI()) {
    return 30000 // 30 seconds for CI
  }
  return 10000 // 10 seconds for local
}

/**
 * Get appropriate port for testing based on environment
 */
export function getTestPort(): number {
  // Use different port ranges for CI to avoid conflicts
  const basePort = isCI() ? 9000 : 6000
  // Add random offset to avoid conflicts between parallel test runs
  return basePort + Math.floor(Math.random() * 1000)
}

/**
 * Clean up test resources with retry logic for CI
 */
export async function cleanupWithRetry(
  cleanup: () => Promise<void>,
  maxRetries = 3,
  delay = 1000
): Promise<void> {
  let lastError: Error | undefined

  for (let i = 0; i < maxRetries; i++) {
    try {
      await cleanup()
      return
    } catch (error) {
      lastError = error as Error
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  if (lastError) {
    throw lastError
  }
}

/**
 * Wait for condition with timeout
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    const result = await condition()
    if (result) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  throw new Error(`Condition not met within ${timeout}ms`)
}

/**
 * Create test database path with proper cleanup
 */
export function getTestDatabasePath(testName: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  return `/tmp/test-db-${testName}-${timestamp}-${random}.db`
}

/**
 * Skip test if condition is met
 */
export function skipIf(condition: boolean, testFn: any): any {
  if (condition) {
    return testFn.skip
  }
  return testFn
}
