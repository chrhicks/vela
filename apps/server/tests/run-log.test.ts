import { open, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { criaEvent, decodeLine, epochMs, rigId, seal, sourceId, type RigEvent } from '@vela/rig-events'
import { mountState } from '@vela/rig-testing'
import { defaultMaxFileBytes, defaultMaxFiles, openRunLog, type RunLog, type RunLogOptions } from '../src/run-log/run-log.js'

const context = { rig: rigId('test-rig'), source: sourceId('vela:cria') }

const origin = 'http://cria.test'

const logs: RunLog[] = []

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vela-run-log-'))
})

afterEach(async () => {
  await Promise.all(logs.splice(0).map(log => log.close()))
  await rm(directory, { recursive: true, force: true })
})

function openLog(options: Partial<RunLogOptions> = {}) {
  const log = openRunLog({ directory: join(directory, 'run-log'), retry: { firstMs: 5, lastMs: 20 }, onProblem: () => {}, ...options })

  logs.push(log)

  return log
}

function exchange(at: number, route = '/v2/state', padding = 0): RigEvent {
  return seal({
    ...context,
    kind: 'cria.exchange',
    at: epochMs(at),
    seenAt: epochMs(at),
    body: { origin, ms: 1, method: 'GET', route, status: 200, command: null, reply: { kind: 'answered', body: { padding: 'x'.repeat(padding) } } },
  })
}

function snapshot(sequence: number, at: number) {
  return criaEvent({ kind: 'state', at, origin, state: mountState({ sequence, generatedAt: at, mount: { at, raHours: 5.5, decDegrees: -5.4 } }) }, context)
}

async function files() {
  return (await readdir(join(directory, 'run-log')).catch(() => [])).sort()
}

async function eventsOnDisk() {
  const events: RigEvent[] = []

  for (const name of await files()) {
    for (const line of (await readFile(join(directory, 'run-log', name), 'utf8')).split('\n')) {
      if (line === '') continue
      const decoded = decodeLine(line)

      if (decoded.ok) events.push(decoded.event)
    }
  }

  return events
}

const settled = (log: RunLog) => vi.waitFor(() => expect(log.health().pendingBytes).toBe(0), { timeout: 20_000, interval: 5 })

/** While `full` is set, every file opens on a handle whose writes fail with ENOSPC, as a full disk's do. */
function disk() {
  const state = { full: true, opens: 0 }

  const openFile: NonNullable<RunLogOptions['openFile']> = (path, flags, mode) => {
    state.opens += 1

    return state.full ? open('/dev/full', 'a') : open(path, flags, mode)
  }

  return { state, openFile }
}

