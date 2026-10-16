import { createHash, randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import { Device, ErrorBody, Operation, State, type ErrorCode } from '@cria/wire'
import { imageBytesPixels } from '@vela/equipment/image-bytes'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCria } from './fake-cria.js'

let cria: FakeCria

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 3) })
  cria = new FakeCria()
})

afterEach(() => {
  cria.close()
  vi.useRealTimers()
})

const slewTo = { rightAscensionDegrees: 120, declinationDegrees: 10, coordinateSystem: 'topocentric' }

const notStill = { kind: 'uncertain', reason: 'stop-not-confirmed', message: 'The mount did not stand still' } as const

interface Sent {
  readonly instanceId: string
  readonly requestId: string
  readonly deviceId: string
  readonly bindingId: string
  readonly expectedName: string
  readonly kind: string
  readonly parameters: Readonly<Record<string, number | boolean | string>>
}

function request(deviceId: string, kind: string, parameters: Sent['parameters'], requestId = `${kind}-1`): Sent {
  return {
    instanceId: cria.instanceId,
    requestId,
    deviceId,
    bindingId: cria.bindingOf(deviceId),
    expectedName: cria.nameOf(deviceId),
    kind,
    parameters,
  }
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

async function send(method: string, path: string, body?: string): Promise<Response> {
  return cria.fetch(`${cria.origin}${path}`, body === undefined ? { method } : { method, body })
}

async function read<S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, response: Response): Promise<S['Type']> {
  return Schema.decodeUnknownSync(schema)(await response.json())
}

async function refusal(response: Response): Promise<{ readonly status: number; readonly code: ErrorCode }> {
  return { status: response.status, code: (await read(ErrorBody, response)).error.code }
}

async function submit(sent: Sent): Promise<Response> {
  return send('POST', '/v2/operations', JSON.stringify(sent))
}

async function admitted(sent: Sent): Promise<Operation> {
  const response = await submit(sent)

  expect(response.status).toBe(202)

  return read(Operation, response)
}

async function operation(id: string): Promise<Operation> {
  return read(Operation, await send('GET', `/v2/operations/${id}`))
}

async function lookup(requestId: string, instanceId: string = cria.instanceId): Promise<Response> {
  return send('GET', `/v2/requests/${instanceId}/${requestId}`)
}

async function cancel(id: string): Promise<Response> {
  return send('POST', `/v2/operations/${id}/cancel`)
}

async function device(id: string): Promise<Device> {
  const state = await read(State, await send('GET', '/v2/state'))
  const found = state.devices.find(candidate => candidate.id === id)

  if (!found) throw new Error(`No device ${id} in the state`)

  return found
}

async function recover(deviceId: string, bindingId: string = cria.bindingOf(deviceId)): Promise<Response> {
  const body = { instanceId: cria.instanceId, bindingId, externalRecoveryConfirmed: true, note: 'Chris checked the rig' }

  return send('POST', `/v2/devices/${deviceId}/recover`, JSON.stringify(body))
}

async function subscribe(): Promise<State[]> {
  const response = await send('GET', '/v2/events')
  const states: State[] = []
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''

  if (!reader) throw new Error('The event stream has no body')

  void (async () => {
    for (;;) {
      const { value, done } = await reader.read()

      if (done) return
      buffer += value

      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const data = buffer.slice(0, end).split('\n').find(line => line.startsWith('data: '))

        buffer = buffer.slice(end + 2)

        if (data) states.push(Schema.decodeUnknownSync(State)(JSON.parse(data.slice('data: '.length))))
      }
    }
  })().catch(() => undefined)
  await advance(0)

  return states
}

describe('the snapshot cadence', () => {
  it('sends a snapshot at once, then one a second, and coalesces changes into one within 250 ms', async () => {
    const start = Date.now()
    const states = await subscribe()

    await advance(3_000)

    expect(states.map(state => [state.sequence, state.generatedAt - start])).toEqual([
      [1, 0],
      [2, 1_000],
      [3, 2_000],
      [4, 3_000],
    ])

    await advance(400)
    await admitted(request('camera', 'cooling', { setpointC: -10 }))
    await advance(1_100)

    expect(states.slice(4).map(state => [state.generatedAt - start, state.operations.map(open => open.state)])).toEqual([
      [3_500, ['settled']],
      [4_500, ['settled']],
    ])
  })
})

