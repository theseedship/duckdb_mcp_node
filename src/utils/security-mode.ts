export type SecurityMode = 'production' | 'development'

/**
 * Resolve MCP_SECURITY_MODE, failing fast on anything unrecognized.
 *
 * Case and surrounding whitespace are tolerated (CRLF env files, `source`d
 * files, copy-paste): "Production" and "production\r" mean production. Unset or
 * empty means development. Any other value, or the commonly misspelled variable
 * name MCP_SECURITY_MODEL, throws: a typo here would otherwise silently leave
 * every production protection off. @since v1.7.2
 */
export function resolveSecurityMode(): SecurityMode {
  const raw = process.env.MCP_SECURITY_MODE
  if (raw === undefined && process.env.MCP_SECURITY_MODEL !== undefined) {
    throw new Error(
      'MCP_SECURITY_MODEL is set but MCP_SECURITY_MODE is not: the variable is named MCP_SECURITY_MODE. Production protections would be OFF.'
    )
  }
  if (raw === undefined) return 'development'
  const mode = raw.trim().toLowerCase()
  if (mode === '' || mode === 'development') return 'development'
  if (mode === 'production') return 'production'
  throw new Error(
    `Invalid MCP_SECURITY_MODE ${JSON.stringify(raw)}: expected "production" or "development". Refusing to start with an unrecognized security mode.`
  )
}

export function isProductionSecurityMode(): boolean {
  return resolveSecurityMode() === 'production'
}
