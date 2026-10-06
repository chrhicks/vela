import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  CriaClient,
  type CriaDevice,
  type CriaReading,
  type CriaState,
  type CriaValue,
} from '@vela/cria'
import type { CriaEquipmentBinding } from './equipment.js'
import { createCriaProvider } from './provider.js'

const generatedAt = 1_800_000_000_000

const storeId = 'b112d3f8-63e1-45c4-862b-95f74c1c6020'

function reading(value: CriaValue, ageMs = 100): CriaReading {
  return {
    value,
    observedAt: generatedAt - ageMs,
    checkedAt: generatedAt - ageMs,
    readStartedAt: generatedAt - ageMs,
    generation: 1,
    status: 'current',
    message: null,
  }
}

function unsupported(): CriaReading {
  return { ...reading(null), status: 'unsupported' }
}

function device(kind: CriaDevice['kind'], fields: CriaDevice['fields']): CriaDevice {
  return {
    id: `rig-${kind}`,
    kind,
    bindingId: '3fe32627-e813-4b11-9d52-d8fb6a08a1d2',
    expectedName: `Observed ${kind}`,
    failureDomain: 'rig',
    health: 'ready',
    blocked: false,
    reason: null,
    observationGeneration: 1,
    refreshPending: false,
    fields: {
      connected: reading(true),
      name: reading(`Observed ${kind}`),
      ...fields,
    },
    channels: [],
    commandReady: true,
  }
}

function providerFor(devices: CriaDevice[]) {
  const state: CriaState = {
    protocolVersion: 2,
    instanceId: 'bbd6befc-83b4-4c39-9b04-144ae328d7ea',
    storeId,
    sequence: 1,
    generatedAt,
    commandsEnabled: true,
    devices,
    operations: [],
  }

  const transport = { failure: false }
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined

  const event = () => new TextEncoder().encode(`event: state\ndata: ${JSON.stringify(state)}\n\n`)

  const bindings: CriaEquipmentBinding[] = devices.map(value => ({
    providerDeviceId: `remote-${value.kind}`,
    id: value.id,
    kind: value.kind,
    expectedName: value.expectedName,
  }))

  const client = new CriaClient({
    baseUrl: 'http://cria.test',
    token: 'provider-test-token-that-is-long-enough',
    storeId,
    devices: bindings.map(({ id, kind, expectedName }) => ({ id, kind, expectedName })),
    eventReconnectMs: 5,
    eventMaxReconnectMs: 20,
    fetch: async input => {
      if (new URL(String(input)).pathname !== '/v2/events') throw new Error('Unexpected request')

      if (transport.failure) throw new Error('Network interrupted')

      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller
          controller.enqueue(event())
        },
        cancel() { stream = undefined },
      }), { headers: { 'content-type': 'text/event-stream' } })
    },
  })

  onTestFinished(() => client.close())

  async function publish() {
    state.sequence++
    stream?.enqueue(event())
    await vi.waitFor(async () => expect((await client.state()).state.sequence).toBe(state.sequence))
  }

  async function interrupt() {
    transport.failure = true
    stream?.error(new TypeError('Network interrupted'))
    stream = undefined
    await vi.waitFor(async () => expect(client.state()).rejects.toMatchObject({ reason: 'transport' }))
  }

  async function recover() {
    transport.failure = false
    await publish()
  }

  return { provider: createCriaProvider(client, bindings), state, publish, interrupt, recover }
}

