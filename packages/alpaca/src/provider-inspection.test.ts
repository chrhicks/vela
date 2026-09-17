import type { ResponseFixture } from './internal/test-fixtures.js'
import { describe, expect, it, vi } from 'vitest'
import { createAlpacaProvider } from './index.js'

function envelope(Value: ResponseFixture, ErrorNumber = 0, ErrorMessage = '') {
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
  routes: Record<string, ResponseFixture | Error>,
  requests: string[] = [],
): typeof globalThis.fetch {
  return async (input) => {
    const url = new URL(String(input))
    const key = `${url.pathname}${url.search}`
    requests.push(key)
    const result = routes[key] ?? routes[url.pathname]

    if (result instanceof Error) throw result

    if (result === undefined) return new Response('Not found', { status: 404 })

    return Response.json(result)
  }
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
        '/api/v1/camera/0/setccdtemperature': envelope(-5),
        '/api/v1/camera/0/coolerpower': envelope(42.5),
        '/api/v1/telescope/0/atpark': envelope(false),
        '/api/v1/telescope/0/athome': envelope(false),
        '/api/v1/telescope/0/slewing': envelope(false),
        '/api/v1/telescope/0/tracking': envelope(true),
        '/api/v1/focuser/0/absolute': envelope(true),
        '/api/v1/focuser/0/position': envelope(32888),
        '/api/v1/focuser/0/maxstep': envelope(50000),
        '/api/v1/focuser/0/ismoving': envelope(false),
        '/api/v1/focuser/0/temperature': envelope(27),
        '/api/v1/filterwheel/0/position': envelope(1),
        '/api/v1/filterwheel/0/names': envelope(['Clear', 'Dark']),
        '/api/v1/observingconditions/0/temperature': envelope(23.8),
        '/api/v1/observingconditions/0/humidity': envelope(67),
        '/api/v1/observingconditions/0/dewpoint': envelope(17.3),
        '/api/v1/switch/0/maxswitch': envelope(2),
        '/api/v1/switch/0/getswitchname?Id=0': envelope('Input Voltage'),
        '/api/v1/switch/0/getswitchdescription?Id=0': envelope('Voltage'),
        '/api/v1/switch/0/getswitchvalue?Id=0': envelope(12.94),
        '/api/v1/switch/0/getswitch?Id=0': envelope(true),
        '/api/v1/switch/0/minswitchvalue?Id=0': envelope(0),
        '/api/v1/switch/0/maxswitchvalue?Id=0': envelope(16),
        '/api/v1/switch/0/switchstep?Id=0': envelope(0.1),
        '/api/v1/switch/0/canwrite?Id=0': envelope(false),
        '/api/v1/switch/0/getswitchname?Id=1': envelope('Dew heater'),
        '/api/v1/switch/0/getswitchdescription?Id=1': envelope('Heater output'),
        '/api/v1/switch/0/getswitchvalue?Id=1': envelope(35),
        '/api/v1/switch/0/getswitch?Id=1': envelope(true),
        '/api/v1/switch/0/minswitchvalue?Id=1': envelope(0),
        '/api/v1/switch/0/maxswitchvalue?Id=1': envelope(100),
        '/api/v1/switch/0/switchstep?Id=1': envelope(1),
        '/api/v1/switch/0/canwrite?Id=1': envelope(true),
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
              setpointC: -5,
              powerPercent: 42.5,
            },
          },
        },
      },
      {
        providerDeviceId: 'telescope-0', kind: 'telescope', configuredName: 'Telescope slot', name: 'Telescope hardware', connection: 'connected',
        telemetry: { availability: 'complete', values: { kind: 'telescope', parked: false, atHome: false, slewing: false, tracking: true } },
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
            channels: [
              { id: 0, name: 'Input Voltage', description: 'Voltage', value: 12.94, on: true, minimum: 0, maximum: 16, step: 0.1, writable: false },
              { id: 1, name: 'Dew heater', description: 'Heater output', value: 35, on: true, minimum: 0, maximum: 100, step: 1, writable: true },
            ],
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
        '/api/v1/camera/0/setccdtemperature': envelope(-2),
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
          setpointC: -2,
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

  it('treats unsupported cooler state as optional when the camera reports no cooling capabilities', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[0]]),
        '/api/v1/camera/0/connected': envelope(true),
        '/api/v1/camera/0/name': envelope('Uncooled camera'),
        '/api/v1/camera/0/camerastate': envelope(0),
        '/api/v1/camera/0/ccdtemperature': envelope(18),
        '/api/v1/camera/0/cansetccdtemperature': envelope(false),
        '/api/v1/camera/0/cangetcoolerpower': envelope(false),
        '/api/v1/camera/0/cooleron': envelope(false, 1024, 'Not implemented'),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry).toEqual({
      availability: 'complete',
      values: {
        kind: 'camera',
        activity: 'idle',
        sensorTemperatureC: 18,
      },
    })
  })

  it('reads cooler power while cooling is off when the camera reports it', async () => {
    const requests: string[] = []

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
        '/api/v1/camera/0/cooleron': envelope(false),
        '/api/v1/camera/0/setccdtemperature': envelope(5),
        '/api/v1/camera/0/coolerpower': envelope(0),
      }, requests),
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
          setpointControl: true,
          powerReporting: true,
          setpointC: 5,
          powerPercent: 0,
        },
      },
    })
    expect(requests).toContain('/api/v1/camera/0/coolerpower')
  })

  it('keeps CoolerOn false when the sensor is near a retained setpoint', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[0]]),
        '/api/v1/camera/0/connected': envelope(true),
        '/api/v1/camera/0/name': envelope('ASI2600MC Pro'),
        '/api/v1/camera/0/camerastate': envelope(0),
        '/api/v1/camera/0/ccdtemperature': envelope(4.8),
        '/api/v1/camera/0/cansetccdtemperature': envelope(true),
        '/api/v1/camera/0/cangetcoolerpower': envelope(true),
        '/api/v1/camera/0/cooleron': envelope(false),
        '/api/v1/camera/0/setccdtemperature': envelope(5),
        '/api/v1/camera/0/coolerpower': envelope(0),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry.values).toMatchObject({
      sensorTemperatureC: 4.8,
      cooling: { state: 'off', setpointC: 5, powerPercent: 0 },
    })
  })


  it('marks missing temperature partial when setpoint control implies temperature support', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[0]]),
        '/api/v1/camera/0/connected': envelope(true),
        '/api/v1/camera/0/name': envelope('Cooled camera'),
        '/api/v1/camera/0/camerastate': envelope(0),
        '/api/v1/camera/0/ccdtemperature': envelope(0, 1024, 'Not implemented'),
        '/api/v1/camera/0/cansetccdtemperature': envelope(true),
        '/api/v1/camera/0/cangetcoolerpower': envelope(false),
        '/api/v1/camera/0/cooleron': envelope(false),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry.availability).toBe('partial')
  })

  it('keeps optional telescope slewing separate from mandatory mount state', async () => {
    const telescope = devices[1]

    const routes = {
      '/management/v1/configureddevices': envelope([telescope]),
      '/api/v1/telescope/0/connected': envelope(true),
      '/api/v1/telescope/0/name': envelope('Mount'),
      '/api/v1/telescope/0/atpark': envelope(false),
      '/api/v1/telescope/0/athome': envelope(false),
      '/api/v1/telescope/0/slewing': envelope(false, 1024, 'Not implemented'),
      '/api/v1/telescope/0/tracking': envelope(false),
    }

    const provider = createAlpacaProvider({ baseUrl: 'http://alpaca.test', fetch: fakeFetch(routes) })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry).toEqual({
      availability: 'complete',
      values: { kind: 'telescope', parked: false, atHome: false, tracking: false },
    })

    const invalidProvider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        ...routes,
        '/api/v1/telescope/0/athome': envelope(false, 1024, 'Not implemented'),
      }),
    })

    const [invalidInspection] = await invalidProvider.inspectDevices()
    expect(invalidInspection?.telemetry.availability).toBe('partial')
  })

  it('omits contradictory parked, home, slewing, and tracking combinations', async () => {
    const telescope = devices[1]

    const cases = [
      {
        state: { parked: true, atHome: false, slewing: false, tracking: true },
        values: { kind: 'telescope', atHome: false, slewing: false },
      },
      {
        state: { parked: true, atHome: false, slewing: true, tracking: false },
        values: { kind: 'telescope', atHome: false, tracking: false },
      },
      {
        state: { parked: false, atHome: true, slewing: true, tracking: false },
        values: { kind: 'telescope', parked: false, tracking: false },
      },
      {
        state: { parked: false, atHome: true, slewing: false, tracking: true },
        values: { kind: 'telescope', parked: false, slewing: false },
      },
    ]

    for (const testCase of cases) {
      const provider = createAlpacaProvider({
        baseUrl: 'http://alpaca.test',
        fetch: fakeFetch({
          '/management/v1/configureddevices': envelope([telescope]),
          '/api/v1/telescope/0/connected': envelope(true),
          '/api/v1/telescope/0/name': envelope('Mount'),
          '/api/v1/telescope/0/atpark': envelope(testCase.state.parked),
          '/api/v1/telescope/0/athome': envelope(testCase.state.atHome),
          '/api/v1/telescope/0/slewing': envelope(testCase.state.slewing),
          '/api/v1/telescope/0/tracking': envelope(testCase.state.tracking),
        }),
      })

      const [inspection] = await provider.inspectDevices()
      expect(inspection?.telemetry).toEqual({
        availability: 'partial',
        values: testCase.values,
      })
    }
  })

  it('omits invalid absolute focuser positions and requires motion state', async () => {
    const focuser = devices[2]

    const routes = {
      '/management/v1/configureddevices': envelope([focuser]),
      '/api/v1/focuser/0/connected': envelope(true),
      '/api/v1/focuser/0/name': envelope('Focuser'),
      '/api/v1/focuser/0/absolute': envelope(true),
      '/api/v1/focuser/0/position': envelope(12.5),
      '/api/v1/focuser/0/maxstep': envelope(100),
      '/api/v1/focuser/0/ismoving': envelope(false),
      '/api/v1/focuser/0/temperature': envelope(0, 1024, 'Not implemented'),
    }

    const provider = createAlpacaProvider({ baseUrl: 'http://alpaca.test', fetch: fakeFetch(routes) })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry).toEqual({
      availability: 'partial',
      values: { kind: 'focuser', moving: false },
    })

    const missingMotionProvider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        ...routes,
        '/api/v1/focuser/0/position': envelope(50),
        '/api/v1/focuser/0/ismoving': envelope(false, 1024, 'Not implemented'),
      }),
    })

    const [missingMotion] = await missingMotionProvider.inspectDevices()
    expect(missingMotion?.telemetry.availability).toBe('partial')
  })

  it('marks one-sided humidity and dew-point support partial', async () => {
    const conditions = devices[4]

    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([conditions]),
        '/api/v1/observingconditions/0/connected': envelope(true),
        '/api/v1/observingconditions/0/name': envelope('Weather station'),
        '/api/v1/observingconditions/0/temperature': envelope(23),
        '/api/v1/observingconditions/0/humidity': envelope(50),
        '/api/v1/observingconditions/0/dewpoint': envelope(0, 1024, 'Not implemented'),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry).toEqual({
      availability: 'partial',
      values: { kind: 'observing-conditions', temperatureC: 23, humidityPercent: 50 },
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

  it('omits contradictory switch boolean and numeric state', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[5]]),
        '/api/v1/switch/0/connected': envelope(true),
        '/api/v1/switch/0/name': envelope('Power box'),
        '/api/v1/switch/0/maxswitch': envelope(1),
        '/api/v1/switch/0/getswitchname?Id=0': envelope('Output'),
        '/api/v1/switch/0/getswitchdescription?Id=0': envelope('Output channel'),
        '/api/v1/switch/0/getswitchvalue?Id=0': envelope(0),
        '/api/v1/switch/0/getswitch?Id=0': envelope(true),
        '/api/v1/switch/0/minswitchvalue?Id=0': envelope(0),
        '/api/v1/switch/0/maxswitchvalue?Id=0': envelope(1),
        '/api/v1/switch/0/switchstep?Id=0': envelope(1),
        '/api/v1/switch/0/canwrite?Id=0': envelope(false),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry).toEqual({
      availability: 'partial',
      values: {
        kind: 'switch',
        channels: [{
          id: 0,
          name: 'Output',
          description: 'Output channel',
          minimum: 0,
          maximum: 1,
          step: 1,
          writable: false,
        }],
      },
    })
  })

  it('omits contradictory switch ranges and marks the channel partial', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[5]]),
        '/api/v1/switch/0/connected': envelope(true),
        '/api/v1/switch/0/name': envelope('Power box'),
        '/api/v1/switch/0/maxswitch': envelope(1),
        '/api/v1/switch/0/getswitchname?Id=0': envelope('Output'),
        '/api/v1/switch/0/getswitchdescription?Id=0': envelope('Output channel'),
        '/api/v1/switch/0/getswitchvalue?Id=0': envelope(99),
        '/api/v1/switch/0/getswitch?Id=0': envelope(true),
        '/api/v1/switch/0/minswitchvalue?Id=0': envelope(10),
        '/api/v1/switch/0/maxswitchvalue?Id=0': envelope(0),
        '/api/v1/switch/0/switchstep?Id=0': envelope(0),
        '/api/v1/switch/0/canwrite?Id=0': envelope(false),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry).toEqual({
      availability: 'partial',
      values: {
        kind: 'switch',
        channels: [{ id: 0, name: 'Output', description: 'Output channel', on: true, writable: false }],
      },
    })
  })

  it('marks a missing required switch description partial', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([devices[5]]),
        '/api/v1/switch/0/connected': envelope(true),
        '/api/v1/switch/0/name': envelope('Power box'),
        '/api/v1/switch/0/maxswitch': envelope(1),
        '/api/v1/switch/0/getswitchname?Id=0': envelope('Output'),
        '/api/v1/switch/0/getswitchdescription?Id=0': envelope('', 1024, 'Not implemented'),
        '/api/v1/switch/0/getswitchvalue?Id=0': envelope(1),
        '/api/v1/switch/0/getswitch?Id=0': envelope(true),
        '/api/v1/switch/0/minswitchvalue?Id=0': envelope(0),
        '/api/v1/switch/0/maxswitchvalue?Id=0': envelope(1),
        '/api/v1/switch/0/switchstep?Id=0': envelope(1),
        '/api/v1/switch/0/canwrite?Id=0': envelope(false),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry.availability).toBe('partial')
  })

  it('reports connected kinds without an inspector as unavailable telemetry', async () => {
    const dome = configured('Dome', 0)

    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([dome]),
        '/api/v1/dome/0/connected': envelope(true),
        '/api/v1/dome/0/name': envelope('Dome'),
      }),
    })

    const [inspection] = await provider.inspectDevices()
    expect(inspection).toEqual({
      providerDeviceId: 'dome-0',
      kind: 'dome',
      configuredName: 'Dome slot',
      name: 'Dome',
      connection: 'connected',
      telemetry: { availability: 'unavailable' },
    })
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

  it('rejects exponent-overflow numbers before they reach normalized telemetry', async () => {
    const conditions = devices[4]

    const fallback = fakeFetch({
      '/management/v1/configureddevices': envelope([conditions]),
      '/api/v1/observingconditions/0/connected': envelope(true),
      '/api/v1/observingconditions/0/name': envelope('Weather station'),
      '/api/v1/observingconditions/0/humidity': envelope(50),
      '/api/v1/observingconditions/0/dewpoint': envelope(12),
    })

    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))

      if (url.pathname.endsWith('/temperature')) {
        return new Response(
          '{"Value":1e400,"ClientTransactionID":0,"ServerTransactionID":1,"ErrorNumber":0,"ErrorMessage":""}',
          { headers: { 'content-type': 'application/json' } },
        )
      }

      return fallback(input, init)
    }

    const provider = createAlpacaProvider({ baseUrl: 'http://alpaca.test', fetch })

    const [inspection] = await provider.inspectDevices()
    expect(inspection?.telemetry).toEqual({
      availability: 'partial',
      values: { kind: 'observing-conditions', humidityPercent: 50, dewPointC: 12 },
    })
  })

  it.each(['camerastate', 'ccdtemperature'])(
    'propagates cancellation during %s without degrading it to partial data',
    async (operation) => {
      const controller = new AbortController()
      const cancellation = new Error('superseded')
      let markReadStarted!: () => void

      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve
      })

      const requests: string[] = []

      const fallback = fakeFetch({
        '/management/v1/configureddevices': envelope([devices[0]]),
        '/api/v1/camera/0/connected': envelope(true),
        '/api/v1/camera/0/name': envelope('Camera'),
        '/api/v1/camera/0/camerastate': envelope(0),
        '/api/v1/camera/0/cansetccdtemperature': envelope(false),
        '/api/v1/camera/0/cangetcoolerpower': envelope(false),
        '/api/v1/camera/0/cooleron': envelope(false),
      })

      const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname
        requests.push(path)

        if (path === `/api/v1/camera/0/${operation}`) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
            markReadStarted()
          })
        }

        return fallback(input, init)
      })

      const provider = createAlpacaProvider({ baseUrl: 'http://alpaca.test', fetch })

      const inspection = provider.inspectDevices({ signal: controller.signal })
      await readStarted
      const requestsBeforeCancellation = [...requests]
      controller.abort(cancellation)

      await expect(inspection).rejects.toBe(cancellation)
      expect(requests).toEqual(requestsBeforeCancellation)
    },
  )
})
