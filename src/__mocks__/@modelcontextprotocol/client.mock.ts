import { vi } from 'vitest'

export const mockClientInstance = {
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  listResources: vi.fn().mockResolvedValue({
    resources: [
      {
        uri: 'test://resource1',
        name: 'Resource 1',
        mimeType: 'application/json',
      },
      {
        uri: 'test://resource2',
        name: 'Resource 2',
        mimeType: 'text/csv',
      },
    ],
  }),
  listTools: vi.fn().mockResolvedValue({
    tools: [
      { name: 'tool1', description: 'Test tool 1' },
      { name: 'tool2', description: 'Test tool 2' },
    ],
  }),
  readResource: vi.fn().mockResolvedValue({
    contents: [
      {
        text: JSON.stringify([{ id: 1, name: 'test' }]),
        mimeType: 'application/json',
      },
    ],
  }),
  callTool: vi.fn().mockResolvedValue({
    result: 'tool executed',
  }),
  setDuckDBService: vi.fn(),
  attachServer: vi.fn().mockResolvedValue(undefined),
  detachServer: vi.fn().mockResolvedValue(undefined),
  listAttachedServers: vi.fn().mockReturnValue([]),
  getAttachedServer: vi.fn().mockReturnValue(undefined),
  disconnectAll: vi.fn().mockResolvedValue(undefined),
  clearCache: vi.fn(),
  createVirtualTable: vi.fn().mockResolvedValue(undefined),
  refreshVirtualTable: vi.fn().mockResolvedValue(undefined),
}

export const Client = vi.fn(() => mockClientInstance)