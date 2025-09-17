// Manual mock for ResourceMapper
let mockImplementation = () => ({
  mapResource: () => Promise.resolve(),
  refreshResource: () => Promise.resolve(),
  unmapResource: () => Promise.resolve(),
  getMappedResource: () => undefined,
  listMappedResources: () => [],
})

export const ResourceMapper: any = function () {
  return mockImplementation()
}

ResourceMapper.mockImplementation = (impl: any) => {
  mockImplementation = impl
  return ResourceMapper
}
