import type { ResponseFixture } from './internal/test-fixtures.js'
import { describe, expect, it } from 'vitest'
import { createAlpacaCameraCooling } from './cooling.js'

function envelope(Value: ResponseFixture, ErrorNumber = 0, ErrorMessage = '') {
  return { Value, ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber, ErrorMessage }
}

function methodEnvelope(ErrorNumber = 0, ErrorMessage = '') {
  return { ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber, ErrorMessage }
}

const camera = {
  DeviceName: 'ASI2600MC Pro',
  DeviceType: 'Camera',
  DeviceNumber: 0,
  UniqueID: 'camera-0',
}

interface CameraState {
  connected: boolean
  name: string
  coolerOn: boolean
  setpointC: number
  sensorC: number
  powerPercent: number
  canSetTemperature: boolean
  canGetPower: boolean
  coolerOnImplemented: boolean
  rejectCoolerOn?: number
  dropSetpointWrite?: boolean
}

function scriptedCamera(
  state: CameraState,
  requests: Array<{ method: string, path: string, body?: string }> = [],
): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const path = url.pathname
    let body: string | undefined

    if (init?.body instanceof URLSearchParams) body = init.body.toString()

    requests.push(body === undefined ? { method, path } : { method, path, body })

    if (path === '/management/v1/configureddevices') return Response.json(envelope([camera]))

    const json = (result: ResponseFixture) => Response.json(result)

    if (path.endsWith('/connected') && method === 'GET') return json(envelope(state.connected))

    if (path.endsWith('/name')) return json(envelope(state.name))

    if (path.endsWith('/cansetccdtemperature')) return json(envelope(state.canSetTemperature))

    if (path.endsWith('/cangetcoolerpower')) return json(envelope(state.canGetPower))

    if (path.endsWith('/ccdtemperature')) return json(envelope(state.sensorC))

    if (path.endsWith('/setccdtemperature') && method === 'GET') return json(envelope(state.setpointC))

    if (path.endsWith('/coolerpower')) return json(envelope(state.powerPercent))

    if (path.endsWith('/cooleron') && method === 'GET') {
      if (!state.coolerOnImplemented) return json(envelope(false, 1024, 'Not implemented'))

      return json(envelope(state.coolerOn))
    }

    if (path.endsWith('/setccdtemperature') && method === 'PUT') {
      if (state.dropSetpointWrite) throw new TypeError('network down')

      const requested = Number(new URLSearchParams(body).get('SetCCDTemperature'))
      state.setpointC = requested

      return json(methodEnvelope())
    }

    if (path.endsWith('/cooleron') && method === 'PUT') {
      if (state.rejectCoolerOn !== undefined) return json(methodEnvelope(state.rejectCoolerOn, 'Device rejected CoolerOn'))

      state.coolerOn = new URLSearchParams(body).get('CoolerOn') === 'true'

      if (state.coolerOn) {
        state.sensorC = state.setpointC
        state.powerPercent = 18
      } else {
        state.powerPercent = 0
      }

      return json(methodEnvelope())
    }

    return new Response('Not found', { status: 404 })
  }
}

function cooling(state: CameraState, requests: Array<{ method: string, path: string, body?: string }> = []) {
  return createAlpacaCameraCooling({ baseUrl: 'http://alpaca.test', fetch: scriptedCamera(state, requests) })
}

const cooled = (): CameraState => ({
  connected: true,
  name: 'ASI2600MC Pro',
  coolerOn: false,
  setpointC: 5,
  sensorC: 4.8,
  powerPercent: 0,
  canSetTemperature: true,
  canGetPower: true,
  coolerOnImplemented: true,
})

describe('camera cooling commands', () => {
  it('observes CoolerOn independently of a near-setpoint sensor temperature', async () => {
    const observation = await cooling(cooled()).observe('camera-0')

    expect(observation).toEqual({
      state: 'off',
      canSetTemperature: true,
      canGetPower: true,
      sensorTemperatureC: 4.8,
      setpointC: 5,
      powerPercent: 0,
    })
  })

  it('turns the cooler on only when requested and confirms CoolerOn before reporting success', async () => {
    const requests: Array<{ method: string, path: string, body?: string }> = []
    const state = cooled()
    const result = await cooling(state, requests).setCooling({ cameraId: 'camera-0', coolerOn: true })

    expect(result).toMatchObject({
      outcome: 'confirmed',
      observation: { state: 'on', setpointC: 5, sensorTemperatureC: 5 },
    })
    const coolerWrites: Array<string | undefined> = []

    for (const request of requests) {
      if (request.method === 'PUT' && request.path.endsWith('/cooleron')) coolerWrites.push(request.body)
    }

    expect(coolerWrites).toEqual(['CoolerOn=true'])
    expect(requests.some(request => request.path.endsWith('/setccdtemperature') && request.method === 'PUT')).toBe(false)
  })

  it('sets a target temperature without enabling the cooler', async () => {
    const requests: Array<{ method: string, path: string, body?: string }> = []
    const state = cooled()
    const result = await cooling(state, requests).setCooling({ cameraId: 'camera-0', setpointC: -5 })

    expect(result).toEqual({
      outcome: 'confirmed',
      observation: {
        state: 'off',
        canSetTemperature: true,
        canGetPower: true,
        sensorTemperatureC: 4.8,
        setpointC: -5,
        powerPercent: 0,
      },
    })
    const writes: string[] = []

    for (const request of requests) {
      if (request.method === 'PUT') writes.push(`${request.path}?${request.body}`)
    }

    expect(writes).toEqual(['/api/v1/camera/0/setccdtemperature?SetCCDTemperature=-5'])
  })

  it('does not write CoolerOn when a setpoint write cannot be confirmed', async () => {
    const requests: Array<{ method: string, path: string, body?: string }> = []
    const state = { ...cooled(), dropSetpointWrite: true }
    const result = await cooling(state, requests).setCooling({ cameraId: 'camera-0', coolerOn: true, setpointC: -5 })

    expect(result).toEqual({ outcome: 'uncertain', reason: 'write-outcome-unknown' })
    expect(requests.some(request => request.path.endsWith('/cooleron') && request.method === 'PUT')).toBe(false)
  })

  it('reports a rejected CoolerOn write without treating sensor temperature as success', async () => {
    const state = { ...cooled(), rejectCoolerOn: 1035 }
    const result = await cooling(state).setCooling({ cameraId: 'camera-0', coolerOn: true })

    expect(result).toMatchObject({ outcome: 'failed', reason: 'rejected', errorNumber: 1035 })
    expect(state.coolerOn).toBe(false)
  })

  it('refuses a temperature write when the camera has no setpoint control', async () => {
    const requests: Array<{ method: string, path: string, body?: string }> = []

    const result = await cooling({ ...cooled(), canSetTemperature: false }, requests).setCooling({
      cameraId: 'camera-0',
      setpointC: 5,
    })

    expect(result).toMatchObject({ outcome: 'failed', reason: 'unsupported' })
    expect(requests.some(request => request.method === 'PUT')).toBe(false)
  })
})
