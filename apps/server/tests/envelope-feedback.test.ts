import { afterEach, expect, it, vi } from 'vitest'
import { FakeCria } from '../../../packages/cria/test/v5/fake-cria.js'
import { createEquipmentComposition } from '../src/equipment/composition.js'
import { parseCriaConfiguration, registerConfiguredCriaRigs } from '../src/equipment/config.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'
import { defaultThresholds } from '../src/alerts/thresholds.js'
import { evaluateAlerts, type RigHistory } from '../src/alerts/rules.js'
import { judgedSolver, reportAcceptedFix, type MonoFrame } from '../src/plate-solving/judged-solver.js'
import { astapReturning, falseSolve, goodSolve, fieldHeightDegreesFor } from '../src/plate-solving/false-solve.js'
import type { Skyline } from '../src/targets/horizon.js'

afterEach(() => vi.useRealTimers())

it('sends the envelope on connection and change, every accepted fix, and uses that envelope for meridian alerts', async () => {
  vi.useFakeTimers()
  const fake = new FakeCria()

  const configurations = parseCriaConfiguration(JSON.stringify({ rigs: [{
    id: 'test-rig', name: 'Test rig', url: fake.origin,
    devices: [{ id: 'mount', kind: 'mount', expectedName: fake.nameOf('mount') }],
  }] }), {})

  const catalog = createMemoryRigCatalog()
  await registerConfiguredCriaRigs(catalog, configurations)
  const rig = (await catalog.get('test-rig'))!
  let skyline: Skyline = { stepDegrees: 180, bins: [{ kind: 'traced', altitudeDegrees: 20 }, { kind: 'unknown' }] }

  const equipment = createEquipmentComposition(configurations, {
    catalog,
    fetch: fake.fetch,
    thresholds: { ...defaultThresholds, meridianTrackLimitHours: 1 },
    horizon: { skyline: async () => skyline },
  })

  try {
    equipment.start()
    await vi.advanceTimersByTimeAsync(1500)
    expect(fake.feedback.get('mount')?.envelope).toEqual(equipment.envelopeFor(rig.id))
    expect(fake.feedback.get('mount')?.envelope?.horizon).toEqual([{ azimuthDegrees: 0, altitudeDegrees: 20 }])
    const sent = () => fake.received.filter(request => request.route === 'envelope').length
    expect(sent()).toBe(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent()).toBe(1)
    skyline = { ...skyline, bins: [{ kind: 'observed', altitudeDegrees: 30 }, { kind: 'unknown' }] }
    await vi.advanceTimersByTimeAsync(1000)
    expect(sent()).toBe(2)
    expect(fake.feedback.get('mount')?.envelope?.horizon?.[0]?.altitudeDegrees).toBe(30)

    const frame: MonoFrame = { width: 100, height: 80, pixels: new Float64Array(8000), capturedAt: '2026-09-07T04:00:00Z' }
    const claimed = { raDegrees: 10, decDegrees: 20 }

    for (const accepted of [true, false, true]) {
      const solution = accepted ? goodSolve(claimed, frame) : falseSolve(claimed, frame)
      const solver = reportAcceptedFix(judgedSolver(astapReturning(solution), fieldHeightDegreesFor(frame.height), 'framing'), fix => equipment.sendFix(rig, fix))
      await solver.solve(frame, claimed, claimed, new AbortController().signal)
    }

    await vi.waitFor(() => expect(fake.received.filter(request => request.route === 'fix')).toHaveLength(2))
    expect(fake.feedback.get('mount')?.fix).toMatchObject({ capturedAt: Date.parse(frame.capturedAt), rightAscensionDegrees: 10, declinationDegrees: 21, coordinateSystem: 'j2000', error: { scaleError: expect.any(Number) } })

    const history: RigHistory = {
      run: { status: 'running', exposureSeconds: 60, waitingForFrameSince: Date.now(), imaging: true },
      frames: [], observationsInterruptedSince: null,
      mountReadings: [{ slewing: false, parked: false, declinationDegrees: 20, latitudeDegrees: null, tracking: true, pierSide: 'west', rightAscensionHours: 0, siderealTimeHours: 0.95 }],
    }

    const alert = evaluateAlerts(history, defaultThresholds, Date.now(), equipment.envelopeFor(rig.id))
    expect(alert.conditions.map(condition => condition.id)).toContain('meridian-imminent')
    expect(evaluateAlerts(history, defaultThresholds, Date.now(), { ...equipment.envelopeFor(rig.id), meridianLimitDegrees: 30 }).conditions.map(condition => condition.id)).not.toContain('meridian-imminent')
    fake.restart()
    await vi.advanceTimersByTimeAsync(4000)
    expect(fake.feedback.get('mount')?.envelope).toEqual(equipment.envelopeFor(rig.id))
    expect(fake.feedback.get('mount')?.fix).toBeNull()
  } finally {
    await equipment.close()
    fake.close()
  }
})
