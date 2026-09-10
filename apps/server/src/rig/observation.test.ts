import { describe, expect, it } from 'vitest'
import type { RigDetailView, RigDeviceDetailView } from '@vela/model/web'
import { isConnectableDeviceKind, rigObservationView } from './observation.js'

function device(
  id: string,
  kind: RigDeviceDetailView['kind'],
  connection: 'connected' | 'disconnected' | 'unavailable',
): RigDeviceDetailView {
  const identity = { id: `rig-1-${id}`, kind, name: id, configuredName: id }

  if (connection === 'connected') {
    return {
      ...identity,
      connection,
      observedAt: '2026-09-04T20:00:00.000Z',
      status: { availability: 'unsupported' },
    } as RigDeviceDetailView
  }

  return {
    ...identity,
    connection,
    observedAt: '2026-09-04T20:00:00.000Z',
    status: { availability: 'unavailable' },
  } as RigDeviceDetailView
}

function rig(devices: ReadonlyArray<RigDeviceDetailView>, state: RigDetailView['state'] = 'reachable'): RigDetailView {
  return {
    id: 'rig-1',
    name: 'Backyard rig',
    state,
    endpoint: { host: 'alpaca.test', port: 11111 },
    addedAt: '2026-09-01T20:00:00.000Z',
    lastInventoryAt: '2026-09-04T20:00:00.000Z',
    refreshedAt: '2026-09-04T20:00:00.000Z',
    connections: {
      total: devices.length,
      connected: devices.filter(({ connection }) => connection === 'connected').length,
      disconnected: devices.filter(({ connection }) => connection === 'disconnected').length,
      unavailable: devices.filter(({ connection }) => connection === 'unavailable').length,
    },
    devices,
    capabilities: ['forget'],
  }
}

describe('Rig observation projection', () => {
  it('keeps the initial automatic-connection policy explicit', () => {
    const kinds: ReadonlyArray<RigDeviceDetailView['kind']> = [
      'camera',
      'cover-calibrator',
      'dome',
      'filter-wheel',
      'focuser',
      'observing-conditions',
      'rotator',
      'safety-monitor',
      'switch',
      'telescope',
      'unknown',
    ]

    expect(kinds.filter(isConnectableDeviceKind)).toEqual([
      'camera',
      'filter-wheel',
      'focuser',
      'observing-conditions',
      'switch',
      'telescope',
    ])
  })

  it('offers connection only for disconnected device kinds Vela currently operates', () => {
    const view = rigObservationView(rig([
      device('camera', 'camera', 'disconnected'),
      device('dome', 'dome', 'disconnected'),
      device('unknown', 'unknown', 'disconnected'),
    ]))

    expect(view.connectionPreparation).toEqual({
      state: 'available',
      capabilities: ['connect-devices'],
    })
  })

  it('calls preparation complete when only unsupported kinds remain disconnected', () => {
    const view = rigObservationView(rig([
      device('camera', 'camera', 'connected'),
      device('dome', 'dome', 'disconnected'),
      device('rotator', 'rotator', 'disconnected'),
    ]))

    expect(view.connectionPreparation).toEqual({ state: 'complete', capabilities: [] })
  })

  it('makes preparation unavailable when supported state cannot be confirmed or the Rig is offline', () => {
    expect(rigObservationView(rig([
      device('camera', 'camera', 'unavailable'),
      device('dome', 'dome', 'disconnected'),
    ])).connectionPreparation).toEqual({ state: 'unavailable', capabilities: [] })

    expect(rigObservationView(rig([], 'offline')).connectionPreparation).toEqual({
      state: 'unavailable',
      capabilities: [],
    })
  })

  it('projects server-owned progress without turning it into observing permission', () => {
    const view = rigObservationView(rig([
      device('camera', 'camera', 'disconnected'),
    ]), true)

    expect(view.connectionPreparation).toEqual({ state: 'in-progress', capabilities: [] })
    expect(view).not.toHaveProperty('canObserve')
  })
})
