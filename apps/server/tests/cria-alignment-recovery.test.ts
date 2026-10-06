import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CriaClient, CriaUncertainError } from '@vela/cria'
import { CaptureRetryableError } from '@vela/equipment'
import { ServiceFixture, serviceOrigin, token, serverNow, reading } from '../../../packages/cria/test/fixture.js'
import { createCriaEquipment } from '../src/cria/equipment.js'
import { createAlignmentController } from '../src/alignment/controller.js'
import { createTestCadence } from '../src/alignment/test-cadence.js'

function equipment(service: ServiceFixture, fetch = service.fetch) {
  const bindings = service.state.devices.map(({ id, kind, expectedName }) => ({ id, kind, expectedName }))

  const client = new CriaClient({
    baseUrl: serviceOrigin,
    token,
    storeId: service.state.storeId,
    devices: bindings,
    fetch,
    pollIntervalMs: 1,
    admissionTimeoutMs: 10,
    observationTimeoutMs: 10,
    eventReconnectMs: 5,
    eventMaxReconnectMs: 20,
  })

  onTestFinished(() => client.close())

  return {
    ...createCriaEquipment(client, bindings.map(binding => ({ ...binding, providerDeviceId: binding.id }))),
    client,
  }
}

describe('Cria alignment read recovery', () => {
  it.each(['transport', 'pointing-error', 'pointing-stale', 'camera-name-error'])(
    'retains the measured baseline through %s and resumes without another sweep', async interruption => {
    const service = new ServiceFixture()
    let interrupted = false
    let exposures = 0
    let ra = 10

    function updateReadings() {
      service.mount.fields = {
        ...service.mount.fields,
        rightAscensionHours: reading(ra / 15),
        declinationDegrees: reading(60),
        siderealTimeHours: reading(((exposures + 1) * 24) / 86164.0905),
        latitudeDegrees: reading(40),
        tracking: reading(true),
        coordinateSystem: reading(2),
      }
      service.camera.fields.name = reading(service.camera.expectedName)

      if (interrupted && interruption === 'pointing-error')
        service.mount.fields.rightAscensionHours.status = 'error'

      if (interrupted && interruption === 'pointing-stale')
        service.mount.fields.rightAscensionHours.status = 'stale'

      if (interrupted && interruption === 'camera-name-error')
        service.camera.fields.name.status = 'error'
    }

    updateReadings()

    const adapter = equipment(service, async (input, init) => {
      if (new URL(String(input)).pathname === '/v2/events' && interrupted && interruption === 'transport')
        throw new TypeError('Transient stream interruption')

      return service.fetch(input, init)
    })

    async function setInterrupted(value: boolean) {
      interrupted = value
      updateReadings()

      if (value && interruption === 'transport') {
        service.interrupt()
        await vi.waitFor(async () => expect(adapter.client.state()).rejects.toMatchObject({ reason: 'transport' }))
      } else {
        await service.publish()
        await vi.waitFor(async () => expect((await adapter.client.state()).state.sequence).toBe(service.state.sequence))
      }
    }

    const cadence = createTestCadence()

    const move = vi.fn(async (_id: string, rate: number, duration: number) => {
      ra += rate * duration
      updateReadings()
      await service.publish()
    })

    const pointing = vi.fn(async () => exposures >= 3 && interruption.startsWith('pointing-')
      ? adapter.acquisition.pointing('mount')
      : ({
      rightAscensionDegrees: ra,
      declinationDegrees: 60,
      siderealTimeDegrees: ((exposures + 1) * 360) / 86164.0905,
      latitudeDegrees: 40,
      tracking: true,
      coordinateSystem: 'j2000' as const,
    }))

    const controller = createAlignmentController({
      mode: 'offline',
      settings: { cameraId: 'camera', telescopeId: 'mount', exposureSeconds: 1, fieldHeightDegrees: 3 },
      hardware: {
        ...adapter.acquisition,
        pointing,
        move,
        async capture(options) {
          if (exposures < 3) {
            exposures++
            updateReadings()
            await service.publish()

            return {
              width: 2, height: 3, pixels: new Float64Array(6), color: { kind: 'mono' },
              capturedAt: new Date(serverNow - 4000 + exposures * 1000).toISOString(),
            }
          }

          const frame = await adapter.acquisition.capture(options)
          exposures++
          updateReadings()
          await service.publish()

          return frame
        },
      },
      now: () => serverNow - 3000 + exposures * 1000,
      renderPreview: async () => Buffer.from('preview'),
      waitForNextExposure: cadence.wait,
      solver: { solve: async (frame, hint) => ({
        status: 'solved', capturedAt: frame.capturedAt, raDegrees: hint.raDegrees, decDegrees: 60,
        wcs: {
          width: frame.width, height: frame.height, referenceX: 1.5, referenceY: 2,
          raDegrees: hint.raDegrees, decDegrees: 60, cd: [0.01, 0, 0, -0.01],
        },
      }) },
    })

    try {
      await controller.start('fixture', 'Fixture')
      await vi.waitFor(() => expect(controller.snapshot().phase).toBe('adjusting'))
      const baseline = controller.snapshot().measurement
      const measuredAt = controller.snapshot().measuredAt
      const initialMoves = move.mock.calls.length
      expect(baseline).not.toBeNull()
      await adapter.client.state()
      await setInterrupted(true)

      for (let attempt = 1; attempt <= 2; attempt++) {
        cadence.waits.shift()!()
        await vi.waitFor(() => expect(controller.snapshot().activity).toBe('retrying'))
        await vi.waitFor(() => expect(cadence.waits).toHaveLength(1))
        expect(controller.snapshot()).toMatchObject({ phase: 'adjusting', active: true, error: null, measuredAt })
        expect(controller.snapshot().measurement).toBe(baseline)
        expect(service.posts).toHaveLength(0)
        expect(move).toHaveBeenCalledTimes(initialMoves)
      }

      const pointingChecks = pointing.mock.calls.length
      await setInterrupted(false)
      cadence.waits.shift()!()
      await vi.waitFor(() => expect(controller.snapshot().measuredAt).not.toBe(measuredAt))
      expect(controller.snapshot()).toMatchObject({ phase: 'adjusting', active: true, warning: null, error: null })
      expect(service.posts).toHaveLength(1)
      expect(pointing.mock.calls.length).toBeGreaterThan(pointingChecks)
      expect(move).toHaveBeenCalledTimes(initialMoves)

      await setInterrupted(true)
      cadence.waits.shift()!()
      await vi.waitFor(() => expect(controller.snapshot().activity).toBe('retrying'))
      await vi.waitFor(() => expect(cadence.waits).toHaveLength(1))
      expect(await controller.stop()).toMatchObject({ phase: 'stopped', active: false, error: null })
      expect(cadence.waits).toHaveLength(0)
      expect(service.posts).toHaveLength(1)
    } finally {
      await controller.stop()
    }
  })

  it('never grants a capture retry after uncertain admission or unresolved driver ownership', async () => {
    const service = new ServiceFixture()
    let unavailable = false

    const adapter = equipment(service, async (input, init) => {
      const path = new URL(String(input)).pathname

      if (path === '/v2/events' && !unavailable) return service.fetch(input, init)

      if (path === '/v2/operations') {
        unavailable = true
        service.interrupt()
        await service.fetch(input, init)
      }

      throw new TypeError('Acknowledgement and reconciliation unavailable')
    })

    const capture = { cameraId: 'camera', exposureSeconds: 1 }
    await expect(adapter.acquisition.capture(capture)).rejects.toBeInstanceOf(CriaUncertainError)
    expect(service.posts).toHaveLength(1)
    await expect(adapter.acquisition.capture(capture)).rejects.not.toBeInstanceOf(CaptureRetryableError)
    expect(service.posts).toHaveLength(1)

    const blocked = new ServiceFixture()
    blocked.camera.blocked = true
    await expect(equipment(blocked).acquisition.capture(capture)).rejects.toBeInstanceOf(CriaUncertainError)
    expect(blocked.posts).toHaveLength(0)
  })
})
