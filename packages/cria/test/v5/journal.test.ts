import { execFileSync } from 'node:child_process'
import { mkdtemp, open as actualOpen, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCriaConnection } from '../../src/connection.js'
import { createCriaEquipment } from '../../src/equipment.js'
import { openJournalFile, type JournalSink } from '../../src/v5/journal.js'
import { FakeCria } from './fake-cria.js'

const token = 'test-only-token-for-the-in-memory-fixture'

const bindings = [
  { providerDeviceId: 'camera', id: 'camera', kind: 'camera', expectedName: 'Fake CCD' },
  { providerDeviceId: 'mount', id: 'mount', kind: 'mount', expectedName: 'ZWO AM5' },
] as const

let cria: FakeCria

let directory: string

const closers: Array<() => Promise<void>> = []

beforeEach(async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 3) })
  cria = new FakeCria(token)
  directory = await mkdtemp(join(tmpdir(), 'vela-cria-journal-'))
})

afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
  cria.close()
  vi.useRealTimers()
  await rm(directory, { recursive: true, force: true })
})

async function open(journal: JournalSink, fetch: typeof globalThis.fetch = cria.fetch) {
  const connection = createCriaConnection({ origin: cria.origin, token, fetch, journal })
  const equipment = createCriaEquipment(connection, bindings)

  closers.push(() => connection.close())
  connection.start()
  await vi.advanceTimersByTimeAsync(10)

  return equipment
}

async function exposeOnce(equipment: Awaited<ReturnType<typeof open>>, seconds = 1) {
  const captured = equipment.acquisition.capture({ cameraId: 'camera', exposureSeconds: seconds })

  await vi.advanceTimersByTimeAsync(seconds * 1_000 + 1_000)

  return captured
}

function memory() {
  const entries: Array<Parameters<JournalSink['record']>[0]> = []

  return { entries, sink: { record: entry => void entries.push(entry) } satisfies JournalSink }
}

