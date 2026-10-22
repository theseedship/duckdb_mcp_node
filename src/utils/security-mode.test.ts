import { afterEach, describe, expect, it, vi } from 'vitest'
import { isProductionSecurityMode, resolveSecurityMode } from './security-mode.js'

describe('resolveSecurityMode', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each(['production', 'Production', 'PRODUCTION', ' production ', 'production\r\n'])(
    'accepts %j as production',
    (value) => {
      vi.stubEnv('MCP_SECURITY_MODE', value)
      expect(resolveSecurityMode()).toBe('production')
      expect(isProductionSecurityMode()).toBe(true)
    }
  )

  it.each([undefined, '', 'development', 'Development', ' development\r'])(
    'treats %j as development',
    (value) => {
      vi.stubEnv('MCP_SECURITY_MODE', value)
      expect(resolveSecurityMode()).toBe('development')
      expect(isProductionSecurityMode()).toBe(false)
    }
  )

  it.each(['prod', 'true', '1', 'staging', 'production​', 'produciton'])(
    'rejects the unrecognized value %j instead of silently disabling protection',
    (value) => {
      vi.stubEnv('MCP_SECURITY_MODE', value)
      expect(() => resolveSecurityMode()).toThrow(/Invalid MCP_SECURITY_MODE/)
    }
  )

  it('rejects the misspelled variable MCP_SECURITY_MODEL when MCP_SECURITY_MODE is unset', () => {
    vi.stubEnv('MCP_SECURITY_MODE', undefined)
    vi.stubEnv('MCP_SECURITY_MODEL', 'production')
    expect(() => resolveSecurityMode()).toThrow(/MCP_SECURITY_MODEL/)
  })
})