describe('what the run log keeps', () => {
  it('writes each event as one line a reader decodes, to one file named for the run', async () => {
    const log = openLog()
    const sent = [exchange(1_792_000_000_000), snapshot(1, 1_792_000_001_000), exchange(1_792_000_002_000, '/v2/events')]

    for (const event of sent) log.append(event)
    await settled(log)

    expect(await files()).toHaveLength(1)
    expect(await files()).toEqual([expect.stringMatching(/^run-\d{8}T\d{9}Z-00001\.jsonl$/)])
    expect(await eventsOnDisk()).toEqual(sent)
    expect(log.health()).toMatchObject({ state: 'ok', dropped: 0, lastError: null, file: (await files())[0] })
  })

  it('keeps a snapshot that differs from the one before only in observedAt', async () => {
    const log = openLog()

    log.append(snapshot(1, 1_792_000_001_000))
    log.append(snapshot(2, 1_792_000_002_000))
    await settled(log)

    const [first, second] = (await eventsOnDisk()).flatMap(event => (event.kind === 'cria.state' ? [event.body.state] : []))
    const mount = (state: typeof first) => state?.devices.find(device => device.id === 'mount')?.readings

    expect(mount(first)).toMatchObject({ rightAscensionHours: { value: 5.5, observedAt: 1_792_000_001_000 } })
    expect(mount(second)).toMatchObject({ rightAscensionHours: { value: 5.5, observedAt: 1_792_000_002_000 } })
  })

  it('starts a new file when the next write would pass the size limit, and keeps only the newest files', async () => {
    const one = Buffer.byteLength(`${JSON.stringify(exchange(1_792_000_000_000, '/v2/state', 400))}\n`)
    const log = openLog({ maxFileBytes: one * 2 + one / 2, maxFiles: 3 })

    for (let index = 0; index < 20; index += 1) {
      log.append(exchange(1_792_000_000_000 + index, '/v2/state', 400))
      await settled(log)
    }

    const names = await files()
    const sizes = await Promise.all(names.map(async name => (await stat(join(directory, 'run-log', name))).size))

    expect(names).toEqual(['00008', '00009', '00010'].map(part => expect.stringMatching(new RegExp(`-${part}\\.jsonl$`))))
    expect(sizes.every(size => size <= one * 2 + one / 2)).toBe(true)

    const kept = await eventsOnDisk()

    expect(kept.length).toBe(6)
    expect(kept.at(-1)?.at).toBe(1_792_000_000_019)
  })

  it('leaves files that are not run files alone, and a restart opens its own file', async () => {
    await mkdir(join(directory, 'run-log'))
    await writeFile(join(directory, 'run-log', 'cria-journal.jsonl'), 'x'.repeat(1_000))

    const first = openLog({ maxFiles: 1 })

    first.append(exchange(1_792_000_000_000))
    await settled(first)
    await first.close()

    const second = openLog({ maxFiles: 1, now: () => Date.now() + 5_000 })

    second.append(exchange(1_792_000_000_001))
    await settled(second)

    expect(await files()).toEqual(['cria-journal.jsonl', expect.stringMatching(/^run-/)])
    expect((await eventsOnDisk()).map(event => event.at)).toEqual([1_792_000_000_001])
  })

  it('keeps writing past the 256 MiB that stopped the journal on 2026-10-25', async () => {
    expect(defaultMaxFileBytes).toBe(256 * 1024 * 1024)

    const log = openLog({ maxFileBytes: defaultMaxFileBytes, maxFiles: defaultMaxFiles })
    const eightMiB = exchange(1_792_000_000_000, '/v2/state', 8 * 1024 * 1024)

    for (let index = 0; index < 40; index += 1) {
      log.append({ ...eightMiB, at: epochMs(1_792_000_000_000 + index) })
      await settled(log)
    }

    const health = log.health()
    const names = await files()
    const first = await stat(join(directory, 'run-log', names[0]!))

    expect(health).toMatchObject({ state: 'ok', dropped: 0, lastError: null })
    expect(health.writtenBytes).toBeGreaterThan(defaultMaxFileBytes)
    expect(names).toHaveLength(2)
    expect(first.size).toBeLessThanOrEqual(defaultMaxFileBytes)
  }, 60_000)
})

