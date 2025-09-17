// Manual mock for MCPClient
let mockImplementation = () => ({
  attachServer: () => Promise.resolve(),
  detachServer: () => Promise.resolve(),
  listResources: () => Promise.resolve([]),
  listTools: () => Promise.resolve([]),
  readResource: () => Promise.resolve(),
  callTool: () => Promise.resolve(),
  disconnectAll: () => Promise.resolve(),
  listAttachedServers: () => [],
  getAttachedServer: () => undefined,
  setDuckDBService: () => {},
})

export const MCPClient: any = function () {
  return mockImplementation()
}

MCPClient.mockImplementation = (impl: any) => {
  mockImplementation = impl
  return MCPClient
}
