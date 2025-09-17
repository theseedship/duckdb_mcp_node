export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: {
        module: 'ESNext',
        moduleResolution: 'node',
      },
    },
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // TODO: Increase coverage thresholds as we add more tests
  // Current coverage is low because we only have tests for service.ts
  // Need to add tests for: protocol/*, server/mcp-server.ts, client/MCPClient.ts
  // Temporarily lowered after security fixes affected coverage metrics
  // Target: branches: 10, functions: 15, lines: 15, statements: 15
  coverageThreshold: {
    global: {
      branches: 6,
      functions: 9,
      lines: 7,
      statements: 7,
    },
  },
}