describe('admission', () => {
  it('answers a repeated request ID with the same operation, whatever its instance, and refuses changed content', async () => {
    const first = await admitted(request('mount', 'mount-slew', slewTo))
    const again = await admitted(request('mount', 'mount-slew', { coordinateSystem: 'topocentric', declinationDegrees: 10, rightAscensionDegrees: 120 }))
    const changed = await submit(request('mount', 'mount-slew', { ...slewTo, rightAscensionDegrees: 121 }))
    const otherInstance = await admitted({ ...request('mount', 'mount-slew', slewTo), instanceId: randomUUID() })

    expect([again.id, otherInstance.id]).toEqual([first.id, first.id])
    expect(await refusal(changed)).toEqual({ status: 409, code: 'request-conflict' })
  })

  it('refuses in the SPEC order: instance, device, binding and name, kind, commands, held, busy', async () => {
    const capture = request('camera', 'capture', { exposureSeconds: 5, light: true })
    const halt = { kind: 'mount-stop', parameters: {} }

    cria.durationMs['mount-stop'] = 10_000
    cria.durationMs['focuser-move'] = 10_000
    cria.settle((await admitted(request('mount', 'mount-slew', slewTo))).id, notStill)
    await admitted(request('mount', 'mount-stop', {}))
    await admitted(request('focuser', 'focuser-move', { position: 20_100, minPosition: 15_500, maxPosition: 38_000 }))

    const commandsOn = [
      { ...capture, instanceId: randomUUID(), deviceId: 'nowhere' },
      { ...capture, deviceId: 'nowhere', bindingId: randomUUID() },
      { ...capture, bindingId: randomUUID(), ...halt },
      { ...capture, expectedName: 'Another CCD', ...halt },
      request('mount', 'mount-slew', slewTo, 'held-and-busy'),
      request('focuser', 'focuser-move', { position: 20_200, minPosition: 15_500, maxPosition: 38_000 }, 'busy'),
    ]

    const answers = []

    for (const sent of commandsOn) answers.push(await refusal(await submit(sent)))
    cria.commandsEnabled = false
    answers.push(await refusal(await submit({ ...capture, ...halt })))
    answers.push(await refusal(await submit(capture)))

    expect(answers).toEqual([
      { status: 409, code: 'instance-changed' },
      { status: 400, code: 'request-error' },
      { status: 409, code: 'binding-changed' },
      { status: 409, code: 'binding-changed' },
      { status: 409, code: 'device-blocked' },
      { status: 409, code: 'device-busy' },
      { status: 400, code: 'request-error' },
      { status: 403, code: 'commands-disabled' },
    ])
  })
})

describe('lookup', () => {
  it('finds an admitted request by instance and request ID; another instance or a refused request is not found and can be sent again', async () => {
    const slew = await admitted(request('mount', 'mount-slew', slewTo, 'slew-7'))

    cria.durationMs['focuser-move'] = 10_000
    await admitted(request('focuser', 'focuser-move', { position: 20_100, minPosition: 15_500, maxPosition: 38_000 }))
    await submit(request('focuser', 'focuser-move', { position: 20_200, minPosition: 15_500, maxPosition: 38_000 }, 'refused-busy'))

    expect((await read(Operation, await lookup('slew-7'))).id).toBe(slew.id)
    expect(await refusal(await lookup('slew-7', randomUUID()))).toEqual({ status: 404, code: 'not-found' })
    expect(await refusal(await lookup('refused-busy'))).toEqual({ status: 404, code: 'not-found' })

    await advance(10_000)
    expect(await admitted(request('focuser', 'focuser-move', { position: 20_200, minPosition: 15_500, maxPosition: 38_000 }, 'refused-busy'))).toMatchObject({
      requestId: 'refused-busy',
      state: 'running',
    })
  })
})