describe('a disk that fails', () => {
  it('keeps the events through a full disk, and writes them to a new file when it takes writes again', async () => {
    const problems: string[] = []
    const { state, openFile } = disk()
    const log = openLog({ openFile, onProblem: message => void problems.push(message) })

    for (let index = 0; index < 3; index += 1) log.append(exchange(1_792_000_000_000 + index))
    await vi.waitFor(() => expect(state.opens).toBeGreaterThan(2))
    expect(log.health()).toMatchObject({ state: 'retrying', lastError: { message: expect.stringContaining('ENOSPC') } })
    expect(log.health().pendingBytes).toBeGreaterThan(0)

    log.append(exchange(1_792_000_000_003))
    state.full = false
    await vi.waitFor(() => expect(log.health().state).toBe('ok'), { timeout: 5_000 })
    await settled(log)

    expect((await eventsOnDisk()).map(event => event.at)).toEqual([0, 1, 2, 3].map(offset => 1_792_000_000_000 + offset))
    expect(await files()).toHaveLength(1)
    expect(log.health()).toMatchObject({ dropped: 0, lastError: { message: expect.stringContaining('ENOSPC') } })
    expect(problems).toHaveLength(1)
  })

  it('drops past its queue bound, counts what it dropped, and records a gap once the disk recovers', async () => {
    const one = Buffer.byteLength(`${JSON.stringify(exchange(1_792_000_000_000))}\n`)
    const { state, openFile } = disk()
    const log = openLog({ openFile, maxPendingBytes: one * 3 })

    for (let index = 0; index < 8; index += 1) log.append(exchange(1_792_000_000_000 + index))
    expect(log.health().dropped).toBe(5)
    await vi.waitFor(() => expect(log.health().lastError?.message).toContain('ENOSPC'))

    state.full = false
    await vi.waitFor(() => expect(log.health().state).toBe('ok'), { timeout: 5_000 })
    await settled(log)

    const events = await eventsOnDisk()

    expect(events.filter(event => event.kind === 'cria.exchange')).toHaveLength(3)
    expect(events.find(event => event.kind === 'gap')).toMatchObject({ rig: context.rig, body: { source: context.source, reason: 'disk', dropped: 5 } })
    expect(log.health().dropped).toBe(5)
  })

  it('does not write a batch twice when the disk fails partway through it', async () => {
    let opened = 0

    const openFile: NonNullable<RunLogOptions['openFile']> = async (path, flags, mode) => {
      const handle = await open(path, flags, mode)

      opened += 1

      if (opened > 1) return handle

      let calls = 0
      const appendFile = handle.appendFile.bind(handle)

      handle.appendFile = async text => {
        calls += 1

        if (calls === 1) return appendFile(text)

        const lines = String(text).split('\n')

        await appendFile(`${lines.slice(0, 3).join('\n')}\n${lines[3]?.slice(0, 20)}`)
        throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
      }

      return handle
    }

    const log = openLog({ openFile })
    const sent = [0, 1, 2, 3, 4, 5].map(offset => exchange(1_792_000_000_000 + offset))

    for (const event of sent) log.append(event)
    await vi.waitFor(() => expect(log.health().lastError?.message).toContain('ENOSPC'))
    await settled(log)

    expect(await eventsOnDisk()).toEqual(sent)
    expect(log.health().dropped).toBe(0)
  })

  it('stays up, retrying, when the directory cannot be made', async () => {
    const blocked = join(directory, 'blocked')

    await writeFile(blocked, '')

    const log = openRunLog({ directory: join(blocked, 'run-log'), retry: { firstMs: 5, lastMs: 20 }, onProblem: () => {} })

    logs.push(log)
    expect(() => log.append(exchange(1_792_000_000_000))).not.toThrow()
    await vi.waitFor(() => expect(log.health().state).toBe('retrying'))
    expect(log.health().lastError?.message).toMatch(/ENOTDIR|EEXIST/)
  })

  it('closes within its timeout when the disk stalls, and says what it did not write', async () => {
    const problems: string[] = []
    const log = openLog({ openFile: () => new Promise(() => {}), closeTimeoutMs: 50, onProblem: message => void problems.push(message) })

    log.append(exchange(1_792_000_000_000))

    const started = performance.now()

    await log.close()
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(log.health()).toMatchObject({ state: 'closed', lastError: { message: expect.stringContaining('1 queued events were not written') } })
    expect(problems).toHaveLength(1)
  })
})

it('keeps the run log writable when its second sink throws', async () => {
  const log = openLog({ onAppend() { throw new Error('sink unavailable') } })
  const event = exchange(1000)

  expect(() => log.append(event)).not.toThrow()
  await log.close()
  expect(await eventsOnDisk()).toEqual([event])
})
