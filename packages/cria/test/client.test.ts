import { createHash, randomUUID } from 'node:crypto'
import { EquipmentError } from '@vela/equipment'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CriaImageGoneError,
  CriaCancelledError,
  CriaIdentityError,
  CriaApiError,
  CriaOriginalVerificationError,
  CriaUncertainError,
  isTransientCriaFailure,
} from '../src/error.js'
import type { CriaCommand, CriaOperation } from '../src/schema.js'
import { closeFixtures, eventResponse, failure, json, reading, serverNow, ServiceFixture } from './fixture.js'

afterEach(closeFixtures)

const capture: CriaCommand = { kind: 'capture', parameters: { exposureSeconds: 0.001, light: true } }

function path(input: RequestInfo | URL): string {
  return new URL(input instanceof Request ? input.url : String(input)).pathname
}

describe('state and identity', () => {
  it('sends no bearer header when no token is configured', async () => {
    const service = new ServiceFixture()

    service.requireToken = false

    const client = service.client({ token: undefined })

    expect((await client.state()).state.instanceId).toBe(service.state.instanceId)
  })

  it('shares state reads without allowing one caller cancellation to abort another', async () => {
    const service = new ServiceFixture()
    let release = () => {}

    const gate = new Promise<void>(resolve => { release = resolve })

    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      await gate

      return service.fetch(input, init)
    })

    const client = service.client({ fetch })
    const signal = new AbortController()
    const first = client.state(signal.signal)
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const second = client.state()

    signal.abort()
    await rejected
    expect(fetch).toHaveBeenCalledTimes(1)
    release()
    expect((await second).state.instanceId).toBe(service.state.instanceId)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses server-relative read age, metadata age, generation and RTT instead of clock synchronization', async () => {
    const service = new ServiceFixture()
    const client = service.client()

    service.camera.fields.state = reading(0, serverNow - 8_000)
    service.camera.fields.width = reading(2, serverNow - 8_000)
    const snapshot = await client.state()
    const camera = client.device(snapshot, 'camera')

    expect(client.reading(snapshot, camera, 'connected')).toBe(true)
    expect(client.optionalReading(snapshot, camera, 'state')).toBeUndefined()
    expect(client.reading(snapshot, camera, 'width', { metadata: true })).toBe(2)
    expect(client.optionalReading({ ...snapshot, roundTripMs: 4_000 }, camera, 'connected')).toBeUndefined()
    camera.fields.width = { ...reading(2), generation: 3 }
    expect(client.optionalReading(snapshot, camera, 'width', { metadata: true })).toBeUndefined()
    camera.fields.state = { ...reading(0), readStartedAt: serverNow - 9_000 }
    expect(client.optionalReading(snapshot, camera, 'state')).toBeUndefined()
  })

  it('distinguishes temporary required measurements from unsupported or malformed facts', async () => {
    const service = new ServiceFixture()
    const client = service.client()
    const snapshot = await client.state()
    const camera = client.device(snapshot, 'camera')

    const transient = [
      { ...reading(0), status: 'error' as const },
      { ...reading(0), status: 'pending' as const },
      { ...reading(0), status: 'stale' as const },
      { ...reading(0), generation: 3 },
      reading(0, serverNow - 8_000),
    ]

    for (const field of transient) {
      camera.fields.state = field
      expect(() => client.reading(snapshot, camera, 'state')).toThrowError(expect.objectContaining({ reason: 'transport' }))
    }

    camera.fields.state = reading(0)
    camera.refreshPending = true
    expect(() => client.reading(snapshot, camera, 'state')).toThrowError(expect.objectContaining({ reason: 'transport' }))
    camera.refreshPending = false
    expect(() => client.reading({ ...snapshot, roundTripMs: 4_000 }, camera, 'state')).toThrowError(expect.objectContaining({ reason: 'transport' }))

    for (const field of [
      { ...reading(null), status: 'unsupported' as const },
      { ...reading(0), checkedAt: serverNow + 1 },
      { ...reading(0), observedAt: null },
    ]) {
      camera.fields.state = field
      expect(() => client.reading(snapshot, camera, 'state')).toThrowError(expect.objectContaining({ reason: 'invalid-response' }))
    }

    delete camera.fields.state
    expect(() => client.reading(snapshot, camera, 'state')).toThrowError(expect.objectContaining({ reason: 'invalid-response' }))
    camera.blocked = true
    expect(() => client.reading(snapshot, camera, 'state')).toThrowError(expect.objectContaining({ name: 'CriaUncertainError', reason: 'protocol-error' }))
  })

  it('starts the next workflow against a restarted Cria instead of blocking', async () => {
    const service = new ServiceFixture()
    const client = service.client()
    const before = (await client.state()).state.instanceId

    service.restart()
    await service.publish()
    await client.state()
    expect(client.commandBlockReasonFor('camera')).toBeNull()
    await client.run('camera', capture)
    expect(service.state.instanceId).not.toBe(before)
    expect(service.last?.instanceId).toBe(service.state.instanceId)
  })

  it('uses a rebound driver binding for later work', async () => {
    const service = new ServiceFixture()
    const client = service.client()

    await client.state()
    service.camera.bindingId = randomUUID()
    await service.publish()
    await client.state()
    await client.run('camera', capture)
    expect(service.last?.bindingId).toBe(service.camera.bindingId)
  })

  it('fails running work as unknown when Cria restarts under it, then runs again', async () => {
    const service = new ServiceFixture()

    service.completeImmediately = false
    const client = service.client()
    const running = client.run('camera', capture)

    const outcome = expect(running).rejects.toBeInstanceOf(CriaUncertainError)

    await vi.waitFor(() => expect(service.last).not.toBeNull())
    service.restart()
    await service.publish()
    await outcome
    expect(client.commandBlockReasonFor('camera')).toBeNull()

    service.completeImmediately = true
    await client.run('camera', capture)
    expect(service.posts).toHaveLength(2)
  })

  it('still blocks when a device no longer matches its configured identity', async () => {
    const service = new ServiceFixture()
    const client = service.client()

    await client.state()
    service.camera.expectedName = 'Some other camera'
    await service.publish()
    await expect(client.state()).rejects.toBeInstanceOf(CriaIdentityError)
    await expect(client.run('camera', capture)).rejects.toBeInstanceOf(CriaIdentityError)
    expect(service.posts).toHaveLength(0)
  })

  it('rejects malformed response fields before using a readiness flag', async () => {
    const service = new ServiceFixture()

    const client = service.client({
      fetch: async () => eventResponse({ ...service.state, devices: [{ ...service.camera, blocked: 'false' }] }),
    })

    await expect(client.run('camera', capture)).rejects.toMatchObject({ reason: 'invalid-response' })
    expect(service.posts).toHaveLength(0)
  })
})