describe('cancel', () => {
  it('answers with the operation as it is, and the capture stops stopMs later', async () => {
    cria.stopMs = 2_000
    const capture = await admitted(request('camera', 'capture', { exposureSeconds: 60, light: true }))
    const answer = await cancel(capture.id)

    expect([answer.status, (await read(Operation, answer)).state]).toEqual([202, 'running'])

    await advance(1_999)
    expect((await operation(capture.id)).state).toBe('running')

    await advance(1)
    expect(await operation(capture.id)).toMatchObject({ state: 'settled', outcome: { kind: 'stopped' } })
    expect((await cancel(capture.id)).status).toBe(202)
    expect(await refusal(await cancel(randomUUID()))).toEqual({ status: 404, code: 'not-found' })
  })

  it('confirms a capture that ends before its stop would, with its image', async () => {
    cria.stopMs = 5_000
    const capture = await admitted(request('camera', 'capture', { exposureSeconds: 3, light: true }))

    await advance(1_000)
    await cancel(capture.id)
    await advance(2_000)

    expect(await operation(capture.id)).toMatchObject({
      state: 'settled',
      outcome: { kind: 'confirmed', value: { image: { operationId: capture.id, exposureSeconds: 3 } } },
    })
  })
})

describe('pruning', () => {
  it('answers 410 result-expired for a pruned operation on get, cancel, lookup and its request ID', async () => {
    const sent = request('camera', 'cooling', { setpointC: -10 }, 'cooling-pruned')
    const cooling = await admitted(sent)

    await advance(0)
    cria.expire(cooling.id)

    const answers = [
      await send('GET', `/v2/operations/${cooling.id}`),
      await cancel(cooling.id),
      await lookup('cooling-pruned'),
      await submit(sent),
    ]

    expect(await Promise.all(answers.map(refusal))).toEqual(Array(4).fill({ status: 410, code: 'result-expired' }))
  })
})

describe('halts', () => {
  it('admits a halt on a held domain and runs it to confirmed', async () => {
    cria.settle((await admitted(request('mount', 'mount-slew', slewTo))).id, notStill)
    const stop = await admitted(request('mount', 'mount-stop', {}))

    expect(stop.state).toBe('running')

    await advance(0)
    expect(await operation(stop.id)).toMatchObject({ state: 'settled', outcome: { kind: 'confirmed' } })
  })

  it('queues a halt behind a running slew, stops the slew, then runs the halt', async () => {
    cria.durationMs['mount-slew'] = 30_000
    cria.stopMs = 2_000
    const slew = await admitted(request('mount', 'mount-slew', slewTo))
    const stop = await admitted(request('mount', 'mount-stop', {}))

    expect(stop.state).toBe('waiting')

    await advance(2_000)
    expect(await operation(slew.id)).toMatchObject({ state: 'settled', outcome: { kind: 'stopped' } })
    expect((await operation(stop.id)).state).toBe('running')

    await advance(1_000)
    expect(await operation(stop.id)).toMatchObject({ state: 'settled', outcome: { kind: 'confirmed' } })
  })
})

describe('quarantine', () => {
  it('holds the domain from an uncertain ending until a recovery, through a confirmed stop', async () => {
    const settledAt = Date.now()

    cria.settle((await admitted(request('mount', 'mount-slew', slewTo))).id, notStill)
    await admitted(request('mount', 'mount-stop', {}))
    await advance(0)

    expect(await device('mount')).toMatchObject({
      quarantine: { held: true, reason: 'The mount did not stand still', since: settledAt },
      availability: { ready: false, reason: 'blocked' },
    })
    expect(await refusal(await submit(request('mount', 'mount-slew', slewTo, 'slew-2')))).toEqual({ status: 409, code: 'device-blocked' })
    expect((await device('camera')).quarantine).toEqual({ held: false })
  })
})

