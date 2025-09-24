/**
 * Server authentication configuration
 * Controls which MCP servers can be attached via federation
 */

export interface ServerAuthConfig {
  /** Allow attaching to any server (DANGEROUS - only for development) */
  allowAnyServer?: boolean

  /** List of allowed server patterns (supports wildcards) */
  allowedServers?: string[]

  /** List of blocked server patterns (takes precedence over allowed) */
  blockedServers?: string[]

  /** Require HTTPS/WSS for production mode */
  requireSecureTransport?: boolean

  /** Maximum number of servers that can be attached */
  maxAttachedServers?: number
}

/**
 * Default authentication configuration
 */
export const defaultAuthConfig: ServerAuthConfig = {
  allowAnyServer: process.env.NODE_ENV === 'development',
  allowedServers: [
    // Local development servers
    'stdio://localhost*',
    'ws://localhost:*',
    'http://localhost:*',

    // Known safe MCP servers (add your trusted servers here)
    // Example: 'stdio://github-mcp-server',
    // Example: 'wss://api.example.com/mcp',
  ],
  blockedServers: [
    // Block potential malicious patterns
    'stdio://../*',
    'stdio://~/*',
    '*://0.0.0.0/*',
    '*://127.0.0.1/*', // Except localhost which is handled separately
    '*://169.254.*', // Link-local addresses
    '*://10.*', // Private network
    '*://172.16.*', // Private network
    '*://192.168.*', // Private network
  ],
  requireSecureTransport: process.env.NODE_ENV === 'production',
  maxAttachedServers: 10,
}

/**
 * Check if a server URL is allowed
 */
export function isServerAllowed(
  url: string,
  config: ServerAuthConfig = defaultAuthConfig
): { allowed: boolean; reason?: string } {
  // Development mode bypass (use with caution)
  if (config.allowAnyServer && process.env.NODE_ENV === 'development') {
    return { allowed: true }
  }

  // Check blocked servers first (takes precedence)
  if (config.blockedServers) {
    for (const pattern of config.blockedServers) {
      if (matchesPattern(url, pattern)) {
        return {
          allowed: false,
          reason: `Server URL matches blocked pattern: ${pattern}`,
        }
      }
    }
  }

  // Check if HTTPS/WSS is required
  if (config.requireSecureTransport) {
    const isSecure =
      url.startsWith('https://') || url.startsWith('wss://') || url.startsWith('stdio://') // stdio is considered secure for local
    if (!isSecure) {
      return {
        allowed: false,
        reason: 'Secure transport (HTTPS/WSS) required in production mode',
      }
    }
  }

  // Check allowed servers
  if (!config.allowedServers || config.allowedServers.length === 0) {
    return {
      allowed: false,
      reason: 'No servers are configured in the allowlist',
    }
  }

  for (const pattern of config.allowedServers) {
    if (matchesPattern(url, pattern)) {
      return { allowed: true }
    }
  }

  return {
    allowed: false,
    reason: `Server URL not in allowlist. Add '${url}' to allowedServers in configuration.`,
  }
}

/**
 * Simple pattern matching with wildcard support
 */
function matchesPattern(url: string, pattern: string): boolean {
  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
    .replace(/\*/g, '.*') // Convert * to .*

  const regex = new RegExp(`^${regexPattern}$`, 'i')
  return regex.test(url)
}

/**
 * Load auth configuration from environment or config file
 */
export function loadAuthConfig(): ServerAuthConfig {
  const config: ServerAuthConfig = { ...defaultAuthConfig }

  // Override with environment variables if present
  if (process.env.MCP_ALLOWED_SERVERS) {
    config.allowedServers = process.env.MCP_ALLOWED_SERVERS.split(',').map((s) => s.trim())
  }

  if (process.env.MCP_BLOCKED_SERVERS) {
    config.blockedServers = process.env.MCP_BLOCKED_SERVERS.split(',').map((s) => s.trim())
  }

  if (process.env.MCP_ALLOW_ANY_SERVER === 'true') {
    config.allowAnyServer = true
  }

  if (process.env.MCP_MAX_ATTACHED_SERVERS) {
    config.maxAttachedServers = parseInt(process.env.MCP_MAX_ATTACHED_SERVERS, 10)
  }

  return config
}
