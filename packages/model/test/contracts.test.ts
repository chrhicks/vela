import { describe, expect, expectTypeOf, it } from 'vitest'
import packageJson from '../package.json'
import type {
  ConnectionStatus,
  DeviceKind,
  DeviceStatus,
  DeviceSummary,
} from '../src/device/index.js'
import type {
  DiscoveryCandidateDisposition,
  DiscoveryCandidateView,
  DiscoveryFailureReason,
  DiscoveryFailureView,
  DiscoveryResultView,
  IsoDateTime,
  RigCapability,
  RigDeviceConnectionSummary,
  RigDeviceView,
  RigEndpoint,
  RigId,
  RigReachability,
  RigServerView,
  RigState,
  RigView,
} from '../src/rig/index.js'
import type {
  HomeView,
  RigDetailView,
  RigDeviceDetailView,
  RigDeviceStatusAvailability,
} from '../src/web/index.js'

describe('@vela/model boundaries', () => {
  it('has no runtime package dependencies', () => {
    expect(packageJson).not.toHaveProperty('dependencies')
    expect(packageJson).not.toHaveProperty('peerDependencies')
    expect(packageJson).not.toHaveProperty('optionalDependencies')
  })

  it('exports the normalized device vocabulary', () => {
    expectTypeOf<DeviceKind>().toEqualTypeOf<
      | 'camera'
      | 'cover-calibrator'
      | 'dome'
      | 'filter-wheel'
      | 'focuser'
      | 'observing-conditions'
      | 'rotator'
      | 'safety-monitor'
      | 'switch'
      | 'telescope'
      | 'unknown'
    >()
    expectTypeOf<ConnectionStatus>().toEqualTypeOf<
      'connected' | 'disconnected' | 'unavailable'
    >()
    expectTypeOf<DeviceStatus>().toMatchTypeOf<{ readonly state: string }>()
    expectTypeOf<DeviceSummary['kind']>().toEqualTypeOf<DeviceKind>()
  })

  it('exports readonly Rig and discovery projections', () => {
    expectTypeOf<RigId>().toEqualTypeOf<string>()
    expectTypeOf<IsoDateTime>().toEqualTypeOf<string>()
    expectTypeOf<RigEndpoint>().toEqualTypeOf<{
      readonly host: string
      readonly port: number
    }>()
    expectTypeOf<RigReachability>().toEqualTypeOf<
      'reachable' | 'unreachable' | 'unknown'
    >()
    expectTypeOf<RigCapability>().toEqualTypeOf<'forget'>()
    expectTypeOf<RigState>().toEqualTypeOf<'reachable' | 'offline' | 'needs-attention'>()
    expectTypeOf<RigDeviceConnectionSummary>().toEqualTypeOf<{
      readonly total: number
      readonly connected: number
      readonly disconnected: number
      readonly unavailable: number
    }>()
    expectTypeOf<RigView['capabilities']>().toEqualTypeOf<ReadonlyArray<RigCapability>>()
    expectTypeOf<RigView['connections']>().toEqualTypeOf<RigDeviceConnectionSummary>()
    expectTypeOf<RigView['devices']>().toEqualTypeOf<ReadonlyArray<DeviceSummary>>()
    expectTypeOf<RigDeviceView['kind']>().toEqualTypeOf<DeviceKind>()
    expectTypeOf<RigServerView>().toMatchTypeOf<Readonly<Record<string, string | undefined>>>()
    expectTypeOf<DiscoveryCandidateDisposition>().toMatchTypeOf<{ readonly state: string }>()
    expectTypeOf<DiscoveryCandidateView['endpoint']>().toEqualTypeOf<RigEndpoint>()
    expectTypeOf<DiscoveryFailureReason>().toEqualTypeOf<
      'scan-failed' | 'unreachable' | 'invalid-response' | 'protocol-error'
    >()
    expectTypeOf<DiscoveryFailureView['endpoint']>().toEqualTypeOf<RigEndpoint | undefined>()
    expectTypeOf<DiscoveryResultView['candidates']>().toEqualTypeOf<
      ReadonlyArray<DiscoveryCandidateView>
    >()
    expectTypeOf<HomeView['rigs']>().toEqualTypeOf<ReadonlyArray<RigView>>()
  })

  it('exports a discriminated, browser-safe Rig detail view', () => {
    expectTypeOf<RigDeviceStatusAvailability>().toEqualTypeOf<
      'complete' | 'partial' | 'unavailable' | 'unsupported'
    >()
    expectTypeOf<RigDetailView['devices']>().toEqualTypeOf<
      ReadonlyArray<RigDeviceDetailView>
    >()

    const view = {
      id: 'rig-1',
      name: 'Backyard rig',
      state: 'reachable',
      endpoint: { host: 'ascom-remote.local', port: 11111 },
      addedAt: '2026-09-01T20:00:00.000Z',
      lastInventoryAt: '2026-09-02T20:00:00.000Z',
      refreshedAt: '2026-09-02T20:01:00.000Z',
      connections: { total: 2, connected: 1, disconnected: 1, unavailable: 0 },
      devices: [
        {
          id: 'rig-1-camera-0',
          kind: 'camera',
          name: 'Main camera',
          configuredName: 'Camera slot 1',
          connection: 'connected',
          observedAt: '2026-09-02T20:01:00.000Z',
          status: {
            availability: 'complete',
            activity: 'idle',
            sensorTemperatureC: -5,
            cooling: { state: 'on', powerPercent: 42 },
          },
        },
        {
          id: 'rig-1-telescope-0',
          kind: 'telescope',
          name: 'Mount',
          configuredName: 'Mount',
          connection: 'disconnected',
          observedAt: '2026-09-02T20:01:00.000Z',
          status: { availability: 'unavailable' },
        },
      ],
      capabilities: ['forget'],
    } as const satisfies RigDetailView

    expectTypeOf<{
      readonly id: 'camera-0'
      readonly kind: 'camera'
      readonly name: 'Camera'
      readonly configuredName: 'Camera'
      readonly connection: 'disconnected'
      readonly observedAt: IsoDateTime
      readonly status: { readonly availability: 'complete'; readonly activity: 'idle' }
    }>().not.toMatchTypeOf<RigDeviceDetailView>()
    expectTypeOf<{
      readonly id: 'camera-0'
      readonly kind: 'camera'
      readonly name: 'Camera'
      readonly configuredName: 'Camera'
      readonly connection: 'connected'
      readonly observedAt: IsoDateTime
      readonly status: { readonly availability: 'unavailable' }
    }>().not.toMatchTypeOf<RigDeviceDetailView>()

    expect(view.devices).toHaveLength(2)
  })
})
