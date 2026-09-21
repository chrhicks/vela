import { describe, expect, expectTypeOf, it } from 'vitest'
import packageJson from '../package.json'
import type { IsoDateTime } from '../src/rig/index.js'
import type {
  ConnectRigDevicesResult,
  RigConnectionDeviceView,
  RigConnectionPreparation,
  RigDetailView,
  RigDeviceDetailView,
  RigObservationView,
  AutofocusView,
} from '../src/web/index.js'

describe('@vela/model boundaries', () => {
  it('has no runtime package dependencies', () => {
    expect(packageJson).not.toHaveProperty('dependencies')
    expect(packageJson).not.toHaveProperty('peerDependencies')
    expect(packageJson).not.toHaveProperty('optionalDependencies')
  })

  it('exports a discriminated, browser-safe Rig detail view', () => {
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

    expectTypeOf(view).toMatchTypeOf<RigDetailView>()
  })

  it('keeps connection preparation distinct from future observing permission', () => {
    expectTypeOf<RigConnectionPreparation['state']>().toEqualTypeOf<
      'available' | 'complete' | 'in-progress' | 'unavailable'
    >()
    expectTypeOf<Extract<
      RigConnectionPreparation,
      { readonly state: 'available' }
    >['capabilities']>().toEqualTypeOf<readonly ['connect-devices']>()
    expectTypeOf<RigObservationView['rig']>().toEqualTypeOf<RigDetailView>()
    expectTypeOf<ConnectRigDevicesResult['outcome']>().toEqualTypeOf<
      'complete' | 'failed' | 'partial' | 'uncertain' | 'unavailable'
    >()

    expectTypeOf<Extract<
      ConnectRigDevicesResult,
      { readonly command: 'not-needed' }
    >['confirmedConnected']>().toEqualTypeOf<readonly []>()
    expectTypeOf<Extract<
      ConnectRigDevicesResult,
      { readonly outcome: 'failed' }
    >['confirmedConnected']>().toEqualTypeOf<readonly []>()
    expectTypeOf<Extract<
      ConnectRigDevicesResult,
      { readonly outcome: 'partial' }
    >['confirmedConnected'][0]>().toEqualTypeOf<RigConnectionDeviceView>()
    expectTypeOf<Extract<
      ConnectRigDevicesResult,
      { readonly outcome: 'failed' }
    >['failed']['reason']>().toEqualTypeOf<
      'connection-check-failed' | 'device-not-found' | 'rejected' | 'remained-disconnected'
    >()
    expectTypeOf<Extract<
      ConnectRigDevicesResult,
      { readonly outcome: 'uncertain' }
    >['uncertain']['reason']>().toEqualTypeOf<
      'cancelled' | 'verification-timeout' | 'verification-unavailable' | 'write-outcome-unknown'
    >()
  })

  it('keeps autofocus as one ephemeral Star-HFR walk around start, not a home to 0', () => {
    const view = {
      rigId: 'fra',
      rigName: 'Askar FRA 400',
      enabled: true,
      unavailableReason: null,
      cameraName: 'ASI2600MM Pro',
      focuserName: 'EAF',
      phase: 'walking',
      activity: 'exposing',
      captureReadState: 'current',
      active: true,
      startPosition: 32842,
      currentPosition: 33042,
      maxStep: 60000,
      stepSize: 50,
      offsetSteps: 4,
      exposureSeconds: 2,
      elapsedSeconds: 0.4,
      exposureStartedAt: '2026-09-17T00:00:00.000Z',
      samples: [{ position: 33042, detectedStars: 12, hfrPixels: 5.1, capturedAt: '2026-09-17T00:00:00.000Z' }],
      fit: null,
      restoredStart: false,
      error: null,
    } as const satisfies AutofocusView

    expectTypeOf(view).toMatchTypeOf<AutofocusView>()
    expectTypeOf<AutofocusView['startPosition']>().toEqualTypeOf<number | null>()
    expectTypeOf<AutofocusView['samples']>().toMatchTypeOf<ReadonlyArray<{
      position: number
      detectedStars: number
      hfrPixels: number | null
      capturedAt: string
    }>>()
  })
})
