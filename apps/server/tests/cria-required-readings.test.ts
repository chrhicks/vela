import { describe, expect, it } from 'vitest'
import { CriaClient, CriaUncertainError, type CriaReading } from '@vela/cria'
import { EquipmentError } from '@vela/equipment'
import { ServiceFixture, reading, serverNow, serviceOrigin, token } from '../../../packages/cria/test/fixture.js'
import { createCriaEquipment } from '../src/cria/equipment.js'

function fixture() {
  const service = new ServiceFixture()
  service.camera.fields = {
    ...service.camera.fields,
    sensorWidthPixels: reading(2),
    sensorHeightPixels: reading(3),
    pixelWidthMicrons: reading(3.76),
    pixelHeightMicrons: reading(3.76),
    binX: reading(1),
    binY: reading(1),
    startX: reading(0),
    startY: reading(0),
  }
  service.mount.fields = {
    ...service.mount.fields,
    rightAscensionHours: reading(4),
    declinationDegrees: reading(80),
    coordinateSystem: reading(1),
    tracking: reading(true),
    slewing: reading(false),
    parked: reading(false),
    latitudeDegrees: reading(40),
    longitudeDegrees: reading(-75),
    elevationMeters: reading(100),
    pierSide: reading(0),
    trackingRate: reading(0),
    rightAscensionRateSecondsPerSiderealSecond: reading(0),
    declinationRateArcsecondsPerSecond: reading(0),
  }

  const bindings = service.state.devices.map(({ id, kind, expectedName }) => ({ id, kind, expectedName }))

  const client = new CriaClient({
    baseUrl: serviceOrigin,
    token,
    storeId: service.state.storeId,
    devices: bindings,
    fetch: service.fetch,
    pollIntervalMs: 1,
    observationTimeoutMs: 10,
  })

  const adapter = createCriaEquipment(client, bindings.map(binding => ({ ...binding, providerDeviceId: binding.id })))

  return {
    service,
    geometry: () => adapter.framing.cameraGeometry({ cameraId: 'camera', expectedCameraName: service.camera.expectedName }),
    mount: () => adapter.framing.telescopeStatus('mount', undefined, { includeAlignmentObservations: true }),
  }
}

describe('Cria facts required by physical alignment', () => {
  it.each(['error', 'stale'] as const)('recovers camera geometry after a metadata %s', async status => {
    const subject = fixture()
    const original = subject.service.camera.fields.pixelWidthMicrons!
    subject.service.camera.fields.pixelWidthMicrons = { ...original, status }

    await expect(subject.geometry()).rejects.toMatchObject({ reason: 'transport' })
    subject.service.camera.fields.pixelWidthMicrons = original
    await expect(subject.geometry()).resolves.toMatchObject({ pixelWidthMicrons: 3.76, width: 2, height: 3 })
    expect(subject.service.posts).toHaveLength(0)
  })

  it.each([
    'rightAscensionHours', 'declinationDegrees', 'tracking', 'slewing', 'parked',
    'coordinateSystem', 'latitudeDegrees', 'longitudeDegrees', 'trackingRate',
    'rightAscensionRateSecondsPerSiderealSecond', 'declinationRateArcsecondsPerSecond',
    'elevationMeters', 'pierSide',
  ])('propagates an interrupted %s read and accepts its recovered value', async key => {
    const subject = fixture()
    const original = subject.service.mount.fields[key]!
    subject.service.mount.fields[key] = { ...original, status: 'error' }

    await expect(subject.mount()).rejects.toBeInstanceOf(EquipmentError)
    await expect(subject.mount()).rejects.toMatchObject({ reason: 'transport' })
    subject.service.mount.fields[key] = original
    await expect(subject.mount()).resolves.toMatchObject({
      coordinateSystem: 'topocentric', trackingRate: 'sidereal', latitudeDegrees: 40,
      longitudeDegrees: -75, elevationMeters: 100, pierSide: 'east',
      rightAscensionRateSecondsPerSiderealSecond: 0, declinationRateArcsecondsPerSecond: 0,
    })
    expect(subject.service.posts).toHaveLength(0)
  })

  it('keeps expired mount metadata retryable without substituting an unknown frame', async () => {
    const subject = fixture()
    subject.service.mount.fields.coordinateSystem = reading(1, serverNow - 70_000)

    await expect(subject.mount()).rejects.toMatchObject({ reason: 'transport' })
    subject.service.mount.fields.coordinateSystem = reading(1)
    await expect(subject.mount()).resolves.toMatchObject({ coordinateSystem: 'topocentric' })
  })

  it('omits explicitly unsupported elevation and pier side', async () => {
    const subject = fixture()
    subject.service.mount.fields.elevationMeters = { ...reading(null), status: 'unsupported' }
    subject.service.mount.fields.pierSide = { ...reading(null), status: 'unsupported' }

    const status = await subject.mount()
    expect(status).not.toHaveProperty('elevationMeters')
    expect(status.pierSide).toBe('unknown')
  })

  it.each([
    ['unsupported tracking rate', 'trackingRate', { ...reading(null), status: 'unsupported' }],
    ['malformed coordinate frame', 'coordinateSystem', reading('topocentric')],
    ['malformed location', 'latitudeDegrees', reading(400)],
    ['malformed optional elevation', 'elevationMeters', reading('unknown')],
    ['malformed pier side', 'pierSide', reading(0.5)],
    ['invalid required timestamp', 'tracking', { ...reading(true), observedAt: null }],
  ] satisfies [string, string, CriaReading][])(
    'rejects %s as a fatal response error', async (_description, key, value) => {
      const subject = fixture()
      subject.service.mount.fields[key] = value

      await expect(subject.mount()).rejects.toMatchObject({ reason: 'invalid-response' })
    },
  )

  it('rejects missing required geometry and unsupported required location', async () => {
    const subject = fixture()
    delete subject.service.camera.fields.binX
    subject.service.mount.fields.longitudeDegrees = { ...reading(null), status: 'unsupported' }

    await expect(subject.geometry()).rejects.toMatchObject({ reason: 'invalid-response' })
    await expect(subject.mount()).rejects.toMatchObject({ reason: 'invalid-response' })
  })

  it('keeps unresolved driver ownership fatal for physical read consumers', async () => {
    const subject = fixture()
    subject.service.mount.blocked = true
    subject.service.mount.reason = 'Driver ownership unresolved'

    await expect(subject.mount()).rejects.toBeInstanceOf(CriaUncertainError)
    await expect(subject.mount()).rejects.toMatchObject({ reason: 'protocol-error' })
    expect(subject.service.posts).toHaveLength(0)
  })
})
