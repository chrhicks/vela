import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CriaClient, CriaIdentityError, type CriaClientOptions, type CriaState } from '../src/index.js'
import { closeFixtures, reading, serverNow, ServiceFixture, token } from './fixture.js'

const clients: CriaClient[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()))
  await closeFixtures()
  vi.useRealTimers()
})

class StreamFixture extends ServiceFixture {
  override publishOperations = false
  readonly streams: ReadableStreamDefaultController<Uint8Array>[] = []
  readonly opened: RequestInit[] = []
  closed = 0
  private readonly started = performance.now()

  override client(options: Partial<CriaClientOptions> = {}): CriaClient {
    const client = super.client({
      fetch: this.streamFetch,
      eventReconnectMs: 5,
      eventMaxReconnectMs: 20,
      ...options,
    })

    clients.push(client)
    client.start()

    return client
  }

  readonly streamFetch: typeof globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).pathname !== '/v2/events') return this.fetch(input, init)
    this.paths.push('GET /v2/events')
    this.opened.push(init ?? {})

    return new Response(new ReadableStream<Uint8Array>({
      start: controller => {
        this.streams.push(controller)
        this.publish()
      },
      cancel: () => { this.closed++ },
    }), { headers: { 'content-type': 'text/event-stream' } })
  }

  override async publish(change?: (state: CriaState) => void): Promise<void> {
    this.state.sequence++
    this.state.generatedAt = serverNow + Math.floor(performance.now() - this.started)
    this.state.operations = [...this.operations.values()]
    change?.(this.state)
    this.raw(`event: state\r\ndata: ${JSON.stringify(this.state)}\r\n\r\n`)
    await delay(0)
  }

  raw(value: string): void {
    this.streams.at(-1)?.enqueue(new TextEncoder().encode(value))
  }

  disconnect(): void { this.streams.at(-1)?.close() }
}

