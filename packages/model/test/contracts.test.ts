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
  RigDeviceView,
  RigEndpoint,
  RigId,
  RigReachability,
  RigServerView,
  RigView,
} from '../src/rig/index.js'
import type { HomeView } from '../src/web/index.js'

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
    expectTypeOf<RigView['capabilities']>().toEqualTypeOf<ReadonlyArray<RigCapability>>()
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
})