describe('durable admission', () => {
  it('recovers an accepted operation after its HTTP acknowledgement disappears', async () => {
    const service = new ServiceFixture()
    let dropped = false

    const client = service.client({
      fetch: async (input, init) => {
        const response = await service.fetch(input, init)

        if (path(input) === '/v2/operations' && !dropped) {
          dropped = true
          throw new TypeError('Connection ended after durable admission')
        }

        return response
      },
    })

    const result = await client.run('camera', capture)

    expect(result.status).toBe('succeeded')
    expect(result.id).toBe(service.last?.id)
    expect(service.posts).toHaveLength(1)
    expect(service.operations.size).toBe(1)
    expect(service.paths.some(request => request.startsWith('GET /v2/requests/'))).toBe(true)
  })

  it('retries an unacknowledged admission using the byte-identical request and dispatches once', async () => {
    const service = new ServiceFixture()
    const attempts: string[] = []

    const client = service.client({
      fetch: async (input, init) => {
        if (path(input) === '/v2/operations') {
          attempts.push(String(init?.body))

          if (attempts.length === 1) throw new TypeError('Request never reached service')
        }

        return service.fetch(input, init)
      },
    })

    await client.run('camera', capture)
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toBe(attempts[0])
    expect(service.operations.size).toBe(1)
  })

  it('preserves an unresolved admission and blocks fresh commands, including another domain', async () => {
    const service = new ServiceFixture()
    let posts = 0

    const client = service.client({
      fetch: async (input, init) => {
        if (path(input) === '/v2/operations') {
          posts++
          throw new TypeError('Admission response lost')
        }

        if (path(input).startsWith('/v2/requests/')) return failure(503)

        return service.fetch(input, init)
      },
    })

    await expect(client.run('camera', capture)).rejects.toMatchObject({
      name: 'CriaUncertainError',
      request: { instanceId: service.state.instanceId, deviceId: 'camera', kind: 'capture' },
      operation: null,
    })
    await expect(client.run('mount', { kind: 'mount-stop', parameters: {} })).rejects.toBeInstanceOf(CriaUncertainError)
    expect(posts).toBe(1)
    expect(client.commandBlockReason).toContain('unresolved')
  })

  it('does not submit a replacement exposure when Stop arrives during unresolved admission', async () => {
    const service = new ServiceFixture()
    let release = () => {}

    const gate = new Promise<void>(resolve => { release = resolve })
    let attempts = 0

    const client = service.client({
      fetch: async (input, init) => {
        if (path(input) === '/v2/operations') {
          attempts++
          await gate
          throw new TypeError('Lost request')
        }

        return service.fetch(input, init)
      },
    })

    const running = client.run('camera', capture)
    const rejected = expect(running).rejects.toBeInstanceOf(CriaUncertainError)

    await vi.waitFor(() => expect(attempts).toBe(1))
    const stopping = client.cancelDevice('camera')
    const stopRejected = expect(stopping).rejects.toBeInstanceOf(CriaUncertainError)

    release()
    await rejected
    await stopRejected
    expect(attempts).toBe(1)
    expect(service.operations.size).toBe(0)
  })
  it('does not treat an expired durable request result as permission to dispatch again', async () => {
    const service = new ServiceFixture()
    let posts = 0

    const client = service.client({
      fetch: async (input, init) => {
        if (path(input) === '/v2/operations') {
          posts++
          throw new TypeError('Admission acknowledgement lost')
        }

        if (path(input).startsWith('/v2/requests/')) return failure(410, 'result-expired')

        return service.fetch(input, init)
      },
    })

    await expect(client.run('camera', capture)).rejects.toBeInstanceOf(CriaUncertainError)
    expect(posts).toBe(1)
    expect(client.commandBlockReason).not.toBeNull()
  })
})