describe('shared state stream', () => {
  it('authenticates one stream across devices and closes it without HTTP state polling', async () => {
    const service = new StreamFixture()
    const client = service.client()

    client.start()
    const [camera, mount] = await Promise.all([client.observe('camera'), client.observe('mount')])

    expect(camera.device.id).toBe('camera')
    expect(mount.device.id).toBe('mount')
    expect(service.paths).toEqual(['GET /v2/events'])
    expect(new Headers(service.opened[0]?.headers).get('authorization')).toBe(`Bearer ${token}`)
    expect(service.opened[0]?.redirect).toBe('error')
    await client.state()
    await client.state()
    expect(service.paths).toEqual(['GET /v2/events'])
    await client.close()
    expect(service.closed).toBe(1)
    await expect(client.state()).rejects.toMatchObject({ reason: 'transport' })
  })

  it('follows coalesced operation progress and completion without operation polling', async () => {
    const service = new StreamFixture()
    const client = service.client()
    const phases: string[] = []

    service.completeImmediately = false
    await client.state()

    const result = client.run('camera', {
      kind: 'capture', parameters: { exposureSeconds: 0.001, light: true },
    }, { onProgress: operation => { phases.push(operation.phase) } })

    await vi.waitFor(() => expect(service.posts).toHaveLength(1))
    service.publish()
    await vi.waitFor(() => expect(phases).toContain('exposing'))
    await delay(15)
    expect(service.paths.filter(path => path.startsWith('GET /v2/operations'))).toEqual([])
    service.finish()
    service.state.sequence += 100
    service.publish()
    expect((await result).status).toBe('succeeded')
    expect(service.paths).toEqual(['GET /v2/events', 'POST /v2/operations'])
  })

  it('waits for post-write observations across the failure domain when HTTP finishes before events', async () => {
    const service = new StreamFixture()

    service.mount.failureDomain = service.camera.failureDomain
    service.camera.fields.coolerOn = reading(false)
    const client = service.client()
    const before = await client.state()

    await client.run('camera', { kind: 'cooling', parameters: { coolerOn: true } })
    expect(client.optionalReading(before, client.device(before, 'camera'), 'coolerOn')).toBeUndefined()
    expect(client.optionalReading(before, client.device(before, 'mount'), 'connected')).toBeUndefined()
    let observed = false

    const observing = Promise.all([client.observe('camera'), client.observe('mount')]).then(result => {
      observed = true

      return result
    })

    // A newer envelope carrying the old generation cannot confirm the write either.
    await service.publish(state => { state.devices = structuredClone(before.state.devices) })
    expect(observed).toBe(false)
    service.state.devices = [service.camera, service.mount]
    service.camera.fields.coolerOn = { ...reading(true), generation: service.camera.observationGeneration }
    await service.publish()
    const [camera] = await observing

    expect(client.reading(camera.snapshot, camera.device, 'coolerOn')).toBe(true)
    expect(service.posts).toHaveLength(1)
    expect(service.paths).toEqual(['GET /v2/events', 'POST /v2/operations'])
  })

  it('wakes a waiting operation on cancellation and confirms the settled result', async () => {
    const service = new StreamFixture()
    const client = service.client()

    service.completeImmediately = false
    service.cancelImmediately = true
    await client.state()

    const result = client.run('camera', {
      kind: 'capture', parameters: { exposureSeconds: 0.001, light: true },
    })

    const rejected = expect(result).rejects.toMatchObject({ name: 'CriaCancelledError' })

    await vi.waitFor(() => expect(service.posts).toHaveLength(1))
    await client.cancelDevice('camera')
    await rejected
    expect(service.cancellations).toHaveLength(1)
    expect(service.posts).toHaveLength(1)
  })

  it('reconciles a terminal operation omitted from a lossy snapshot exactly once', async () => {
    const service = new StreamFixture()
    const client = service.client()

    service.completeImmediately = false
    await client.state()

    const result = client.run('camera', {
      kind: 'capture', parameters: { exposureSeconds: 0.001, light: true },
    })

    await vi.waitFor(() => expect(service.posts).toHaveLength(1))
    service.finish()
    service.publish(state => { state.operations = [] })
    expect((await result).status).toBe('succeeded')
    expect(service.paths.filter(path => path.startsWith('GET /v2/operations'))).toHaveLength(1)
  })

  it('does not refresh driver age from heartbeat, duplicate event, or a new envelope', async () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const service = new StreamFixture()
    const client = service.client({ dynamicMaxAgeMs: 20 })
    const first = await client.state()

    service.raw(': heartbeat\n\n')
    service.raw(`event: state\ndata: ${JSON.stringify(service.state)}\n\n`)
    vi.advanceTimersByTime(30)
    await service.publish()
    const next = await client.state()

    expect(next.receivedMonotonic).toBeGreaterThan(first.receivedMonotonic)
    expect(client.optionalReading(next, client.device(next, 'camera'), 'name')).toBeUndefined()
    expect(service.paths).toEqual(['GET /v2/events'])
  })

  it('keeps comment heartbeats separate from both observation age and event framing timeouts', async () => {
    const service = new StreamFixture()
    const client = service.client({ eventIdleTimeoutMs: 100, dynamicMaxAgeMs: 20 })
    const first = await client.state()

    for (let index = 0; index < 5; index++) {
      await delay(30)
      service.raw(': heartbeat\n\n')
    }

    const snapshot = await client.state()

    expect(snapshot.receivedMonotonic).toBe(first.receivedMonotonic)
    expect(service.streams).toHaveLength(1)
    expect(client.optionalReading(snapshot, client.device(snapshot, 'camera'), 'connected')).toBeUndefined()
    await client.close()
    expect(service.closed).toBe(1)
  })

  it('retries only the missing-operation gap when its first reconciliation read fails', async () => {
    const service = new StreamFixture()
    let reads = 0

    const client = service.client({
      operationReconcileMs: 20,
      fetch: async (input, init) => {
        if (new URL(String(input)).pathname.startsWith('/v2/operations/') && ++reads === 1)
          throw new TypeError('One reconciliation read interrupted')

        return service.streamFetch(input, init)
      },
    })

    service.completeImmediately = false
    await client.state()

    let admitted = () => {}

    const admission = new Promise<void>(resolve => { admitted = resolve })

    const result = client.run('camera', {
      kind: 'capture', parameters: { exposureSeconds: 0.001, light: true },
    }, { onProgress: admitted })

    await admission
    service.finish()
    await service.publish(state => { state.operations = [] })
    expect((await result).status).toBe('succeeded')
    expect(reads).toBe(2)
    expect(service.posts).toHaveLength(1)
  })

  it('does not allow partial frames to keep an unresponsive stream alive', async () => {
    const service = new StreamFixture()
    const client = service.client({ eventIdleTimeoutMs: 50, eventReconnectMs: 100, eventMaxReconnectMs: 100 })

    await client.state()
    service.raw(': unfinished heartbeat')
    await delay(70)
    await expect(client.state()).rejects.toMatchObject({ reason: 'transport' })
    expect(service.closed).toBe(1)
  })

  it('acquires the same completed original when its terminal result is reconciled during stream loss', async () => {
    const service = new StreamFixture()
    const client = service.client({ eventReconnectMs: 100, eventMaxReconnectMs: 100 })
    let admitted = () => {}

    const admission = new Promise<void>(resolve => { admitted = resolve })

    service.completeImmediately = false

    const running = client.run('camera', {
      kind: 'capture', parameters: { exposureSeconds: 0.001, light: true },
    }, { onProgress: admitted })

    await admission
    service.finish()
    service.disconnect()
    const operation = await running
    const reads: string[] = []
    const acquired = await client.download(operation, { onReadState: state => { reads.push(state) } })

    expect(acquired.image.id).toBe(operation.image?.id)
    expect([...acquired.frame.pixels]).toEqual([1, 2, 3, 4, 5, 6])
    expect(reads).toEqual(['retrying', 'current'])
    expect(service.posts).toHaveLength(1)
    expect(service.paths.filter(path => path === 'GET /v2/state')).toHaveLength(1)
    expect(service.paths.filter(path => path.endsWith('/original'))).toHaveLength(1)
  })

  it('normalizes malformed events and interrupts discontinuous service clocks', async () => {
    const service = new StreamFixture()
    const client = service.client({ eventReconnectMs: 100, eventMaxReconnectMs: 100 })

    await client.state()
    service.raw('event: state\ndata: {invalid JSON}\n\n')
    await vi.waitFor(async () => {
      await expect(client.state()).rejects.toMatchObject({ reason: 'invalid-response' })
    })
    await vi.waitFor(() => expect(service.streams).toHaveLength(2))
    await service.publish(state => { state.generatedAt += 60_000 })
    await expect(client.state()).rejects.toMatchObject({ reason: 'transport' })
  })

  it('marks interruption, rejects cached write facts, and reconnects without replaying commands', async () => {
    const service = new StreamFixture()
    const client = service.client({ eventReconnectMs: 100, eventMaxReconnectMs: 100 })
    const before = await client.state()

    service.disconnect()
    await vi.waitFor(async () => {
      await expect(client.state()).rejects.toMatchObject({ reason: 'transport' })
    })
    expect(client.optionalReading(before, client.device(before, 'camera'), 'connected')).toBeUndefined()
    await expect(client.run('camera', {
      kind: 'capture', parameters: { exposureSeconds: 0.001, light: true },
    })).rejects.toMatchObject({ name: 'CriaNotAdmittedError' })
    expect(service.posts).toHaveLength(0)
    await vi.waitFor(() => expect(service.streams).toHaveLength(2))
    await client.observe('camera')
    expect(client.optionalReading(before, client.device(before, 'camera'), 'connected')).toBeUndefined()
    expect(service.paths).toEqual(['GET /v2/events', 'GET /v2/events'])
  })

  it('pins binding and incarnation identity across stream reconnects', async () => {
    const service = new StreamFixture()
    const client = service.client()

    await client.state()
    service.state.instanceId = randomUUID()
    service.camera.bindingId = randomUUID()
    service.disconnect()
    await vi.waitFor(() => expect(service.streams).toHaveLength(2))
    await expect(client.run('camera', {
      kind: 'capture', parameters: { exposureSeconds: 0.001, light: true },
    })).rejects.toBeInstanceOf(CriaIdentityError)
    expect(service.posts).toHaveLength(0)
  })

  it('interrupts delayed stream data despite an unsynchronized but freshly received timestamp', async () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const service = new StreamFixture()
    const client = service.client({ eventReconnectMs: 100, eventMaxReconnectMs: 100 })
    const first = await client.state()

    vi.advanceTimersByTime(4_000)
    await service.publish(state => {
      state.generatedAt = first.state.generatedAt
      service.camera.fields.name = reading(service.camera.expectedName, state.generatedAt)
    })
    await vi.waitFor(async () => {
      await expect(client.state()).rejects.toMatchObject({ reason: 'transport' })
    })
    expect(service.posts).toHaveLength(0)
  })

  it('bounds partial events and reclaims their reader before reconnect', async () => {
    const service = new StreamFixture()
    const client = service.client({ eventReconnectMs: 100, eventMaxReconnectMs: 100 })

    await client.state()
    service.raw(`data: ${'x'.repeat(4 * 1024 * 1024)}`)
    await vi.waitFor(async () => {
      await expect(client.state()).rejects.toMatchObject({ reason: 'transport' })
    })
    expect(service.closed).toBe(1)
    await client.close()
    await delay(110)
    expect(service.streams).toHaveLength(1)
  })
})
