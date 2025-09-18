import { vi } from 'vitest'

export const StdioClientTransport = vi.fn().mockImplementation(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  send: vi.fn().mockResolvedValue(undefined),
}))

export const StdioServerTransport = vi.fn().mockImplementation(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  send: vi.fn().mockResolvedValue(undefined),
}))