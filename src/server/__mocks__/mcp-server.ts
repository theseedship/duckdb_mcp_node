// Manual mock for DuckDBMCPServer
let mockImplementation = () => ({
  start: () => Promise.resolve(),
  stop: () => Promise.resolve(),
})

export const DuckDBMCPServer: any = function () {
  return mockImplementation()
}

DuckDBMCPServer.mockImplementation = (impl: any) => {
  mockImplementation = impl
  return DuckDBMCPServer
}
