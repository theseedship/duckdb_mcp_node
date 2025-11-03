import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'build'],
    coverage: {
      enabled: true,
      include: ['src/**/*.ts'], // Required in Vitest v4
      reporter: ['text', 'lcov', 'html'],
      provider: 'v8',
      exclude: [
        'node_modules',
        'dist',
        '**/*.d.ts',
        '**/__tests__/**',
        '**/index.ts',
        '**/__mocks__/**',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
      ],
      thresholds: {
        branches: 6,
        functions: 9,
        lines: 7,
        statements: 7,
      },
    },
    setupFiles: ['./vitest.setup.ts'],
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    pool: 'forks',
    maxWorkers: 1, // Vitest v4: replaces poolOptions.forks.singleFork
    isolate: false, // Vitest v4: equivalent to singleFork: true
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