describe('recover', () => {
  it('releases a held domain under a new binding, and the uncertain operation carries the recovery', async () => {
    const before = cria.bindingOf('mount')
    const slew = await admitted(request('mount', 'mount-slew', slewTo))

    cria.settle(slew.id, notStill)
    const answer = await recover('mount')
    const recovered = await read(Device, answer)

    expect(answer.status).toBe(200)
    expect(recovered.bindingId).toBe(cria.bindingOf('mount'))
    expect(recovered.bindingId).not.toBe(before)
    expect(recovered.quarantine).toEqual({ held: false })
    expect(await operation(slew.id)).toMatchObject({ recovery: { at: Date.now(), note: 'Chris checked the rig' } })
    expect(await refusal(await recover('mount', before))).toEqual({ status: 409, code: 'binding-changed' })
  })

  it('rotates the binding of a domain that is not held, and refuses while an operation is open', async () => {
    const before = cria.bindingOf('camera')
    const answer = await recover('camera')

    expect([answer.status, (await read(Device, answer)).bindingId === before]).toEqual([200, false])

    await admitted(request('camera', 'capture', { exposureSeconds: 60, light: true }))
    expect(await refusal(await recover('camera'))).toEqual({ status: 409, code: 'device-busy' })
  })
})

describe('afterOperation', () => {
  it('names a settled operation only after the devices are read again', async () => {
    await advance(200)
    const cooling = await admitted(request('camera', 'cooling', { setpointC: -10 }))

    await advance(0)
    expect(await device('camera')).toMatchObject({ afterOperation: null, availability: { ready: false, reason: 'refreshing' } })

    await advance(800)
    expect(await device('camera')).toMatchObject({ afterOperation: cooling.id, availability: { ready: true } })
  })
})

describe('restart', () => {
  it('is a new instance with new bindings that remembers nothing, and it ends open streams', async () => {
    const states = await subscribe()
    const earlier = { instanceId: cria.instanceId, bindingId: cria.bindingOf('camera') }
    const capture = await admitted(request('camera', 'capture', { exposureSeconds: 60, light: true }))

    await advance(0)
    const streamed = states.length

    cria.restart()
    await advance(2_000)

    expect([cria.instanceId === earlier.instanceId, cria.bindingOf('camera') === earlier.bindingId]).toEqual([false, false])
    expect(states).toHaveLength(streamed)
    expect(await refusal(await send('GET', `/v2/operations/${capture.id}`))).toEqual({ status: 404, code: 'not-found' })
    expect(await refusal(await lookup('capture-1', earlier.instanceId))).toEqual({ status: 404, code: 'not-found' })

    const stale = { ...request('camera', 'capture', { exposureSeconds: 1, light: true }), ...earlier }

    expect(await refusal(await submit(stale))).toEqual({ status: 409, code: 'instance-changed' })
  })
})

describe('images', () => {
  it('serves a captured original as ImageBytes until Cria drops it, then answers 410', async () => {
    const capture = await admitted(request('camera', 'capture', { exposureSeconds: 1, light: true }))

    await advance(1_000)
    const settled = await operation(capture.id)
    const image = settled.state === 'settled' && settled.outcome.kind === 'confirmed' ? settled.outcome.value.image : null

    if (!image) throw new Error('The capture did not confirm with an image')
    const original = await send('GET', image.original.url)
    const bytes = await original.arrayBuffer()
    const sha256 = createHash('sha256').update(new Uint8Array(bytes)).digest('hex')

    expect([original.status, original.headers.get('content-length'), original.headers.get('etag')]).toEqual([200, '92', `"${sha256}"`])
    expect([image.sha256, image.original.bytes]).toEqual([sha256, 92])
    expect([...imageBytesPixels(bytes, image.width, image.height)]).toEqual([
      1_000, 1_003, 1_006, 1_009,
      1_001, 1_004, 1_007, 1_010,
      1_002, 1_005, 1_008, 1_011,
    ])

    cria.dropImage(image.id)
    expect(await refusal(await send('GET', image.original.url))).toEqual({ status: 410, code: 'image-gone' })
    expect(await refusal(await send('GET', '/v2/images/not-an-image-id/original'))).toEqual({ status: 404, code: 'not-found' })
  })
})

