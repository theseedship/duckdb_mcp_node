/**
 * Format Detector for Virtual Filesystem
 * Detects data format from extension, content-type, or content inspection
 */

/**
 * Supported data formats
 */
export type DataFormat =
  | 'csv'
  | 'json'
  | 'parquet'
  | 'arrow'
  | 'excel'
  | 'text'
  | 'binary'
  | 'unknown'

/**
 * DuckDB reader function for each format
 */
export interface FormatReader {
  format: DataFormat
  readerFunction: string
  requiresQuotes: boolean
  supportsGlob: boolean
}

/**
 * Magic numbers for format detection
 */
const MAGIC_NUMBERS: Array<{ format: DataFormat; bytes: number[]; offset?: number }> = [
  // Parquet: "PAR1" at beginning and end
  { format: 'parquet', bytes: [0x50, 0x41, 0x52, 0x31], offset: 0 },
  // Arrow/Feather: "ARROW1" or "FEA1"
  { format: 'arrow', bytes: [0x41, 0x52, 0x52, 0x4f, 0x57, 0x31], offset: 0 },
  { format: 'arrow', bytes: [0x46, 0x45, 0x41, 0x31], offset: 0 },
  // Excel (ZIP archive with specific structure)
  { format: 'excel', bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 },
  // JSON: Starts with { or [
  { format: 'json', bytes: [0x7b], offset: 0 }, // {
  { format: 'json', bytes: [0x5b], offset: 0 }, // [
]

/**
 * Detects data format from various sources
 */
export class FormatDetector {
  private static readonly EXTENSION_MAP: Record<string, DataFormat> = {
    // CSV formats
    csv: 'csv',
    tsv: 'csv',
    txt: 'csv', // Often CSV
    dat: 'csv', // Often CSV

    // JSON formats
    json: 'json',
    jsonl: 'json',
    ndjson: 'json',

    // Parquet
    parquet: 'parquet',
    pq: 'parquet',

    // Arrow/Feather
    arrow: 'arrow',
    feather: 'arrow',
    ipc: 'arrow',

    // Excel
    xlsx: 'excel',
    xls: 'excel',
    xlsm: 'excel',
    xlsb: 'excel',
  }

  private static readonly CONTENT_TYPE_MAP: Record<string, DataFormat> = {
    'text/csv': 'csv',
    'application/csv': 'csv',
    'text/plain': 'csv', // Often CSV
    'text/tab-separated-values': 'csv',

    'application/json': 'json',
    'application/x-ndjson': 'json',
    'application/jsonlines': 'json',

    'application/parquet': 'parquet',
    'application/x-parquet': 'parquet',

    'application/arrow': 'arrow',
    'application/x-arrow': 'arrow',
    'application/feather': 'arrow',

    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
    'application/vnd.ms-excel': 'excel',
  }

  /**
   * Detect format from file extension
   * @param filename The filename or path
   * @returns Detected format or 'unknown'
   */
  static fromExtension(filename: string): DataFormat {
    const lastDot = filename.lastIndexOf('.')
    if (lastDot === -1 || lastDot === filename.length - 1) {
      return 'unknown'
    }

    const extension = filename.slice(lastDot + 1).toLowerCase()
    return this.EXTENSION_MAP[extension] || 'unknown'
  }

  /**
   * Detect format from MIME content-type
   * @param contentType The MIME content-type
   * @returns Detected format or 'unknown'
   */
  static fromContentType(contentType: string): DataFormat {
    // Remove charset and other parameters
    const baseType = contentType.split(';')[0].trim().toLowerCase()
    return this.CONTENT_TYPE_MAP[baseType] || 'unknown'
  }

  /**
   * Detect format from content inspection (magic numbers)
   * @param content Buffer or first bytes of content
   * @returns Detected format or 'unknown'
   */
  static fromContent(content: Buffer | Uint8Array): DataFormat {
    const bytes = content instanceof Buffer ? content : Buffer.from(content)

    // Check magic numbers
    for (const magic of MAGIC_NUMBERS) {
      const offset = magic.offset || 0
      if (bytes.length < offset + magic.bytes.length) continue

      let matches = true
      for (let i = 0; i < magic.bytes.length; i++) {
        if (bytes[offset + i] !== magic.bytes[i]) {
          matches = false
          break
        }
      }

      if (matches) {
        return magic.format
      }
    }

    // Check if it's likely CSV by looking for delimiters
    const text = bytes.toString('utf-8', 0, Math.min(1000, bytes.length))
    if (this.looksLikeCSV(text)) {
      return 'csv'
    }

    // Check if it's JSON by trying to parse
    if (this.looksLikeJSON(text)) {
      return 'json'
    }

    return 'unknown'
  }

