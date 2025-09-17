// Manual mock for DuckDBService
let mockImplementation = () => ({
  initialize: () => Promise.resolve(),
  executeQuery: () => Promise.resolve([]),
  executeScalar: () => Promise.resolve(null),
  getSchema: () => Promise.resolve([]),
  getTableColumns: () => Promise.resolve([]),
  createTableFromJSON: () => Promise.resolve(),
  readParquet: () => Promise.resolve(),
  readCSV: () => Promise.resolve(),
  readJSON: () => Promise.resolve(),
  exportToFile: () => Promise.resolve(),
  tableExists: () => Promise.resolve(false),
  getRowCount: () => Promise.resolve(0),
  close: () => Promise.resolve(),
  isReady: () => true,
})

export const DuckDBService: any = function () {
  return mockImplementation()
}

DuckDBService.mockImplementation = (impl: any) => {
  mockImplementation = impl
  return DuckDBService
}

export const getDuckDBService = async () => {
  const instance = new DuckDBService()
  await instance.initialize()
  return instance
}

export const createDuckDBService = () => {
  return new DuckDBService()
}