describe('faults', () => {
  it('applies a request whose reply it drops: a lookup finds it and a resend gets the same operation', async () => {
    const slew = request('mount', 'mount-slew', slewTo, 'slew-lost')

    cria.dropReply('submit')
    await expect(submit(slew)).rejects.toThrow('the reply was lost')
    const found = await read(Operation, await lookup('slew-lost'))

    expect((await admitted(slew)).id).toBe(found.id)
    expect(cria.received.map(received => received.route)).toEqual(['submit', 'lookup', 'submit'])
  })

  it('admits a delayed request when it lands, after its caller gave up', async () => {
    const caller = new AbortController()
    const sent = request('mount', 'mount-slew', slewTo, 'slew-late')

    cria.delay('submit', 2_000)
    const reply = cria.fetch(`${cria.origin}/v2/operations`, { method: 'POST', body: JSON.stringify(sent), signal: caller.signal })
    const abandoned = expect(reply).rejects.toMatchObject({ name: 'AbortError' })

    await advance(500)
    caller.abort()
    await abandoned
    expect(await refusal(await lookup('slew-late'))).toEqual({ status: 404, code: 'not-found' })

    await advance(1_500)
    expect(await read(Operation, await lookup('slew-late'))).toMatchObject({ kind: 'mount-slew', requestId: 'slew-late' })
  })

  it('fails the caller at once when a delayed request also loses its reply, and the request still lands', async () => {
    cria.delay('submit', 2_000)
    cria.dropReply('submit')

    await expect(submit(request('mount', 'mount-slew', slewTo, 'slew-gone'))).rejects.toThrow('the reply was lost')
    expect(await refusal(await lookup('slew-gone'))).toEqual({ status: 404, code: 'not-found' })

    await advance(2_000)
    expect(await read(Operation, await lookup('slew-gone'))).toMatchObject({ requestId: 'slew-gone' })
  })

  it('loses a delayed request that would land after a restart or during a partition', async () => {
    cria.delay('submit', 2_000)
    const beforeRestart = submit(request('mount', 'mount-slew', slewTo, 'slew-restarted'))
    const restarted = expect(beforeRestart).rejects.toThrow('the connection was lost')

    await advance(500)
    cria.restart()
    await advance(1_500)
    await restarted

    cria.delay('submit', 2_000)
    const partitioned = submit(request('mount', 'mount-slew', slewTo, 'slew-partitioned'))
    const lost = expect(partitioned).rejects.toThrow('the connection was lost')

    await advance(500)
    cria.reachable = false
    await advance(1_500)
    await lost
    cria.reachable = true
    expect((await Promise.all([lookup('slew-restarted'), lookup('slew-partitioned')].map(async answer => refusal(await answer))))).toEqual([
      { status: 404, code: 'not-found' },
      { status: 404, code: 'not-found' },
    ])
  })

  it('rejects a request whose signal already aborted, and ends an event stream when its caller aborts', async () => {
    const caller = new AbortController()
    const events = await cria.fetch(`${cria.origin}/v2/events`, { signal: caller.signal })
    const reader = events.body?.getReader()

    if (!reader) throw new Error('The event stream has no body')
    expect((await reader.read()).done).toBe(false)

    const next = reader.read()

    caller.abort()
    await expect(next).rejects.toMatchObject({ name: 'AbortError' })
    await expect(cria.fetch(`${cria.origin}/v2/state`, { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(cria.received.map(received => received.route)).toEqual(['events'])
  })

  it('refuses a request that lands after a recovery with binding-changed, and never admits it', async () => {
    cria.delay('submit', 2_000)
    const late = submit(request('mount', 'mount-slew', slewTo, 'slew-fenced'))

    await advance(500)
    expect((await recover('mount')).status).toBe(200)

    await advance(1_500)
    expect(await refusal(await late)).toEqual({ status: 409, code: 'binding-changed' })
    expect(await refusal(await lookup('slew-fenced'))).toEqual({ status: 404, code: 'not-found' })
  })

  it('fails requests while unreachable, and its open streams go quiet until it is reachable again', async () => {
    const states = await subscribe()

    cria.reachable = false
    await expect(send('GET', '/v2/state')).rejects.toThrow('fetch failed')
    await advance(3_000)
    expect(states.map(state => state.sequence)).toEqual([1])

    cria.reachable = true
    await advance(1_000)
    expect(states.map(state => [state.sequence, state.instanceId === cria.instanceId])).toEqual([
      [1, true],
      [5, true],
    ])
  })
})