describe('operation completion and cancellation', () => {
  it('identifies cancellation before admission even with a custom signal reason', async () => {
    const service = new ServiceFixture()
    let release = () => {}

    const gate = new Promise<void>(resolve => { release = resolve })

    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      await gate

      return service.fetch(input, init)
    })

    const client = service.client({ fetch })
    const abort = new AbortController()
    const running = client.run('camera', capture, { signal: abort.signal })
    const stopped = expect(running).rejects.toMatchObject({ name: 'CriaCancelledError', operation: null })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    abort.abort(new Error('User stopped'))
    await stopped
    expect(service.posts).toHaveLength(0)
    release()
    await client.state()
    expect(service.posts).toHaveLength(0)
    await expect(client.run('camera', capture, { signal: abort.signal })).rejects.toBeInstanceOf(CriaCancelledError)
    await expect(client.run('camera', capture)).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('keeps a stream interruption visible until the same operation can be observed again', async () => {
    const service = new ServiceFixture()
    const states: string[] = []
    let interrupted = false

    service.completeImmediately = false

    const client = service.client({
      fetch: async (input, init) => {
        if (interrupted && (path(input) === '/v2/events' || path(input).startsWith('/v2/operations/')))
          throw new TypeError('Temporary read failure')

        return service.fetch(input, init)
      },
    })

    const running = client.run('camera', capture, { onReadState: state => states.push(state) })

    await vi.waitFor(() => expect(service.posts).toHaveLength(1))
    interrupted = true
    service.interrupt()
    await vi.waitFor(() => expect(states).toContain('retrying'))
    service.finish()
    interrupted = false
    await running
    const changes = states.filter((state, index) => index === 0 || state !== states[index - 1])

    expect(changes).toEqual(['current', 'retrying', 'current'])
    expect(service.posts).toHaveLength(1)
  })

  it('waits for physical settlement after cancellation is accepted', async () => {
    const service = new ServiceFixture()

    service.completeImmediately = false
    const client = service.client()
    const running = client.run('camera', capture)
    const cancelled = expect(running).rejects.toBeInstanceOf(CriaCancelledError)

    await vi.waitFor(() => expect(service.last).not.toBeNull())
    let stopped = false
    const stopping = client.cancelDevice('camera').then(() => { stopped = true })

    await vi.waitFor(() => expect(service.cancellations).toHaveLength(1))
    expect(stopped).toBe(false)
    expect(service.last?.settled).toBe(false)
    service.finish('cancelled')
    await cancelled
    await stopping
    expect(stopped).toBe(true)
  })

  it('keeps a naturally completed capture after a lost cancellation response', async () => {
    const service = new ServiceFixture()
    const signal = new AbortController()

    service.completeImmediately = false

    const client = service.client({
      fetch: async (input, init) => {
        const response = await service.fetch(input, init)

        if (path(input).endsWith('/cancel')) {
          service.finish()
          throw new TypeError('Cancellation acknowledgement lost')
        }

        return response
      },
    })

    const result = await client.run('camera', capture, {
      signal: signal.signal,
      onProgress: operation => {
        if (operation.status === 'running') signal.abort()
      },
    })

    expect(result.status).toBe('succeeded')
    expect(result.image).not.toBeNull()
    expect(service.cancellations).toHaveLength(1)
    expect(service.posts).toHaveLength(1)
  })

  it('does not claim a local observation timeout cancelled equipment, or block unrelated domains', async () => {
    const service = new ServiceFixture()

    service.completeImmediately = false
    const client = service.client({ operationTimeoutMs: 10 })

    await expect(client.run('camera', capture)).rejects.toBeInstanceOf(CriaUncertainError)
    expect(service.last?.status).toBe('running')
    expect(service.cancellations).toHaveLength(0)
    expect(client.commandBlockReasonFor('camera')).toContain('unconfirmed')
    expect(client.commandBlockReasonFor('mount')).toBeNull()
    await expect(client.run('camera', capture)).rejects.toBeInstanceOf(CriaUncertainError)
    service.completeImmediately = true
    expect((await client.run('mount', { kind: 'mount-stop', parameters: {} })).status).toBe('succeeded')
  })
  it('requires settlement even for a terminal status and retains the whole failure domain', async () => {
    const service = new ServiceFixture()

    service.mount.failureDomain = service.camera.failureDomain

    const client = service.client({
      fetch: async (input, init) => {
        const response = await service.fetch(input, init)

        if (path(input) === '/v2/operations' && service.last)
          return json({ ...service.last, status: 'cancelled', settled: false, blocksDevice: true }, 202)

        return response
      },
    })

    await expect(client.run('camera', capture)).rejects.toBeInstanceOf(CriaUncertainError)
    expect(client.commandBlockReasonFor('mount')).not.toBeNull()
    await expect(client.run('mount', { kind: 'mount-stop', parameters: {} })).rejects.toBeInstanceOf(CriaUncertainError)
    expect(service.posts).toHaveLength(1)
  })
})

