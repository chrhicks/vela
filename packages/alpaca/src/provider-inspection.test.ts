import { describe, expect, it, vi } from 'vitest'
import { createAlpacaProvider } from './index.js'

function envelope(Value: unknown, ErrorNumber = 0, ErrorMessage = '') {
  return { Value, ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber, ErrorMessage }
}

function configured(DeviceType: string, DeviceNumber: number) {
  return {
    DeviceName: `${DeviceType} slot`,
    DeviceType,
    DeviceNumber,
    UniqueID: `${DeviceType.toLowerCase()}-${DeviceNumber}`,
  }
}

function fakeFetch(
  routes: Record<string, unknown | Error>,
  requests: string[] = [],
): typeof globalThis.fetch {
  return (async (input) => {
    const url = new URL(String(input))
    const key = `${url.pathname}${url.search}`
    requests.push(key)
    const result = routes[key] ?? routes[url.pathname]
    if (result instanceof Error) throw result
    if (result === undefined) return new Response('Not found', { status: 404 })
    return Response.json(result)
  }) as typeof globalThis.fetch
}

const devices = [
  configured('Camera', 0),
  configured('Telescope', 0),
  configured('Focuser', 0),
  configured('FilterWheel', 0),
  configured('ObservingConditions', 0),
  configured('Switch', 0),
]

function commonRoutes() {
  return Object.fromEntries(devices.flatMap((device) => {
    const base = `/api/v1/${device.DeviceType.toLowerCase()}/${device.DeviceNumber}`
    return [
      [`${base}/connected`, envelope(true)],
      [`${base}/name`, envelope(`${device.DeviceType} hardware`)],
    ]
  }))
}