  /**
   * Detect format using all available information
   * @param options Detection options
   * @returns Detected format with confidence
   */
  static detect(options: {
    filename?: string
    contentType?: string
    content?: Buffer | Uint8Array
  }): { format: DataFormat; confidence: number } {
    const formats: Array<{ format: DataFormat; confidence: number }> = []

    // Check extension (high confidence)
    if (options.filename) {
      const format = this.fromExtension(options.filename)
      if (format !== 'unknown') {
        formats.push({ format, confidence: 0.8 })
      }
    }

    // Check content-type (medium confidence)
    if (options.contentType) {
      const format = this.fromContentType(options.contentType)
      if (format !== 'unknown') {
        formats.push({ format, confidence: 0.7 })
      }
    }

    // Check content (highest confidence)
    if (options.content) {
      const format = this.fromContent(options.content)
      if (format !== 'unknown') {
        formats.push({ format, confidence: 0.9 })
      }
    }

    // Return highest confidence match
    if (formats.length === 0) {
      return { format: 'unknown', confidence: 0 }
    }

    formats.sort((a, b) => b.confidence - a.confidence)
    return formats[0]
  }

  /**
   * Get DuckDB reader function for format
   * @param format The data format
   * @returns Reader function details
   */
  static getReader(format: DataFormat): FormatReader {
    switch (format) {
      case 'csv':
        return {
          format: 'csv',
          readerFunction: 'read_csv_auto',
          requiresQuotes: true,
          supportsGlob: true,
        }

      case 'json':
        return {
          format: 'json',
          readerFunction: 'read_json_auto',
          requiresQuotes: true,
          supportsGlob: true,
        }

      case 'parquet':
        return {
          format: 'parquet',
          readerFunction: 'read_parquet',
          requiresQuotes: true,
          supportsGlob: true,
        }

      case 'arrow':
        return {
          format: 'arrow',
          readerFunction: 'read_arrow',
          requiresQuotes: true,
          supportsGlob: false,
        }

      case 'excel':
        return {
          format: 'excel',
          readerFunction: 'read_excel',
          requiresQuotes: true,
          supportsGlob: false,
        }

      default:
        // Try CSV as fallback
        return {
          format: 'text',
          readerFunction: 'read_csv_auto',
          requiresQuotes: true,
          supportsGlob: true,
        }
    }
  }

  /**
   * Build DuckDB query for reading a file
   * @param path The file path
   * @param format The data format
   * @returns SQL fragment for reading the file
   */
  static buildReadQuery(path: string, format: DataFormat): string {
    const reader = this.getReader(format)

    // Escape single quotes in path
    const escapedPath = path.replace(/'/g, "''")

    return `${reader.readerFunction}('${escapedPath}')`
  }

  /**
   * Check if text looks like CSV
   */
  private static looksLikeCSV(text: string): boolean {
    const lines = text.split('\n').slice(0, 5)
    if (lines.length < 2) return false

    // Check for common delimiters
    const delimiters = [',', '\t', '|', ';']

    for (const delimiter of delimiters) {
      const counts = lines.map((line) => line.split(delimiter).length)

      // Check if all lines have same number of fields
      if (counts.length > 1 && counts.every((c) => c === counts[0] && c > 1)) {
        return true
      }
    }

    return false
  }

  /**
   * Check if text looks like JSON
   */
  private static looksLikeJSON(text: string): boolean {
    const trimmed = text.trim()

    // Check for JSON object or array start
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return false
    }

    // Try to parse
    try {
      // Only parse first chunk to avoid performance issues
      const toParse = trimmed.slice(0, 1000)

      // Add closing brackets if truncated
      let testString = toParse
      if (toParse.length === 1000) {
        if (trimmed.startsWith('{')) {
          testString = toParse + '}'
        } else if (trimmed.startsWith('[')) {
          testString = toParse + ']'
        }
      }

      JSON.parse(testString)
      return true
    } catch {
      // Check for JSONL format (newline-delimited JSON)
      const firstLine = trimmed.split('\n')[0]
      try {
        JSON.parse(firstLine)
        return true
      } catch {
        return false
      }
    }
  }

  /**
   * Get MIME type for format
   * @param format The data format
   * @returns MIME content-type
   */
  static getMimeType(format: DataFormat): string {
    switch (format) {
      case 'csv':
        return 'text/csv'
      case 'json':
        return 'application/json'
      case 'parquet':
        return 'application/parquet'
      case 'arrow':
        return 'application/arrow'
      case 'excel':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      case 'text':
        return 'text/plain'
      case 'binary':
        return 'application/octet-stream'
      default:
        return 'application/octet-stream'
    }
  }

  /**
   * Get file extension for format
   * @param format The data format
   * @returns Recommended file extension
   */
  static getExtension(format: DataFormat): string {
    switch (format) {
      case 'csv':
        return 'csv'
      case 'json':
        return 'json'
      case 'parquet':
        return 'parquet'
      case 'arrow':
        return 'arrow'
      case 'excel':
        return 'xlsx'
      case 'text':
        return 'txt'
      case 'binary':
        return 'bin'
      default:
        return 'data'
    }
  }
}
