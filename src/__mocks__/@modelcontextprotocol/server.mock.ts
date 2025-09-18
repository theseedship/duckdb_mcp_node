import { vi } from 'vitest'

export const mockServerInstance = {
  setRequestHandler: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  error: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  _handlers: new Map(),
}

export const Server = vi.fn().mockImplementation(() => {
  const instance = { ...mockServerInstance }
  instance.setRequestHandler = vi.fn((schema, handler) => {
    // Store handlers for testing
    if (typeof schema === 'string') {
      instance._handlers.set(schema, handler)
    } else {
      instance._handlers.set('handler_' + instance._handlers.size, handler)
    }
  })
  return instance
})

export const DuckDBMCPServer = vi.fn().mockImplementation(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
}))