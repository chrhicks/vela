import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FakeCria } from '../../../packages/cria/test/v5/fake-cria.js'
import { createPhysicalAlignment } from '../src/alignment/physical.js'
import { chooseSweepRate } from '../src/alignment/sweep.js'
import { createEquipmentComposition } from '../src/equipment/composition.js'
import { registerConfiguredCriaRigs, type CriaRigConfiguration } from '../src/equipment/config.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'

// The mount readings are the live ZWO AM5's on 2026-10-17: its INDI driver has no TELESCOPE_TRACK_RATE,
// so both tracking-rate offsets are unavailable as unsupported, and the pier side is unknown.
const am5Rates = [
  ['1x', 0.0010445185416666667],
  ['2x', 0.0020890370833333335],
  ['3x', 0.004178074166666667],
  ['4x', 0.008356148333333334],
  ['5x', 0.016712296666666668],
  ['6x', 0.033424593333333336],
  ['7x', 0.08356148333333334],
  ['8x', 0.25068445],
  ['9x', 3.0082134000000003],
  ['10x', 6.0164268000000005],
].map(([name, degreesPerSecond]) => ({ name, degreesPerSecond }))

let cria: FakeCria

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 3) })
  cria = new FakeCria()
})

afterEach(() => {
  cria.close()
  vi.useRealTimers()
})

async function open(tracking: boolean) {
  cria.deviceView = device => device.kind === 'mount'
    ? {
      ...device,
      readings: {
        ...device.readings,
        tracking: { status: 'fresh', value: tracking, observedAt: Date.now() },
        trackingRate: { status: 'fresh', value: 'sidereal', observedAt: Date.now() },
        pierSide: { status: 'fresh', value: 'unknown', observedAt: Date.now() },
        latitudeDegrees: { status: 'fresh', value: 39.755, observedAt: Date.now() },
        longitudeDegrees: { status: 'fresh', value: -74.267778, observedAt: Date.now() },
        elevationMeters: { status: 'fresh', value: 0, observedAt: Date.now() },
        rightAscensionRateSecondsPerSiderealSecond: { status: 'unavailable', reason: 'unsupported' },
        declinationRateArcsecondsPerSecond: { status: 'unavailable', reason: 'unsupported' },
        primaryAxisRates: { status: 'fresh', value: am5Rates, observedAt: Date.now() },
      },
    }
    : device

  const configuration: CriaRigConfiguration = {
    id: 'am5',
    name: 'AM5',
    url: cria.origin,
    devices: [
      { id: 'camera', kind: 'camera', expectedName: 'Fake CCD' },
      { id: 'mount', kind: 'mount', expectedName: 'ZWO AM5' },
      { id: 'focuser', kind: 'focuser', expectedName: 'Fake Focuser' },
    ],
    imagingCameraId: 'camera',
    focalLengthMm: 400,
  }

  const catalog = createMemoryRigCatalog()

  await registerConfiguredCriaRigs(catalog, [configuration])
  const composition = createEquipmentComposition([configuration], { fetch: cria.fetch })
  const rig = (await catalog.get('am5'))!

  composition.start()
  await vi.advanceTimersByTimeAsync(1000)

  return { composition, rig }
}

it('lets polar alignment read the AM5 it could not before, and picks 8x for the sweep', async () => {
  const { composition, rig } = await open(true)
  const framing = composition.createFraming(rig)
  const signal = new AbortController().signal

  const physical = createPhysicalAlignment(
    { cameraId: 'cria:am5:camera', cameraName: 'Fake CCD', telescopeId: 'cria:am5:mount', focalLengthMm: 400 },
    composition.createAcquisition(rig),
    framing,
    async () => {},
  )

  await expect(physical.validate(signal)).resolves.toMatchObject({
    pierSide: 'unknown',
    trackingRate: 'sidereal',
    rightAscensionRateSecondsPerSiderealSecond: 0,
    declinationRateArcsecondsPerSecond: 0,
    latitudeDegrees: 39.755,
  })

  const mount = await framing.telescopeStatus('cria:am5:mount', signal, { includeAlignmentObservations: true })

  expect(chooseSweepRate(mount)).toBeCloseTo(0.25068445)
  expect(cria.received.filter(request => request.route === 'submit')).toHaveLength(0)
  await composition.close()
})

it('reads the mount with tracking still off, as preparation does before it homes', async () => {
  const { composition, rig } = await open(false)

  await expect(
    composition.createFraming(rig).telescopeStatus('cria:am5:mount', undefined, { includeAlignmentObservations: true }),
  ).resolves.toMatchObject({ tracking: false, rightAscensionRateSecondsPerSiderealSecond: 0, declinationRateArcsecondsPerSecond: 0 })
  await composition.close()
})
