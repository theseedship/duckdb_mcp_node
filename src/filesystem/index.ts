/**
 * Virtual Filesystem Module
 * Exports all components for transparent MCP resource access
 */

export { URIParser, type ParsedURI } from './URIParser.js'
export { CacheManager, type CachedResource, type CacheConfig } from './CacheManager.js'
export { FormatDetector, type DataFormat, type FormatReader } from './FormatDetector.js'
export {
  QueryPreprocessor,
  type URIReplacement,
  type TransformResult,
} from './QueryPreprocessor.js'
export {
  VirtualFilesystem,
  type VirtualFilesystemConfig,
  type ResourceResolution,
} from './VirtualFilesystem.js'
