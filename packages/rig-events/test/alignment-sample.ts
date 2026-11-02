import { epochMs, rigId, seal, sourceId, type Draft, type Envelope } from '@vela/rig-events'

const runId = '2bfbf00c-acf2-4bf2-9ee3-09a08615b7b8'

const stamp = (at: number) => ({ rig: rigId('test-rig'), source: sourceId('vela:alignment'), at: epochMs(at), seenAt: epochMs(at) })

const at = 1_792_000_000_000

export const runDraft: Draft<Envelope<'alignment'>> = {
  ...stamp(at),
  kind: 'alignment',
  body: {
    type: 'run',
    runId,
    n: 1,
    folder: `${runId}-aBcDeF`,
    rigName: 'Test rig',
    mode: 'offline',
    cameraId: 'camera',
    telescopeId: 'mount',
    cameraName: 'Test camera',
    exposureSeconds: 2,
    simulator: { latitudeDegrees: 40, siderealTimeDegrees: 211.75, at: '2026-10-26T23:38:00.000Z' },
  },
}

const mount = {
  rightAscensionDegrees: 91.5,
  declinationDegrees: 10.25,
  coordinateSystem: 'topocentric',
  tracking: true,
  slewing: false,
  parked: false,
  observedAt: '2026-10-26T23:38:36.000Z',
} as const

export const frameDraft: Draft<Envelope<'alignment'>> = {
  ...stamp(at + 1),
  kind: 'alignment',
  body: {
    type: 'frame',
    runId,
    n: 2,
    original: { filename: 'baseline-11111111-1111-4111-8111-111111111111.fits', bytes: 2880, sha256: 'a'.repeat(64) },
    capture: { width: 64, height: 48, capturedAt: '2026-10-26T23:38:35.936Z', capturedAtSource: 'camera', color: { kind: 'mono' } },
    evidence: {
      phase: 'baseline',
      position: 1,
      solution: {
        raDegrees: 91.5,
        decDegrees: 10.25,
        capturedAt: '2026-10-26T23:38:35.936Z',
        wcs: { width: 64, height: 48, referenceX: 32.5, referenceY: 24.5, raDegrees: 91.5, decDegrees: 10.25, cd: [-5.2e-6, 0.000535, -0.000535, -5.6e-6] },
      },
      sample: { raDegrees: 91.5, decDegrees: 10.25, capturedAt: '2026-10-26T23:38:36.936Z' },
      hint: { raDegrees: 91.4, decDegrees: 10.2 },
      fieldHeightDegrees: 2.5,
      physical: {
        camera: { cameraName: 'Test camera', sensorWidthPixels: 64, sensorHeightPixels: 48, pixelWidthMicrons: 3.76, pixelHeightMicrons: 3.76, binX: 1, binY: 1, width: 64, height: 48, startX: 0, startY: 0 },
        before: mount,
        after: mount,
      },
    },
  },
}

export const alignmentEvents = [seal(runDraft), seal(frameDraft)]