describe('Alpaca device inspection', () => {
  it('normalizes the status required by each current device kind', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope(devices),
        ...commonRoutes(),
        '/api/v1/camera/0/camerastate': envelope(2),
        '/api/v1/camera/0/ccdtemperature': envelope(-5.2),
        '/api/v1/camera/0/cansetccdtemperature': envelope(true),
        '/api/v1/camera/0/cangetcoolerpower': envelope(true),
        '/api/v1/camera/0/cooleron': envelope(true),
        '/api/v1/camera/0/coolerpower': envelope(42.5),
        '/api/v1/telescope/0/atpark': envelope(false),
        '/api/v1/telescope/0/athome': envelope(true),
        '/api/v1/telescope/0/slewing': envelope(false),
        '/api/v1/telescope/0/tracking': envelope(true),
        '/api/v1/focuser/0/position': envelope(32888),
        '/api/v1/focuser/0/ismoving': envelope(false),
        '/api/v1/focuser/0/temperature': envelope(27),
        '/api/v1/filterwheel/0/position': envelope(1),
        '/api/v1/filterwheel/0/names': envelope(['Clear', 'Dark']),
        '/api/v1/observingconditions/0/temperature': envelope(23.8),
        '/api/v1/observingconditions/0/humidity': envelope(67),
        '/api/v1/observingconditions/0/dewpoint': envelope(17.3),
        '/api/v1/switch/0/maxswitch': envelope(1),
        '/api/v1/switch/0/getswitchname?Id=0': envelope('Input Voltage'),
        '/api/v1/switch/0/getswitchdescription?Id=0': envelope('Voltage'),
        '/api/v1/switch/0/getswitchvalue?Id=0': envelope(12.9),
        '/api/v1/switch/0/getswitch?Id=0': envelope(true),
        '/api/v1/switch/0/minswitchvalue?Id=0': envelope(0),
        '/api/v1/switch/0/maxswitchvalue?Id=0': envelope(16),
        '/api/v1/switch/0/switchstep?Id=0': envelope(0.1),
        '/api/v1/switch/0/canwrite?Id=0': envelope(false),
      }),
    })

    await expect(provider.inspectDevices()).resolves.toEqual([
      {
        providerDeviceId: 'camera-0',
        kind: 'camera',
        configuredName: 'Camera slot',
        name: 'Camera hardware',
        connection: 'connected',
        telemetry: {
          availability: 'complete',
          values: {
            kind: 'camera',
            activity: 'exposing',
            sensorTemperatureC: -5.2,
            cooling: {
              state: 'on',
              setpointControl: true,
              powerReporting: true,
              powerPercent: 42.5,
            },
          },
        },
      },
      {
        providerDeviceId: 'telescope-0', kind: 'telescope', configuredName: 'Telescope slot', name: 'Telescope hardware', connection: 'connected',
        telemetry: { availability: 'complete', values: { kind: 'telescope', parked: false, atHome: true, slewing: false, tracking: true } },
      },
      {
        providerDeviceId: 'focuser-0', kind: 'focuser', configuredName: 'Focuser slot', name: 'Focuser hardware', connection: 'connected',
        telemetry: { availability: 'complete', values: { kind: 'focuser', position: 32888, moving: false, temperatureC: 27 } },
      },
      {
        providerDeviceId: 'filterwheel-0', kind: 'filter-wheel', configuredName: 'FilterWheel slot', name: 'FilterWheel hardware', connection: 'connected',
        telemetry: { availability: 'complete', values: { kind: 'filter-wheel', position: 1, filterName: 'Dark', moving: false } },
      },
      {
        providerDeviceId: 'observingconditions-0', kind: 'observing-conditions', configuredName: 'ObservingConditions slot', name: 'ObservingConditions hardware', connection: 'connected',
        telemetry: { availability: 'complete', values: { kind: 'observing-conditions', temperatureC: 23.8, humidityPercent: 67, dewPointC: 17.3 } },
      },
      {
        providerDeviceId: 'switch-0', kind: 'switch', configuredName: 'Switch slot', name: 'Switch hardware', connection: 'connected',
        telemetry: {
          availability: 'complete',
          values: {
            kind: 'switch',
            channels: [{ id: 0, name: 'Input Voltage', description: 'Voltage', value: 12.9, on: true, minimum: 0, maximum: 16, step: 0.1, writable: false }],
          },
        },
      },
    ])
  })

  it('does not request telemetry for disconnected devices and falls back to the configured name', async () => {
    const requests: string[] = []
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[0]]),
        '/api/v1/camera/0/connected': envelope(false),
        '/api/v1/camera/0/name': envelope('', 1031, 'Name unavailable while disconnected'),
      }, requests),
    })

    await expect(provider.inspectDevices()).resolves.toEqual([{
      providerDeviceId: 'camera-0',
      kind: 'camera',
      configuredName: 'Camera slot',
      name: 'Camera slot',
      connection: 'disconnected',
      telemetry: { availability: 'unavailable' },
    }])
    expect(requests).toEqual([
      '/management/v1/configureddevices',
      '/api/v1/camera/0/connected',
      '/api/v1/camera/0/name',
    ])
  })

  it('omits unsupported properties and marks malformed reads as partial', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[0]]),
        '/api/v1/camera/0/connected': envelope(true),
        '/api/v1/camera/0/name': envelope('  ZWO ASI220MM Mini  '),
        '/api/v1/camera/0/camerastate': envelope(99),
        '/api/v1/camera/0/ccdtemperature': envelope('hot'),
        '/api/v1/camera/0/cansetccdtemperature': envelope(false, 1024, 'Property is not implemented'),
        '/api/v1/camera/0/cangetcoolerpower': envelope(false, 1024, 'Property is not implemented'),
        '/api/v1/camera/0/cooleron': envelope(false, 1024, 'Property is not implemented'),
      }),
    })

    await expect(provider.inspectDevices()).resolves.toEqual([{
      providerDeviceId: 'camera-0',
      kind: 'camera',
      configuredName: 'Camera slot',
      name: 'ZWO ASI220MM Mini',
      connection: 'connected',
      telemetry: {
        availability: 'partial',
        values: { kind: 'camera' },
      },
    }])
  })

  it('reports an active open-loop cooler without setpoint control', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[0]]),
        '/api/v1/camera/0/connected': envelope(true),
        '/api/v1/camera/0/name': envelope('Open-loop camera'),
        '/api/v1/camera/0/camerastate': envelope(0),
        '/api/v1/camera/0/ccdtemperature': envelope(-2),
        '/api/v1/camera/0/cansetccdtemperature': envelope(false),
        '/api/v1/camera/0/cangetcoolerpower': envelope(true),
        '/api/v1/camera/0/cooleron': envelope(true),
        '/api/v1/camera/0/coolerpower': envelope(75),
      }),
    })

    await expect(provider.inspectDevices()).resolves.toEqual([{
      providerDeviceId: 'camera-0',
      kind: 'camera',
      configuredName: 'Camera slot',
      name: 'Open-loop camera',
      connection: 'connected',
      telemetry: {
        availability: 'complete',
        values: {
          kind: 'camera',
          activity: 'idle',
          sensorTemperatureC: -2,
          cooling: {
            state: 'on',
            setpointControl: false,
            powerReporting: true,
            powerPercent: 75,
          },
        },
      },
    }])
  })

  it('omits invalid cooler power and marks the inspection partial', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[0]]),
        '/api/v1/camera/0/connected': envelope(true),
        '/api/v1/camera/0/name': envelope('Cooled camera'),
        '/api/v1/camera/0/camerastate': envelope(0),
        '/api/v1/camera/0/ccdtemperature': envelope(-2),
        '/api/v1/camera/0/cansetccdtemperature': envelope(true),
        '/api/v1/camera/0/cangetcoolerpower': envelope(true),
        '/api/v1/camera/0/cooleron': envelope(true),
        '/api/v1/camera/0/coolerpower': envelope(150),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry).toEqual({
      availability: 'partial',
      values: {
        kind: 'camera',
        activity: 'idle',
        sensorTemperatureC: -2,
        cooling: {
          state: 'on',
          setpointControl: true,
          powerReporting: true,
        },
      },
    })
  })

  it('preserves an off open-loop cooler state without setpoint or power capabilities', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[0]]),
        '/api/v1/camera/0/connected': envelope(true),
        '/api/v1/camera/0/name': envelope('Open-loop camera'),
        '/api/v1/camera/0/camerastate': envelope(0),
        '/api/v1/camera/0/ccdtemperature': envelope(-2),
        '/api/v1/camera/0/cansetccdtemperature': envelope(false),
        '/api/v1/camera/0/cangetcoolerpower': envelope(false),
        '/api/v1/camera/0/cooleron': envelope(false),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry).toEqual({
      availability: 'complete',
      values: {
        kind: 'camera',
        activity: 'idle',
        sensorTemperatureC: -2,
        cooling: {
          state: 'off',
          setpointControl: false,
          powerReporting: false,
        },
      },
    })
  })

  it('omits humidity outside the protocol range and marks conditions partial', async () => {
    const conditions = devices[4]
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([conditions]),
        '/api/v1/observingconditions/0/connected': envelope(true),
        '/api/v1/observingconditions/0/name': envelope('Weather station'),
        '/api/v1/observingconditions/0/temperature': envelope(23),
        '/api/v1/observingconditions/0/humidity': envelope(150),
        '/api/v1/observingconditions/0/dewpoint': envelope(17),
      }),
    })

    await expect(provider.inspectDevices()).resolves.toEqual([{
      providerDeviceId: 'observingconditions-0',
      kind: 'observing-conditions',
      configuredName: 'ObservingConditions slot',
      name: 'Weather station',
      connection: 'connected',
      telemetry: {
        availability: 'partial',
        values: {
          kind: 'observing-conditions',
          temperatureC: 23,
          dewPointC: 17,
        },
      },
    }])
  })

  it('omits invalid filter positions and marks the inspection partial', async () => {
    const filterWheel = devices[3]
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([filterWheel]),
        '/api/v1/filterwheel/0/connected': envelope(true),
        '/api/v1/filterwheel/0/name': envelope('Filter wheel'),
        '/api/v1/filterwheel/0/position': envelope(-2),
        '/api/v1/filterwheel/0/names': envelope(['Clear', 'Dark']),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry).toEqual({
      availability: 'partial',
      values: { kind: 'filter-wheel' },
    })
  })

  it('marks a missing capability-backed cooler power reading partial', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[0]]),
        '/api/v1/camera/0/connected': envelope(true),
        '/api/v1/camera/0/name': envelope('Cooled camera'),
        '/api/v1/camera/0/camerastate': envelope(0),
        '/api/v1/camera/0/ccdtemperature': envelope(-2),
        '/api/v1/camera/0/cansetccdtemperature': envelope(false),
        '/api/v1/camera/0/cangetcoolerpower': envelope(true),
        '/api/v1/camera/0/cooleron': envelope(true),
        '/api/v1/camera/0/coolerpower': envelope(0, 1024, 'Not implemented'),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry.availability).toBe('partial')
  })

  it('does not report unknown switch inventory as an empty observed list', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[5]]),
        '/api/v1/switch/0/connected': envelope(true),
        '/api/v1/switch/0/name': envelope('Power box'),
        '/api/v1/switch/0/maxswitch': envelope(0, 1024, 'Not implemented'),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry).toEqual({
      availability: 'partial',
      values: { kind: 'switch' },
    })
  })

  it('bounds malformed switch channel counts before reading individual channels', async () => {
    const requests: string[] = []
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[5]]),
        '/api/v1/switch/0/connected': envelope(true),
        '/api/v1/switch/0/name': envelope('Power box'),
        '/api/v1/switch/0/maxswitch': envelope(257),
      }, requests),
    })

    await expect(provider.inspectDevices()).resolves.toEqual([{
      providerDeviceId: 'switch-0',
      kind: 'switch',
      configuredName: 'Switch slot',
      name: 'Power box',
      connection: 'connected',
      telemetry: {
        availability: 'partial',
        values: { kind: 'switch' },
      },
    }])
    expect(requests).toHaveLength(4)
  })

  it('propagates explicit cancellation instead of degrading it to partial data', async () => {
    const controller = new AbortController()
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      }),
    ) as typeof globalThis.fetch
    const provider = createAlpacaProvider({ baseUrl: 'http://alpaca.test', fetch })

    const inspection = provider.inspectDevices({ signal: controller.signal })
    controller.abort(new Error('superseded'))

    await expect(inspection).rejects.toThrow('superseded')
  })
})
