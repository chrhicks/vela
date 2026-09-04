import { describe, expect, it } from 'vitest'
import type { AlpacaDeviceInspection } from '@vela/alpaca'
import { currentDeviceView } from './rig-detail.js'

const observedAt = '2026-09-03T20:00:00.000Z'

function inspection(
  value: Omit<AlpacaDeviceInspection, 'providerDeviceId' | 'configuredName' | 'name' | 'connection'>,
): AlpacaDeviceInspection {
  return {
    providerDeviceId: `${value.kind}-0`,
    configuredName: `${value.kind} slot`,
    name: `${value.kind} device`,
    connection: 'connected',
    ...value,
  }
}

describe('Rig device detail mapping', () => {
  it('maps every supported kind into its Vela status vocabulary', () => {
    const devices: ReadonlyArray<AlpacaDeviceInspection> = [
      inspection({
        kind: 'camera',
        telemetry: {
          availability: 'complete',
          values: {
            kind: 'camera',
            activity: 'reading',
            sensorTemperatureC: 18,
            cooling: {
              state: 'off',
              setpointControl: false,
              powerReporting: false,
            },
          },
        },
      }),
      inspection({
        kind: 'telescope',
        telemetry: {
          availability: 'complete',
          values: {
            kind: 'telescope',
            parked: true,
            atHome: false,
            slewing: false,
            tracking: false,
          },
        },
      }),
      inspection({
        kind: 'focuser',
        telemetry: {
          availability: 'complete',
          values: { kind: 'focuser', position: 42, moving: true, temperatureC: 12 },
        },
      }),
      inspection({
        kind: 'filter-wheel',
        telemetry: {
          availability: 'complete',
          values: { kind: 'filter-wheel', position: 1, filterName: 'Dark', moving: false },
        },
      }),
      inspection({
        kind: 'observing-conditions',
        telemetry: {
          availability: 'complete',
          values: {
            kind: 'observing-conditions',
            temperatureC: 20,
            humidityPercent: 50,
            dewPointC: 10,
          },
        },
      }),
      inspection({
        kind: 'switch',
        telemetry: {
          availability: 'complete',
          values: {
            kind: 'switch',
            channels: [{
              id: 0,
              name: 'Output',
              description: 'Power output',
              value: 1,
              on: true,
              minimum: 0,
              maximum: 1,
              step: 1,
              writable: true,
            }],
          },
        },
      }),
    ]

    expect(devices.map((device) => currentDeviceView('rig-1', device, observedAt))).toEqual([
      {
        id: 'rig-1-camera-0',
        kind: 'camera',
        configuredName: 'camera slot',
        name: 'camera device',
        connection: 'connected',
        observedAt,
        status: {
          availability: 'complete',
          activity: 'reading',
          sensorTemperatureC: 18,
        },
      },
      {
        id: 'rig-1-telescope-0',
        kind: 'telescope',
        configuredName: 'telescope slot',
        name: 'telescope device',
        connection: 'connected',
        observedAt,
        status: {
          availability: 'complete',
          activity: 'parked',
          tracking: 'off',
          parking: 'parked',
          home: 'away',
        },
      },
      {
        id: 'rig-1-focuser-0',
        kind: 'focuser',
        configuredName: 'focuser slot',
        name: 'focuser device',
        connection: 'connected',
        observedAt,
        status: {
          availability: 'complete',
          activity: 'moving',
          position: 42,
          temperatureC: 12,
        },
      },
      {
        id: 'rig-1-filter-wheel-0',
        kind: 'filter-wheel',
        configuredName: 'filter-wheel slot',
        name: 'filter-wheel device',
        connection: 'connected',
        observedAt,
        status: {
          availability: 'complete',
          activity: 'idle',
          position: 1,
          filterName: 'Dark',
        },
      },
      {
        id: 'rig-1-observing-conditions-0',
        kind: 'observing-conditions',
        configuredName: 'observing-conditions slot',
        name: 'observing-conditions device',
        connection: 'connected',
        observedAt,
        status: {
          availability: 'complete',
          activity: 'reporting',
          temperatureC: 20,
          humidityPercent: 50,
          dewPointC: 10,
        },
      },
      {
        id: 'rig-1-switch-0',
        kind: 'switch',
        configuredName: 'switch slot',
        name: 'switch device',
        connection: 'connected',
        observedAt,
        status: {
          availability: 'complete',
          activity: 'reporting',
          channels: [{ id: 0, name: 'Output', value: 1, on: true }],
        },
      },
    ])
  })

  it('does not call a mount idle when slewing state is unavailable', () => {
    const mount = currentDeviceView('rig-1', inspection({
      kind: 'telescope',
      telemetry: {
        availability: 'partial',
        values: {
          kind: 'telescope',
          parked: false,
          tracking: false,
        },
      },
    }), observedAt)

    expect(mount.status).toMatchObject({
      availability: 'partial',
      activity: 'unknown',
    })
  })

  it('shows slewing ahead of tracking while a mount moves', () => {
    const mount = currentDeviceView('rig-1', inspection({
      kind: 'telescope',
      telemetry: {
        availability: 'complete',
        values: { kind: 'telescope', parked: false, slewing: true, tracking: true },
      },
    }), observedAt)

    expect(mount.status).toMatchObject({ activity: 'slewing', tracking: 'on' })
  })

  it.each(['focuser', 'filter-wheel'] as const)(
    'does not call a %s idle when movement is unavailable',
    (kind) => {
      const device = currentDeviceView('rig-1', inspection({
        kind,
        telemetry: { availability: 'partial', values: { kind, position: 1 } },
      }), observedAt)

      expect(device.status).toEqual({ availability: 'partial', activity: 'unknown', position: 1 })
    },
  )

  it('distinguishes unavailable switch channels from an observed empty channel list', () => {
    const unavailable = currentDeviceView('rig-1', inspection({
      kind: 'switch',
      telemetry: { availability: 'partial', values: { kind: 'switch' } },
    }), observedAt)
    const empty = currentDeviceView('rig-1', inspection({
      kind: 'switch',
      telemetry: { availability: 'complete', values: { kind: 'switch', channels: [] } },
    }), observedAt)

    expect(unavailable.status).toEqual({ availability: 'partial', activity: 'unknown' })
    expect(empty.status).toEqual({ availability: 'complete', activity: 'reporting', channels: [] })
  })

  it('distinguishes unsupported detail from unavailable device state', () => {
    const connectedDome = currentDeviceView('rig-1', inspection({
      kind: 'dome',
      telemetry: { availability: 'unavailable' },
    }), observedAt)
    const disconnectedCamera = currentDeviceView('rig-1', {
      ...inspection({ kind: 'camera', telemetry: { availability: 'unavailable' } }),
      connection: 'disconnected',
    }, observedAt)

    expect(connectedDome.status).toEqual({ availability: 'unsupported' })
    expect(disconnectedCamera.status).toEqual({ availability: 'unavailable' })
  })
})
