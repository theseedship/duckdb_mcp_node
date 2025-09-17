#!/usr/bin/env node

import { execSync, spawn } from 'child_process'
import net from 'net'

/**
 * Port Management Utility
 * Handles port cleanup, process killing, and port availability checks
 */

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
}

/**
 * Check if a port is in use
 */
async function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true)
      } else {
        resolve(false)
      }
    })

    server.once('listening', () => {
      server.close()
      resolve(false)
    })

    server.listen(port, '127.0.0.1')
  })
}

/**
 * Get process ID using a specific port
 */
function getProcessOnPort(port) {
  try {
    // Try lsof first (most reliable on Unix systems)
    const result = execSync(`lsof -ti :${port} 2>/dev/null || true`, {
      encoding: 'utf-8',
    }).trim()

    if (result) {
      return result.split('\n')[0] // Return first PID if multiple
    }

    // Fallback to netstat/ss if lsof doesn't work
    try {
      const netstatResult = execSync(
        `ss -tulpn 2>/dev/null | grep ':${port}' | grep -oP 'pid=\\K[0-9]+' || true`,
        { encoding: 'utf-8' }
      ).trim()

      if (netstatResult) {
        return netstatResult
      }
    } catch {}

    return null
  } catch {
    return null
  }
}

/**
 * Kill process on a specific port
 */
async function killPort(port, forceful = false) {
  const pid = getProcessOnPort(port)

  if (!pid) {
    console.log(`${COLORS.green}✅ Port ${port} is already free${COLORS.reset}`)
    return true
  }

  console.log(`${COLORS.yellow}🔍 Found process ${pid} on port ${port}${COLORS.reset}`)

  try {
    // Try graceful shutdown first
    process.kill(pid, 'SIGTERM')
    console.log(`${COLORS.blue}📤 Sent SIGTERM to process ${pid}${COLORS.reset}`)

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Check if process is still running
    try {
      process.kill(pid, 0) // Check if process exists

      // Still running, use forceful kill if requested
      if (forceful) {
        process.kill(pid, 'SIGKILL')
        console.log(`${COLORS.red}💀 Force killed process ${pid}${COLORS.reset}`)
      } else {
        console.log(
          `${COLORS.yellow}⚠️  Process ${pid} still running. Use --force to kill forcefully${COLORS.reset}`
        )
        return false
      }
    } catch {
      // Process no longer exists, success
    }

    console.log(`${COLORS.green}✅ Successfully freed port ${port}${COLORS.reset}`)
    return true
  } catch (error) {
    console.error(`${COLORS.red}❌ Failed to kill process ${pid}: ${error.message}${COLORS.reset}`)
    return false
  }
}

/**
 * Kill multiple ports
 */
async function killPorts(ports, forceful = false) {
  console.log(`${COLORS.magenta}🧹 Cleaning up ports: ${ports.join(', ')}${COLORS.reset}\n`)

  const results = []
  for (const port of ports) {
    console.log(`${COLORS.blue}━━━ Processing port ${port} ━━━${COLORS.reset}`)
    const success = await killPort(port, forceful)
    results.push({ port, success })
    console.log()
  }

  return results
}

/**
 * Wait for a port to become available
 */
async function waitForPort(port, timeout = 5000) {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    if (!(await isPortInUse(port))) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return false
}

/**
 * Clean up common MCP-related ports
 */
async function cleanupMCPPorts() {
  const MCP_PORTS = {
    6274: 'MCP Inspector UI',
    6277: 'MCP Inspector Proxy',
    3001: 'HTTP Test Server',
    8080: 'WebSocket/HTTP Test Server',
    8081: 'WebSocket Alternative',
    9999: 'TCP Test Server',
  }

  console.log(`${COLORS.magenta}🔧 MCP Port Cleanup Utility${COLORS.reset}`)
  console.log(`${COLORS.blue}════════════════════════════${COLORS.reset}\n`)

  for (const [port, description] of Object.entries(MCP_PORTS)) {
    const inUse = await isPortInUse(port)
    if (inUse) {
      console.log(`${COLORS.red}❌ Port ${port} (${description}) is in use${COLORS.reset}`)
      const pid = getProcessOnPort(port)
      if (pid) {
        console.log(`   Process ID: ${pid}`)
      }
    } else {
      console.log(`${COLORS.green}✅ Port ${port} (${description}) is free${COLORS.reset}`)
    }
  }
}

