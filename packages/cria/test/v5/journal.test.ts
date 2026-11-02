import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCriaConnection } from '../../src/connection.js'
import { createCriaEquipment } from '../../src/equipment.js'
import type { JournalSink } from '../../src/v5/journal.js'
import { FakeCria } from './fake-cria.js'

const token = 'test-only-token-for-the-in-memory-fixture'

const bindings = [
  { providerDeviceId: 'camera', id: 'camera', kind: 'camera', expectedName: 'Fake CCD' },
  { providerDeviceId: 'mount', id: 'mount', kind: 'mount', expectedName: 'ZWO AM5' },
] as const

let cria: FakeCria

const closers: Array<() => Promise<void>> = []

beforeEach(async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 3) })
  cria = new FakeCria(token)
})

afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
  cria.close()
  vi.useRealTimers()
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

describe('what the client reports of one exposure', () => {
  it('reports the request with its reply, the image check, and every state snapshot whole with its arrival time', async () => {
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

    expect(states.length).toBeGreaterThan(2)
    expect(states.map(state => state.at)).toEqual(states.map(state => state.at).sort((a, b) => a - b))
    expect(states.every(state => state.origin === cria.origin)).toBe(true)
    expect(Object.keys(states[0]!.state.devices.find(device => device.id === 'camera')!.readings)).toContain('temperatureC')
    expect(states.some(state => state.state.operations.length > 0)).toBe(true)
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

describe('what the client reports of a retried download and of closing', () => {
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

describe('a sink that fails', () => {
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
})
