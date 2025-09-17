import { MCPClient } from '../client/MCPClient.js'
import { MCPConnectionPool } from '../federation/ConnectionPool.js'
import { HTTPTransport } from '../protocol/http-transport.js'
import { WebSocketTransport } from '../protocol/websocket-transport.js'
import { TCPTransport } from '../protocol/tcp-transport.js'
import { execSync } from 'child_process'

/**
 * Connection Reset Utility
 * Provides methods to forcefully reset all connections and clean up resources
 */

export interface ConnectionInfo {
  type: 'http' | 'websocket' | 'tcp' | 'stdio'
  host?: string
  port?: number
  status: 'connected' | 'disconnected' | 'error'
  error?: string
}

export class ConnectionReset {
  private activeClients: Set<MCPClient> = new Set()
  private activePools: Set<MCPConnectionPool> = new Set()
  private activeTransports: Set<any> = new Set()

  constructor() {}

  /**
   * Register a client for tracking
   */
  registerClient(client: MCPClient): void {
    this.activeClients.add(client)
  }

  /**
   * Register a connection pool for tracking
   */
  registerPool(pool: MCPConnectionPool): void {
    this.activePools.add(pool)
  }

  /**
   * Register a transport for tracking
   */
  registerTransport(transport: HTTPTransport | WebSocketTransport | TCPTransport): void {
    this.activeTransports.add(transport)
  }

  /**
   * Reset all MCP clients
   */
  async resetClients(): Promise<number> {
    let count = 0

    for (const client of this.activeClients) {
      try {
        await client.disconnectAll()
        count++
      } catch (error) {
        console.warn(`Failed to disconnect client: ${error}`)
      }
    }

    this.activeClients.clear()
    return count
  }

  /**
   * Reset all connection pools
   */
  async resetPools(): Promise<number> {
    let count = 0

    for (const pool of this.activePools) {
      try {
        await pool.close()
        count++
      } catch (error) {
        console.warn(`Failed to close pool: ${error}`)
      }
    }

    this.activePools.clear()
    return count
  }

  /**
   * Reset all transports
   */
  async resetTransports(): Promise<number> {
    let count = 0

    for (const transport of this.activeTransports) {
      try {
        if ('disconnect' in transport && typeof transport.disconnect === 'function') {
          await transport.disconnect()
        } else if ('close' in transport && typeof transport.close === 'function') {
          await transport.close()
        }
        count++
      } catch (error) {
        console.warn(`Failed to disconnect transport: ${error}`)
      }
    }

    this.activeTransports.clear()
    return count
  }

  /**
   * Reset everything
   */
  async resetAll(): Promise<{
    clients: number
    pools: number
    transports: number
  }> {
    const results = {
      clients: await this.resetClients(),
      pools: await this.resetPools(),
      transports: await this.resetTransports(),
    }

    // Force garbage collection if available
    if (globalThis.gc) {
      globalThis.gc()
    }

    return results
  }

  /**
   * Force kill processes on specific ports
   */
  async killPortProcesses(ports: number[]): Promise<void> {
    for (const port of ports) {
      try {
        // Get process using the port
        const pid = execSync(`lsof -ti :${port} 2>/dev/null || true`, {
          encoding: 'utf-8',
        }).trim()

        if (pid) {
          // Kill the process
          process.kill(parseInt(pid), 'SIGKILL')
          console.info(`Killed process ${pid} on port ${port}`)
        }
      } catch {
        // Ignore errors, port might not be in use
      }
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    activeClients: number
    activePools: number
    activeTransports: number
  } {
    return {
      activeClients: this.activeClients.size,
      activePools: this.activePools.size,
      activeTransports: this.activeTransports.size,
    }
  }

  /**
   * Clear all registrations without disconnecting
   * (use when connections are already dead)
   */
  clearAll(): void {
    this.activeClients.clear()
    this.activePools.clear()
    this.activeTransports.clear()
  }
}

// Global singleton instance
let globalReset: ConnectionReset | null = null

/**
 * Get the global connection reset instance
 */
export function getConnectionReset(): ConnectionReset {
  if (!globalReset) {
    globalReset = new ConnectionReset()
  }
  return globalReset
}

/**
 * Quick reset function for all connections
 */
export async function resetAllConnections(): Promise<void> {
  const reset = getConnectionReset()
  const results = await reset.resetAll()

  console.info(`🔄 Connection Reset Complete:`)
  console.info(`   - Clients reset: ${results.clients}`)
  console.info(`   - Pools reset: ${results.pools}`)
  console.info(`   - Transports reset: ${results.transports}`)
}

/**
 * Emergency reset - kills everything forcefully
 */
export async function emergencyReset(): Promise<void> {
  const reset = getConnectionReset()

  // Common MCP ports
  const ports = [6277, 3001, 8080, 8081, 9999]

  console.info('🚨 Emergency Connection Reset')

  // Kill port processes
  await reset.killPortProcesses(ports)

  // Clear all registrations
  reset.clearAll()

  console.info('✅ Emergency reset complete')
}