describe('original transfer', () => {
  it('returns the verified original as decoded pixels and sends no release or delete', async () => {
    const service = new ServiceFixture()
    const client = service.client()
    const operation = await client.run('camera', capture)
    const { frame } = await client.download(operation)

    expect(frame.width).toBe(2)
    expect(frame.height).toBe(3)
    expect(Array.from(frame.pixels)).toEqual([1, 2, 3, 4, 5, 6])
    expect(service.paths.some(request => request.startsWith('DELETE'))).toBe(false)
  })

  it('retries a transient transfer of the same original without another exposure', async () => {
    const service = new ServiceFixture()
    let downloads = 0

    const client = service.client({
      fetch: async (input, init) => {
        if (path(input).endsWith('/original') && ++downloads === 1)
          throw new TypeError('Transfer interrupted')

        return service.fetch(input, init)
      },
    })

    const operation = await client.run('camera', capture)
    const states: string[] = []
    const result = await client.download(operation, { onReadState: state => states.push(state) })

    expect(result.image.id).toBe(operation.image?.id)
    expect(downloads).toBe(2)
    expect(states).toEqual(['retrying', 'current'])
    expect(service.posts).toHaveLength(1)
  })

  it('does not retry an original with corrupt pixels', async () => {
    const service = new ServiceFixture()
    const client = service.client()
    const operation = await client.run('camera', capture)

    new DataView(service.original).setInt32(44, 99, true)
    await expect(client.download(operation)).rejects.toMatchObject({ reason: 'invalid-response' })
    expect(service.paths.filter(request => request.endsWith('/original'))).toHaveLength(1)
    expect(service.posts).toHaveLength(1)
  })

  it('checks pixel geometry independently of a valid checksum', async () => {
    const service = new ServiceFixture()
    const client = service.client()
    const operation = await client.run('camera', capture)
    const image = operation.image
    const stored = service.last?.image

    if (!image || !stored) throw new Error('Fixture capture did not retain an image')
    new DataView(service.original).setInt32(32, 3, true)
    image.sha256 = createHash('sha256').update(new Uint8Array(service.original)).digest('hex')
    stored.sha256 = image.sha256
    await expect(client.download(operation)).rejects.toMatchObject({ reason: 'invalid-response' })
  })

  it('bounds transfer retries by its own retry window', async () => {
    const service = new ServiceFixture()
    let attempts = 0

    const client = service.client({
      imageRetryMs: 25,
      pollIntervalMs: 5,
      fetch: async (input, init) => {
        if (path(input).endsWith('/original')) {
          attempts++
          throw new TypeError('Transfer interrupted')
        }

        return service.fetch(input, init)
      },
    })

    const operation = await client.run('camera', capture)

    await expect(client.download(operation)).rejects.toMatchObject({ reason: 'transport' })
    expect(attempts).toBeGreaterThan(0)
    expect(attempts).toBeLessThan(10)
    expect(service.posts).toHaveLength(1)
  })

  it('types an original that fails verification apart from an interrupted transfer', async () => {
    const service = new ServiceFixture()
    let interrupting = false

    const client = service.client({
      imageRetryMs: 25,
      pollIntervalMs: 5,
      fetch: async (input, init) => {
        if (interrupting && path(input).endsWith('/original')) throw new TypeError('Transfer interrupted')

        return service.fetch(input, init)
      },
    })

    const operation = await client.run('camera', capture)

    interrupting = true
    await expect(client.download(operation)).rejects.toMatchObject({ reason: 'transport' })
    await expect(client.download(operation)).rejects.not.toBeInstanceOf(CriaOriginalVerificationError)

    interrupting = false
    new Uint8Array(service.original)[service.original.byteLength - 1]! ^= 1
    await expect(client.download(operation)).rejects.toBeInstanceOf(CriaOriginalVerificationError)
    expect(service.posts).toHaveLength(1)
  })

  it('names transient failures once, for retries and for whoever reports them', () => {
    expect(isTransientCriaFailure(new EquipmentError('interrupted', { reason: 'transport', endpoint: '/v2/state' }))).toBe(true)
    expect(isTransientCriaFailure(new CriaApiError(503, 'unavailable', 'Unavailable', '/v2/images'))).toBe(true)
    expect(isTransientCriaFailure(new CriaApiError(429, 'download-busy', 'Busy', '/v2/images'))).toBe(true)
    expect(isTransientCriaFailure(new CriaApiError(401, 'unauthorized', 'Unauthorized', '/v2/images'))).toBe(false)
    expect(isTransientCriaFailure(new EquipmentError('invalid', { reason: 'invalid-response', endpoint: '/v2/images' }))).toBe(false)
    expect(isTransientCriaFailure(new CriaOriginalVerificationError('integrity', '/v2/images'))).toBe(false)
  })

  it('rejects cross-operation metadata and external original URLs before downloading', async () => {
    const service = new ServiceFixture()
    const client = service.client()
    const operation = await client.run('camera', capture)
    const image = operation.image

    if (!image) throw new Error('Fixture capture did not retain an image')
    const foreign: CriaOperation = { ...operation, image: { ...image, operationId: randomUUID() } }

    await expect(client.download(foreign)).rejects.toBeInstanceOf(EquipmentError)
    const external = { ...operation, image: { ...image, original: { ...image.original, url: 'http://other.fixture/original' } } }

    await expect(client.download(external)).rejects.toThrow()
    expect(service.paths.some(request => request.endsWith('/original'))).toBe(false)
  })

  it('reports a dropped image as lost without retrying or exposing again', async () => {
    const service = new ServiceFixture()
    const client = service.client()
    const operation = await client.run('camera', capture)

    service.drop(service.last!.image!.id)
    await expect(client.download(operation)).rejects.toBeInstanceOf(CriaImageGoneError)
    expect(service.posts).toHaveLength(1)
    expect(service.paths.filter(request => request.endsWith('/original'))).toHaveLength(1)
  })

  it('refuses an older protocol Cria before admitting any work', async () => {
    const service = new ServiceFixture()

    Object.assign(service.state, { protocolVersion: 3 })
    const client = service.client()

    await expect(client.run('camera', capture)).rejects.toBeInstanceOf(EquipmentError)
    expect(service.posts).toHaveLength(0)
  })
})
