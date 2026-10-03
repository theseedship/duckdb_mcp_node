import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api'
import { DuckDBService, getDuckDBService } from './service.js'

type Sandbox = 'off' | 'no-local-fs' | 'strict'
type Internals = {
  connection: DuckDBConnection | null
  instance: DuckDBInstance | null
  virtualFs?: { processQuery(sql: string): Promise<string>; destroy(): Promise<void> }
  applyEngineHardening(level: Sandbox): Promise<void>
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('DuckDBService initialization security boundary', () => {
  const services: DuckDBService[] = []
  beforeEach(() => {
    vi.stubEnv('MCP_SECURITY_MODE', undefined)
    vi.stubEnv('MCP_SANDBOX', undefined)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(services.splice(0).map((service) => service.close()))
    vi.unstubAllEnvs()
  })

  function service(sandbox: Sandbox = 'strict') {
    const result = new DuckDBService({ sandbox, memory: '128MB', threads: 1 })
    services.push(result)
    return result
  }

  it('rejects invalid selected environment policy before creating a native instance', async () => {
    vi.stubEnv('MCP_SANDBOX', 'strict-typo')
    const create = vi.spyOn(DuckDBInstance, 'create')
    const db = new DuckDBService({ memory: '128MB', threads: 1 })
    services.push(db)
    await expect(db.initialize()).rejects.toThrow(/invalid option/i)
    expect(create).not.toHaveBeenCalled()
    expect(db.isReady()).toBe(false)
  })

  it('keeps all concurrent initializers pending and rejects queries until hardening finishes', async () => {
    const db = service()
    const internal = db as unknown as Internals
    const entered = deferred()
    const release = deferred()
    const harden = internal.applyEngineHardening.bind(db)
    vi.spyOn(internal, 'applyEngineHardening').mockImplementation(async (level) => {
      entered.resolve()
      await release.promise
      await harden(level)
    })
    const first = db.initialize()
    await entered.promise
    let secondSettled = false
    const second = db.initialize().then(() => {
      secondSettled = true
    })
    try {
      await Promise.resolve()
      expect(secondSettled).toBe(false)
      expect(db.isReady()).toBe(false)
      await expect(db.executeQuery('SELECT 1')).rejects.toThrow(/not initialized/i)
      await expect(db.executeQueryWithVFS('SELECT 1')).rejects.toThrow(/not initialized/i)
    } finally {
      release.resolve()
      await Promise.all([first, second])
    }
    expect(internal.applyEngineHardening).toHaveBeenCalledTimes(1)
    expect(db.sandboxLevel).toBe('strict')
    expect(db.isReady()).toBe(true)
    expect(await db.executeQuery('SELECT 42 AS answer')).toEqual([{ answer: 42 }])
  })

  it.each([
    ['filesystem hardening', "SET disabled_filesystems='LocalFileSystem,HTTPFileSystem'"],
    ['configuration lock', 'SET lock_configuration=true'],
    ['extension autoinstall', 'SET autoinstall_known_extensions=false'],
    ['extension autoload', 'SET autoload_known_extensions=false'],
  ])(
    'disconnects after failed %s and retries with a new connection',
    async (_name, rejectedSql) => {
      const db = service('no-local-fs')
      const internal = db as unknown as Internals
      const harden = internal.applyEngineHardening.bind(db)
      let disconnected: ReturnType<typeof vi.spyOn> | undefined
      const calls: string[] = []
      vi.spyOn(internal, 'applyEngineHardening').mockImplementationOnce(async (level) => {
        const connection = internal.connection!
        const run = connection.run.bind(connection)
        disconnected = vi.spyOn(connection, 'disconnectSync')
        vi.spyOn(connection, 'run').mockImplementation(async (sql, ...args) => {
          calls.push(sql)
          if (sql === rejectedSql) throw new Error('injected hardening failure')
          return run(sql, ...args)
        })
        await harden(level)
      })
      await expect(db.initialize()).rejects.toThrow(/injected hardening failure/i)
      expect(db.isReady()).toBe(false)
      expect(db.sandboxLevel).toBe('off')
      expect(internal.connection).toBeNull()
      expect(internal.instance).toBeNull()
      expect(disconnected).toHaveBeenCalledOnce()
      expect(calls).not.toContain("SET disabled_filesystems='LocalFileSystem'")
      await expect(db.executeQuery('SELECT 1')).rejects.toThrow(/not initialized/i)
      await db.initialize()
      expect(db.isReady()).toBe(true)
      expect(db.sandboxLevel).toBe('no-local-fs')
    }
  )

  it('destroys any initialized VFS after hardening rejects', async () => {
    const db = service()
    const internal = db as unknown as Internals
    const destroy = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(internal, 'applyEngineHardening').mockImplementation(async () => {
      internal.virtualFs = { destroy, processQuery: vi.fn() }
      throw new Error('injected policy failure')
    })
    await expect(db.initialize()).rejects.toThrow(/injected policy failure/i)
    expect(destroy).toHaveBeenCalledOnce()
    expect(db.getVirtualFilesystem()).toBeUndefined()
    expect(db.isReady()).toBe(false)
  })

  it('waits for initialization before closing and clears the applied posture', async () => {
    const db = service()
    const internal = db as unknown as Internals
    const entered = deferred()
    const release = deferred()
    const harden = internal.applyEngineHardening.bind(db)
    vi.spyOn(internal, 'applyEngineHardening').mockImplementation(async (level) => {
      entered.resolve()
      await release.promise
      await harden(level)
    })
    const initialize = db.initialize()
    await entered.promise
    const close = db.close()
    release.resolve()
    await Promise.all([initialize, close])
    expect(db.isReady()).toBe(false)
    expect(db.sandboxLevel).toBe('off')
    await expect(db.executeQuery('SELECT 1')).rejects.toThrow(/not initialized/i)
  })

  it('waits for asynchronous close teardown before initializing a fresh native connection', async () => {
    const db = service()
    await db.initialize()
    const internal = db as unknown as Internals
    const originalConnection = internal.connection!
    const entered = deferred()
    const release = deferred()
    internal.virtualFs = {
      processQuery: vi.fn(),
      destroy: vi.fn(async () => {
        entered.resolve()
        await release.promise
      }),
    }
    const create = vi.spyOn(DuckDBInstance, 'create')
    const close = db.close()
    await entered.promise
    const initialize = db.initialize()
    try {
      await Promise.resolve()
      expect(create).not.toHaveBeenCalled()
      expect(db.isReady()).toBe(false)
    } finally {
      release.resolve()
      await Promise.all([close, initialize])
    }
    expect(internal.connection).not.toBe(originalConnection)
    expect(db.isReady()).toBe(true)
    expect(db.sandboxLevel).toBe('strict')
    expect(await db.executeQuery('SELECT 42 AS answer')).toEqual([{ answer: 42 }])
  })

  it('coalesces concurrent close calls while VFS destruction is pending', async () => {
    const db = service()
    await db.initialize()
    const entered = deferred()
    const release = deferred()
    const destroy = vi.fn(async () => {
      entered.resolve()
      await release.promise
    })
    ;(db as unknown as Internals).virtualFs = { processQuery: vi.fn(), destroy }
    const first = db.close()
    await entered.promise
    const second = db.close()
    try {
      await Promise.resolve()
      expect(destroy).toHaveBeenCalledOnce()
    } finally {
      release.resolve()
      await Promise.all([first, second])
    }
    expect(db.isReady()).toBe(false)
    await db.initialize()
    expect(await db.executeQuery('SELECT 9 AS answer')).toEqual([{ answer: 9 }])
  })

  it('serializes close and retry behind asynchronous cleanup of a failed initialization', async () => {
    const db = service()
    const internal = db as unknown as Internals
    const entered = deferred()
    const release = deferred()
    const destroy = vi.fn(async () => {
      entered.resolve()
      await release.promise
    })
    vi.spyOn(internal, 'applyEngineHardening').mockImplementationOnce(async () => {
      internal.virtualFs = { processQuery: vi.fn(), destroy }
      throw new Error('injected initialization failure')
    })
    const first = db.initialize().catch((error: unknown) => error)
    await entered.promise
    const create = vi.spyOn(DuckDBInstance, 'create')
    const close = db.close()
    const retry = db.initialize()
    try {
      await Promise.resolve()
      expect(create).not.toHaveBeenCalled()
      expect(db.isReady()).toBe(false)
      await expect(db.executeQuery('SELECT 1')).rejects.toThrow(/not initialized/i)
    } finally {
      release.resolve()
      await close
      await retry
    }
    expect(await first).toBeInstanceOf(Error)
    expect(destroy).toHaveBeenCalledOnce()
    expect(db.isReady()).toBe(true)
    expect(db.sandboxLevel).toBe('strict')
    expect(await db.executeQuery('SELECT 10 AS answer')).toEqual([{ answer: 10 }])
  })

  it('replaces a singleton whose constructor configuration made initialization fail', async () => {
    vi.resetModules()
    const isolated = await import('./service.js')
    await expect(
      isolated.getDuckDBService({ sandbox: 'strict', memory: 'invalid-memory-limit', threads: 1 })
    ).rejects.toThrow()
    const recovered = await isolated.getDuckDBService({
      sandbox: 'strict',
      memory: '128MB',
      threads: 1,
    })
    services.push(recovered)
    expect(recovered.isReady()).toBe(true)
    expect(recovered.sandboxLevel).toBe('strict')
    expect(await recovered.executeQuery('SELECT 7 AS answer')).toEqual([{ answer: 7 }])
  })

  it('does not let a stale singleton failure discard a newer initialized singleton', async () => {
    vi.resetModules()
    const isolated = await import('./service.js')
    let rejectFirst!: (error: Error) => void
    let rejectStale!: (error: Error) => void
    const firstFailure = new Promise<void>((_, reject) => {
      rejectFirst = reject
    })
    const staleFailure = new Promise<void>((_, reject) => {
      rejectStale = reject
    })
    const initialize = isolated.DuckDBService.prototype.initialize
    vi.spyOn(isolated.DuckDBService.prototype, 'initialize')
      .mockImplementationOnce(() => firstFailure)
      .mockImplementationOnce(() => staleFailure)
      .mockImplementation(function (this: DuckDBService) {
        return initialize.call(this)
      })
    const first = isolated
      .getDuckDBService({ sandbox: 'off', memory: '128MB', threads: 1 })
      .catch((error) => error)
    const stale = isolated.getDuckDBService().catch((error) => error)
    rejectFirst(new Error('first candidate failed'))
    expect(await first).toBeInstanceOf(Error)
    const recovered = await isolated.getDuckDBService({
      sandbox: 'strict',
      memory: '128MB',
      threads: 1,
    })
    services.push(recovered)
    rejectStale(new Error('old waiter failed later'))
    expect(await stale).toBeInstanceOf(Error)
    const current = await isolated.getDuckDBService()
    if (current !== recovered) services.push(current)
    expect(current).toBe(recovered)
    expect(current.sandboxLevel).toBe('strict')
    expect(await current.executeQuery('SELECT 8 AS answer')).toEqual([{ answer: 8 }])
  })

  it.each(['strict', 'no-local-fs'] as const)(
    'executes harmless mcp URI text without VFS preprocessing under %s',
    async (sandbox) => {
      const db = service(sandbox)
      await db.initialize()
      const processQuery = vi.fn().mockResolvedValue('SELECT 999 AS altered')
      const internal = db as unknown as Internals
      internal.virtualFs = { processQuery, destroy: vi.fn() }
      const run = vi.spyOn(internal.connection!, 'run')
      expect(await db.executeQueryWithVFS("SELECT 'mcp://trusted/example' AS content")).toEqual([
        { content: 'mcp://trusted/example' },
      ])
      expect(
        await db.executeQueryWithVFS('SELECT 3 AS answer /* mcp://trusted/example */')
      ).toEqual([{ answer: 3 }])
      expect(await db.executeQueryWithVFS('SELECT 4 AS answer -- mcp://trusted/example\n')).toEqual(
        [{ answer: 4 }]
      )
      await expect(
        db.executeQueryWithVFS("SELECT * FROM read_csv('mcp://trusted/data.csv')")
      ).rejects.toThrow()
      expect(run).toHaveBeenCalledWith("SELECT * FROM read_csv('mcp://trusted/data.csv')")
      expect(processQuery).not.toHaveBeenCalled()
    }
  )

  it('does not expose a failed or pending singleton on subsequent access', async () => {
    const entered = deferred()
    const release = deferred()
    const prototype = DuckDBService.prototype as unknown as Internals
    const harden = prototype.applyEngineHardening
    const spy = vi
      .spyOn(prototype, 'applyEngineHardening')
      .mockRejectedValueOnce(new Error('injected singleton failure'))
      .mockImplementationOnce(async function (this: DuckDBService, level) {
        entered.resolve()
        await release.promise
        await harden.call(this, level)
      })
    await expect(
      getDuckDBService({ sandbox: 'strict', memory: '128MB', threads: 1 })
    ).rejects.toThrow(/injected singleton failure/i)
    const first = getDuckDBService({ sandbox: 'strict', memory: '128MB', threads: 1 })
    await entered.promise
    let secondSettled = false
    const second = getDuckDBService().then((result) => {
      secondSettled = true
      return result
    })
    try {
      await Promise.resolve()
      expect(secondSettled).toBe(false)
    } finally {
      release.resolve()
    }
    const [one, two] = await Promise.all([first, second])
    services.push(one)
    expect(one).toBe(two)
    expect(one.isReady()).toBe(true)
    expect(one.sandboxLevel).toBe('strict')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('skips host-side VFS preprocessing under an active sandbox', async () => {
    const db = service()
    await db.initialize()
    const processQuery = vi.fn().mockResolvedValue('SELECT 1')
    ;(db as unknown as Internals).virtualFs = { processQuery, destroy: vi.fn() }
    await expect(db.executeQueryWithVFS("SELECT * FROM 'mcp://trusted/data.csv'")).rejects.toThrow()
    await expect(db.executeQueryWithVFS('/* before statement */ LOAD httpfs')).rejects.toThrow(
      /Operation LOAD.*blocked/i
    )
    expect(processQuery).not.toHaveBeenCalled()
    expect(await db.executeQueryWithVFS('SELECT 1')).toEqual([{ '1': 1 }])
    expect(processQuery).not.toHaveBeenCalled()
  })
})

describe('DuckDBService statement policy lexical boundaries', () => {
  let db: DuckDBService
  beforeEach(async () => {
    db = new DuckDBService({ sandbox: 'strict', memory: '128MB', threads: 1 })
    await db.initialize()
  })
  afterEach(async () => {
    await db.close()
  })

  it.each([
    "SELECT 'load' AS content",
    'SELECT 1 /* ATTACH */',
    'SELECT 1 AS "install"',
    "SELECT 'quote''; LOAD httpfs' AS content",
    'SELECT $$ATTACH; LOAD$$ AS content',
    'SELECT $tag$INSTALL; LOAD$tag$ AS content',
    String.raw`SELECT E'quote\'; LOAD httpfs' AS content`,
    '/* INSTALL /* LOAD */ ATTACH */ SELECT 1; -- LOAD\n SELECT 2',
  ])('allows harmless SQL: %s', async (sql) => {
    await expect(db.executeQuery(sql)).resolves.toHaveLength(1)
  })

  it.each([
    '/* leading */ LOAD httpfs',
    'FORCE /* trusted-looking comment */ INSTALL httpfs',
    'SELECT 1; -- comment\n INSTALL httpfs',
    'SELECT 1; -- comment\r LOAD httpfs',
    "SELECT $$; LOAD$$; /* nested /* comment */ */ ATTACH 'x.db' AS x",
    "SELECT 'quote''; ATTACH'; LOAD httpfs",
  ])('blocks leading unsafe statements: %s', async (sql) => {
    await expect(db.executeQuery(sql)).rejects.toThrow(/Operation (LOAD|INSTALL|ATTACH).*blocked/i)
  })
})