/**
 * Main CLI interface
 */
async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === 'help' || command === '--help') {
    console.log(`
${COLORS.magenta}Port Manager - MCP Development Utility${COLORS.reset}

${COLORS.yellow}Usage:${COLORS.reset}
  node scripts/port-manager.js <command> [options]

${COLORS.yellow}Commands:${COLORS.reset}
  check <port>          Check if a port is in use
  kill <port>           Kill process on a specific port
  kill-all              Kill all common MCP ports
  status                Show status of all MCP ports
  wait <port>           Wait for a port to become available

${COLORS.yellow}Options:${COLORS.reset}
  --force, -f           Force kill processes (SIGKILL)
  --timeout <ms>        Timeout for wait command (default: 5000)

${COLORS.yellow}Examples:${COLORS.reset}
  node scripts/port-manager.js status
  node scripts/port-manager.js kill 6277
  node scripts/port-manager.js kill-all --force
  node scripts/port-manager.js wait 8080 --timeout 10000

${COLORS.yellow}Common MCP Ports:${COLORS.reset}
  6277  - MCP Inspector Proxy Server
  3001  - HTTP Test Server
  8080  - WebSocket/HTTP Test Server
  8081  - WebSocket Alternative Server
  9999  - TCP Test Server
    `)
    return
  }

  const forceful = args.includes('--force') || args.includes('-f')

  switch (command) {
    case 'check': {
      const port = parseInt(args[1])
      if (!port) {
        console.error(`${COLORS.red}❌ Please specify a port number${COLORS.reset}`)
        process.exit(1)
      }

      const inUse = await isPortInUse(port)
      if (inUse) {
        const pid = getProcessOnPort(port)
        console.log(`${COLORS.red}❌ Port ${port} is in use${COLORS.reset}`)
        if (pid) {
          console.log(`   Process ID: ${pid}`)
        }
        process.exit(1)
      } else {
        console.log(`${COLORS.green}✅ Port ${port} is free${COLORS.reset}`)
      }
      break
    }

    case 'kill': {
      const port = parseInt(args[1])
      if (!port) {
        console.error(`${COLORS.red}❌ Please specify a port number${COLORS.reset}`)
        process.exit(1)
      }

      const success = await killPort(port, forceful)
      process.exit(success ? 0 : 1)
      break
    }

    case 'kill-all': {
      const ports = [6274, 6277, 3001, 8080, 8081, 9999]
      const results = await killPorts(ports, forceful)
      const allSuccess = results.every((r) => r.success)

      console.log(`${COLORS.blue}════════ Summary ════════${COLORS.reset}`)
      results.forEach(({ port, success }) => {
        console.log(`Port ${port}: ${success ? '✅ Freed' : '❌ Failed'}`)
      })

      process.exit(allSuccess ? 0 : 1)
      break
    }

    case 'status': {
      await cleanupMCPPorts()
      break
    }

    case 'wait': {
      const port = parseInt(args[1])
      if (!port) {
        console.error(`${COLORS.red}❌ Please specify a port number${COLORS.reset}`)
        process.exit(1)
      }

      const timeoutIndex = args.indexOf('--timeout')
      const timeout =
        timeoutIndex !== -1 && args[timeoutIndex + 1] ? parseInt(args[timeoutIndex + 1]) : 5000

      console.log(
        `${COLORS.blue}⏳ Waiting for port ${port} to become available (timeout: ${timeout}ms)${COLORS.reset}`
      )

      const available = await waitForPort(port, timeout)
      if (available) {
        console.log(`${COLORS.green}✅ Port ${port} is now available${COLORS.reset}`)
      } else {
        console.log(`${COLORS.red}❌ Timeout: Port ${port} is still in use${COLORS.reset}`)
        process.exit(1)
      }
      break
    }

    default:
      console.error(`${COLORS.red}❌ Unknown command: ${command}${COLORS.reset}`)
      console.log(`Run 'node scripts/port-manager.js help' for usage information`)
      process.exit(1)
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`${COLORS.red}❌ Fatal error: ${error.message}${COLORS.reset}`)
    process.exit(1)
  })
}

export { isPortInUse, killPort, killPorts, waitForPort, getProcessOnPort }