describe('Cria equipment inspection', () => {
  it('dates displayed readings by their oldest measurement and keeps valid values when another reading ages out', async () => {
    const camera = device('camera', {
      state: reading(2, 800),
      temperatureC: reading(-10, 2000),
      coolerOn: reading(true, 500),
      setpointC: reading(-10, 1200),
      coolerPowerPercent: unsupported(),
      canSetTemperature: reading(true, 40_000),
      canGetCoolerPower: reading(false, 40_000),
    })

    const { provider, publish } = providerFor([camera])

    const [complete] = await provider.inspectDevices()

    expect(complete?.telemetry).toMatchObject({
      availability: 'complete',
      values: { kind: 'camera', activity: 'exposing', sensorTemperatureC: -10 },
    })
    expect(complete?.observation).toMatchObject({
      state: 'current', observedAt: new Date(generatedAt - 2000).toISOString(),
    })

    // A new state event and status=current do not renew the field's age.
    camera.fields.temperatureC = reading(-10, 20_000)
    await publish()
    const [partial] = await provider.inspectDevices()

    expect(partial?.telemetry).toMatchObject({
      availability: 'partial', values: { kind: 'camera', activity: 'exposing' },
    })
    expect(partial?.telemetry.values).not.toHaveProperty('sensorTemperatureC')
    expect(partial?.observation).toMatchObject({
      state: 'partial', observedAt: new Date(generatedAt - 1200).toISOString(),
    })
  })

  it('marks malformed and absent optional values partial while unsupported values are normal omissions', async () => {
    const camera = device('camera', {
      state: reading(1.5),
      temperatureC: reading('cold'),
      coolerOn: unsupported(),
    })

    const { provider, publish } = providerFor([camera])

    const [malformed] = await provider.inspectDevices()

    expect(malformed?.telemetry).toEqual({ availability: 'partial', values: { kind: 'camera' } })

    camera.fields.state = unsupported()
    camera.fields.temperatureC = unsupported()
    await publish()
    const [unsupportedValues] = await provider.inspectDevices()

    expect(unsupportedValues?.telemetry).toEqual({ availability: 'complete', values: { kind: 'camera' } })

    delete camera.fields.temperatureC
    await publish()
    const [missing] = await provider.inspectDevices()

    expect(missing?.observation?.state).toBe('partial')
  })

  it('includes channel completeness and dynamic measurement times while mapping provider namespaces', async () => {
    const switches = device('switch', {})
    switches.channels = [{
      id: reading(0),
      name: reading('Dew heater', 40_000),
      value: reading(35, 2100),
      on: reading('yes'),
    }]

    const weather = device('weather', {
      temperatureC: reading(12), humidityPercent: unsupported(), dewPointC: unsupported(),
    })

    const mount = device('mount', {
      parked: reading(false), atHome: reading(false), slewing: reading(false), tracking: reading(true),
    })

    const { provider } = providerFor([switches, weather, mount])
    const [switchView, weatherView, mountView] = await provider.inspectDevices()

    expect(switchView).toMatchObject({
      providerDeviceId: 'remote-switch', kind: 'switch',
      telemetry: {
        availability: 'partial',
        values: { kind: 'switch', channels: [{ id: 0, name: 'Dew heater', value: 35 }] },
      },
      observation: { state: 'partial', observedAt: new Date(generatedAt - 2100).toISOString() },
    })
    expect(weatherView).toMatchObject({ providerDeviceId: 'remote-weather', kind: 'observing-conditions' })
    expect(mountView).toMatchObject({ providerDeviceId: 'remote-mount', kind: 'telescope' })
  })

  it('retains the last known view as interrupted after transport, ownership, or identity loss', async () => {
    const camera = device('camera', {
      state: reading(0), temperatureC: reading(-8, 700), coolerOn: unsupported(),
    })

    const { provider, state, publish, interrupt, recover } = providerFor([camera])
    const [known] = await provider.inspectDevices()
    await interrupt()
    const [offline] = await provider.inspectDevices()

    expect(offline?.telemetry).toEqual(known?.telemetry)
    expect(offline?.observation).toMatchObject({
      state: 'interrupted', commandReady: false, observedAt: known?.observation?.observedAt,
    })
    expect((await provider.listDevices())[0]?.connection).toBe('unavailable')

    camera.blocked = true
    await recover()
    const [blocked] = await provider.inspectDevices()

    expect(blocked?.telemetry).toEqual(known?.telemetry)
    expect(blocked?.observation?.state).toBe('interrupted')

    camera.blocked = false
    state.instanceId = 'fe0d09f6-ff27-42fd-aa8b-58a9dac6c3ac'
    await publish()
    const [identityLost] = await provider.inspectDevices()

    expect(identityLost?.telemetry).toEqual(known?.telemetry)
    expect(identityLost?.observation).toMatchObject({ state: 'interrupted', commandReady: false })
  })
})