describe('what the journal keeps of one exposure', () => {
  it('records the request with its reply, the image check, and each state as changes with arrival times', async () => {
    const { entries, sink } = memory()
    const equipment = await open(sink)

    await exposeOnce(equipment)

    const exchange = entries.find(entry => entry.kind === 'exchange' && entry.route === '/v2/operations')
    const submitted = JSON.parse(cria.received.find(received => received.route === 'submit')!.body!)

    expect(exchange).toMatchObject({
      origin: cria.origin,
      method: 'POST',
      status: 202,
      command: { requestId: submitted.requestId, deviceId: 'camera', kind: 'capture', parameters: { exposureSeconds: 1 } },
      reply: { kind: 'answered', body: { requestId: submitted.requestId, state: 'running' } },
    })

    const image = entries.flatMap(entry => (entry.kind === 'image' ? [entry] : []))[0]
    const download = entries.find(entry => entry.kind === 'exchange' && entry.route.endsWith('/original'))

    expect(image).toMatchObject({ verdict: 'intact', bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(download).toMatchObject({ status: 200, reply: { kind: 'answered', body: { bytes: image!.bytes } } })

    const states = entries.flatMap(entry => (entry.kind === 'state' ? [entry] : []))

    expect(states[0]).toMatchObject({ baseline: true })
    expect(Object.keys(states[0]!.changed)).toContain('device/camera/readings.temperatureC')
    expect(states.slice(1).every(state => !state.baseline)).toBe(true)
    expect(states.length).toBeGreaterThan(2)
    expect(states.map(state => state.at)).toEqual(states.map(state => state.at).sort((a, b) => a - b))
    expect(new Set(states.slice(1).flatMap(state => Object.keys(state.changed)).filter(key => key.startsWith('device/')))).toEqual(new Set(['device/camera/availability']))
    expect(states.flatMap(state => Object.keys(state.changed)).some(key => key.startsWith('operation/'))).toBe(true)
    expect(entries.find(entry => entry.kind === 'stream')).toMatchObject({ event: 'opened' })
  })

  it('never holds the token or the image bytes', async () => {
    const { entries, sink } = memory()
    const equipment = await open(sink)

    await exposeOnce(equipment)

    const route = entries.flatMap(entry => (entry.kind === 'exchange' && entry.route.endsWith('/original') ? [entry.route] : []))[0]!
    const original = await cria.fetch(`${cria.origin}${route}`, { headers: { authorization: `Bearer ${token}` } })
    const bytes = Buffer.from(await original.arrayBuffer())
    const written = JSON.stringify(entries)

    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(written).not.toContain(token)
    expect(written).not.toContain(bytes.toString('base64'))
    expect(written).not.toContain(bytes.toString('hex'))
    expect(written).not.toMatch(/authorization|bearer/i)
  })
})

describe('what the journal keeps of a retried download and of closing', () => {
  it('keeps the verdict and the own start time of every download attempt', async () => {
    const { entries, sink } = memory()
    let damaged = false

    const equipment = await open(sink, async (input, init) => {
      const response = await cria.fetch(input, init)

      if (damaged || !new Request(input, init).url.endsWith('/original')) return response
      damaged = true

      return new Response(new Uint8Array((await response.arrayBuffer()).byteLength), { status: 200 })
    })

    await exposeOnce(equipment)

    expect(entries.flatMap(entry => (entry.kind === 'image' ? [entry.verdict] : []))).toEqual(['damaged', 'intact'])

    const downloads = entries.flatMap(entry => (entry.kind === 'exchange' && entry.route.endsWith('/original') ? [entry] : []))

    expect(downloads).toHaveLength(2)
    expect(downloads[1]!.at).toBeGreaterThan(downloads[0]!.at)
    expect(downloads[1]!.ms).toBeLessThan(500)
  })

  it('records the end of the stream when the connection closes', async () => {
    const { entries, sink } = memory()
    const connection = createCriaConnection({ origin: cria.origin, token, fetch: cria.fetch, journal: sink })

    connection.start()
    await vi.advanceTimersByTimeAsync(10)
    await connection.close()

    expect(entries.filter(entry => entry.kind === 'stream').map(entry => entry.event)).toEqual(['opened', 'ended'])
  })
})

describe('a journal that fails or stalls', () => {
  it('drops a sink whose promise rejects instead of letting it reach the process', async () => {
    const calls = vi.fn()

    const equipment = await open({
      async record(entry) {
        calls(entry.kind)
        throw new Error('async sink failed')
      },
    })

    const frame = await exposeOnce(equipment)

    expect(frame).toMatchObject({ width: 4, height: 3 })
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('counts what the file already holds toward its size limit across restarts', async () => {
    const path = join(directory, 'journal.jsonl')
    const onError = vi.fn()

    await writeFile(path, 'x'.repeat(100))
    const journal = openJournalFile(path, { maxFileBytes: 150, onError })

    journal.record({ kind: 'stream', at: 1, event: 'opened', message: null, origin: cria.origin })
    await journal.close()

    expect((await readFile(path, 'utf8')).length).toBe(100)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('leaves the exposure and the stream as they are when the journal throws', async () => {
    const equipment = await open({
      record() {
        throw new Error('journal exploded')
      },
    })

    const frame = await exposeOnce(equipment)

    expect(frame).toMatchObject({ width: 4, height: 3, color: { kind: 'mono' } })
    expect(cria.received.filter(received => received.route === 'submit')).toHaveLength(1)
  })

  it('turns itself off once, and captures as before, when its file cannot be written', async () => {
    const blocked = join(directory, 'blocked')

    await writeFile(blocked, '')
    const onError = vi.fn()
    const journal = openJournalFile(join(blocked, 'journal.jsonl'), { onError })
    const equipment = await open(journal)
    const frame = await exposeOnce(equipment)

    await journal.close()

    expect(frame).toMatchObject({ width: 4, height: 3 })
    expect(onError).toHaveBeenCalledTimes(1)
  })

  describe('a disk that stalls', () => {
    const entry = { kind: 'stream', at: 0, event: 'opened', message: null, origin: 'test' } as const

    /** The first open hangs, as one on a dead disk does, until `wake` lets it through. */
    function stalledDisk() {
      const path = join(directory, 'woken.jsonl')
      let reached = false
      let release = async () => {}

      let first = true

      const openFile: typeof actualOpen = (...args) => {
        if (!first) return actualOpen(...args)

        first = false

        return new Promise(resolve => {
          reached = true
          release = async () => resolve(await actualOpen(path, 'a'))
        })
      }

      closers.push(() => release())

      const stalled = () => vi.waitFor(() => expect(reached).toBe(true))

      return {
        path,
        openFile,
        stalled,
        async wake() {
          await stalled()
          await release()
        },
      }
    }

    it('stops queueing at its byte bound while the disk stalls, and the exposure still completes', async () => {
      const { openFile } = stalledDisk()
      const onError = vi.fn()
      const journal = openJournalFile(join(directory, 'stalled.jsonl'), { maxPendingBytes: 8 * 1024, openFile, onError })

      closers.push(() => journal.close())

      const equipment = await open(journal)
      const frame = await exposeOnce(equipment, 30)

      expect(frame).toMatchObject({ width: 4, height: 3 })
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0]![0].message).toContain('fell behind')
      expect(cria.received.filter(received => received.route === 'submit')).toHaveLength(1)
    })

    it('gives up on a write the disk will not take, after its close timeout, and says so once', async () => {
      const { openFile } = stalledDisk()
      const onError = vi.fn()
      const journal = openJournalFile(join(directory, 'stalled.jsonl'), { closeTimeoutMs: 100, openFile, onError })
      let closed = false

      journal.record(entry)
      const closing = journal.close().then(() => void (closed = true))

      await vi.advanceTimersByTimeAsync(99)
      expect(closed).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await closing

      expect(closed).toBe(true)
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0]![0].message).toContain('stalled')
    })

    it('still closes within its timeout after the journal turned itself off behind a stalled write', async () => {
      const { openFile } = stalledDisk()
      const onError = vi.fn()
      const journal = openJournalFile(join(directory, 'stalled.jsonl'), { maxPendingBytes: 200, closeTimeoutMs: 100, openFile, onError })

      journal.record(entry)

      for (let index = 0; index < 4; index += 1) journal.record(entry)

      await vi.advanceTimersByTimeAsync(100)
      await journal.close()

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0]![0].message).toContain('fell behind')
    })

    it('does not write a queued line after the backlog latch even if the disk wakes later', async () => {
      const { path, openFile, stalled, wake } = stalledDisk()
      const onError = vi.fn()
      const journal = openJournalFile(join(directory, 'stalled.jsonl'), { maxPendingBytes: 200, openFile, onError })

      journal.record(entry)
      await stalled()

      for (let index = 0; index < 4; index += 1) journal.record(entry)

      expect(onError.mock.calls[0]![0].message).toContain('fell behind')
      await wake()
      await journal.close()

      expect(await readFile(path, 'utf8')).toBe('')
    })

    it('does not write the stalled line if the disk wakes after close', async () => {
      const { path, openFile, wake } = stalledDisk()
      const journal = openJournalFile(join(directory, 'stalled.jsonl'), { closeTimeoutMs: 20, openFile, onError: () => {} })

      journal.record(entry)
      const closing = journal.close()

      await vi.advanceTimersByTimeAsync(20)
      await closing
      await wake()
      await journal.close()

      expect(await readFile(path, 'utf8')).toBe('')
    })

    it('turns itself off at once, holding no thread, when its file is a FIFO nobody reads', async () => {
      vi.useRealTimers()
      const fifo = join(directory, 'unread.jsonl')

      execFileSync('mkfifo', [fifo])
      const onError = vi.fn()
      const journal = openJournalFile(fifo, { onError })

      journal.record(entry)
      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
      await journal.close()

      expect(onError.mock.calls[0]![0].message).toContain('ENXIO')
    })

    it('still flushes everything it was given when the disk keeps up', async () => {
      const path = join(directory, 'journal.jsonl')
      const journal = openJournalFile(path)

      journal.record(entry)
      journal.record({ ...entry, event: 'ended' })
      await journal.close()
      journal.record(entry)

      expect((await readFile(path, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line).event)).toEqual(['opened', 'ended'])
    })
  })

  it('writes JSON lines to its file and stops at its size limit', async () => {
    const path = join(directory, 'journal.jsonl')
    const onError = vi.fn()
    const journal = openJournalFile(path, { maxFileBytes: 4_000, onError })
    const entry = { kind: 'stream', at: 0, event: 'opened', message: null, origin: 'test' } as const

    journal.record(entry)
    await vi.waitFor(async () => expect((await readFile(path, 'utf8')).length).toBeGreaterThan(0))

    for (let index = 0; index < 100; index += 1) journal.record(entry)

    await journal.close()

    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n')

    expect(lines.every(line => JSON.parse(line).kind)).toBe(true)
    expect(Buffer.byteLength(lines.join('\n'))).toBeLessThanOrEqual(4_000)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]![0].message).toContain('size limit')
  })
})
