import { Schema } from 'effect'
import { Device, ErrorBody, Operation, State, type ErrorCode } from '@cria/wire'
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

async function send(method: string, path: string, body?: string): Promise<Response> {
  return cria.fetch(`${cria.origin}${path}`, body === undefined ? { method } : { method, body })
}

async function read<S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, response: Response): Promise<S['Type']> {
  return Schema.decodeUnknownSync(schema)(await response.json())
}

async function refusal(response: Response): Promise<{ readonly status: number; readonly code: ErrorCode }> {
  return { status: response.status, code: (await read(ErrorBody, response)).error.code }
}

const names = { camera: 'Fake CCD', mount: 'ZWO AM5', focuser: 'Fake Focuser' } as const

function request(deviceId: keyof typeof names, kind: string, parameters: Record<string, number | boolean | string>, requestId = `${kind}-1`) {
  return {
    instanceId: cria.instanceId,
    requestId,
    deviceId,
    bindingId: cria.bindingOf(deviceId),
    expectedName: names[deviceId],
    kind,
    parameters,
  }
}

async function submit(body: ReturnType<typeof request>): Promise<Response> {
  return send('POST', '/v2/operations', JSON.stringify(body))
}

async function admitted(body: ReturnType<typeof request>): Promise<Operation> {
  const response = await submit(body)

  expect(response.status).toBe(202)

  return read(Operation, response)
}

async function operation(id: string): Promise<Operation> {
  return read(Operation, await send('GET', `/v2/operations/${id}`))
}

async function device(id: string): Promise<Device> {
  const state = await read(State, await send('GET', '/v2/state'))
  const found = state.devices.find(candidate => candidate.id === id)

  if (!found) throw new Error(`No device ${id} in the state`)

  return found
}

async function recover(deviceId: string, bindingId = cria.bindingOf(deviceId)): Promise<Response> {
  const body = { instanceId: cria.instanceId, bindingId, externalRecoveryConfirmed: true, note: 'Chris checked the rig' }

  return send('POST', `/v2/devices/${deviceId}/recover`, JSON.stringify(body))
}

/** Collects every SSE state event the fake sends on one subscription. */
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
  await vi.advanceTimersByTimeAsync(0)

  return states
}

describe('the snapshot cadence', () => {
  it('sends a snapshot at once, then one a second, and one at once after a change', async () => {
    const start = Date.now()
    const states = await subscribe()

    await vi.advanceTimersByTimeAsync(3_000)

    expect(states.map(state => [state.sequence, state.generatedAt - start])).toEqual([
      [1, 0],
      [2, 1_000],
      [3, 2_000],
      [4, 3_000],
    ])

    await vi.advanceTimersByTimeAsync(400)
    await admitted(request('camera', 'cooling', { setpointC: -10 }))
    await vi.advanceTimersByTimeAsync(0)

    expect(states.slice(4).map(state => [state.generatedAt - start, state.operations.map(open => open.state)])).toEqual([
      [3_400, ['running']],
      [3_400, ['settled']],
    ])
  })
})

describe('admission', () => {
  it('answers a repeated request ID with the same operation and refuses it with changed content', async () => {
    const first = await admitted(request('mount', 'mount-slew', { rightAscensionDegrees: 120, declinationDegrees: 10, coordinateSystem: 'topocentric' }))
    const again = await admitted(request('mount', 'mount-slew', { coordinateSystem: 'topocentric', declinationDegrees: 10, rightAscensionDegrees: 120 }))
    const changed = await submit(request('mount', 'mount-slew', { rightAscensionDegrees: 121, declinationDegrees: 10, coordinateSystem: 'topocentric' }))

    expect(again.id).toBe(first.id)
    expect(await refusal(changed)).toEqual({ status: 409, code: 'request-conflict' })
    expect(cria.received.filter(received => received.route === 'submit')).toHaveLength(3)
  })
})
