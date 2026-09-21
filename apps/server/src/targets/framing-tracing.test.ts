import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { context, propagation, trace } from '@opentelemetry/api'
import { expect, it } from 'vitest'
import { startTelemetry } from '../telemetry.js'
import { createFramingController, type FramingHardware, type FramingMount } from './framing.js'
import type { PlateSolver } from '../plate-solving/solver.js'

it('persists exact centering inputs and correlated evidence before and after completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vela-framing-trace-'))
  const path = join(directory, 'framing.jsonl')
  const telemetry = startTelemetry(path)
  const at = new Date().toISOString()
  const desired = { raDegrees: 312.7049478964011, decDegrees: 31.119903318993448 }

  const mount: FramingMount = { rightAscensionDegrees: desired.raDegrees, declinationDegrees: desired.decDegrees,
    coordinateSystem: 'j2000', tracking: true, slewing: false, parked: false, observedAt: at,
    latitudeDegrees: 40, longitudeDegrees: -75, elevationMeters: 100, pierSide: 'west' }

  let moved = false
  let finishSolve!: () => void
  const solveGate = new Promise<void>(resolve => { finishSolve = resolve })
  let enteredSolve!: () => void
  const solving = new Promise<void>(resolve => { enteredSolve = resolve })

  const hardware: FramingHardware = {
    status: async () => ({ ...mount }),
    tracking: async enabled => { mount.tracking = enabled },
    slew: async position => {
      moved = true
      mount.rightAscensionDegrees = position.raDegrees
      mount.declinationDegrees = position.decDegrees
      mount.pierSide = 'east'
    },
    capture: async ({ onReadout }) => {
      onReadout?.()

      return { width: 100, height: 80, pixels: new Float64Array(8000), capturedAt: at, capturedAtSource: 'server-estimate' }
    },
  }

  const cd = [-0.00123456789123, 0.00002345678912, 0.00001234567891, 0.00123456789123] as const

  const solver: PlateSolver = { solve: async () => {
    if (moved) { enteredSolve(); await solveGate }

    const position = { ...desired, decDegrees: desired.decDegrees + (moved ? 0 : 42.4 / 60) }

    return { status: 'solved', ...position, capturedAt: at,
      wcs: { width: 100, height: 80, referenceX: 50.5, referenceY: 40.5, ...position, cd } }
  } }

  const controller = createFramingController(() => new Date(at), async signal => { signal.throwIfAborted() })

  const run = (action: 'check' | 'center') => new Promise<void>(resolve => controller.start({ desired, targetId: 'ngc6992',
    exposureSeconds: 20, configuration: 'camera-geometry-and-focal-length', action, rigId: 'review-rig', requestId: `request-${action}` }, hardware, solver, resolve))

  const records = async () => (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line))

  try {
    await run('check')
    const centering = run('center')
    await solving
    await telemetry.forceFlush()
    const live = await records()
    const started = live.find(record => record.name === 'framing.started' && record.attributes['framing.action'] === 'center')!
    expect(started.attributes).toMatchObject({ 'framing.desired.ra_degrees': desired.raDegrees,
      'framing.desired.dec_degrees': desired.decDegrees, 'rig.id': 'review-rig', 'http.request.id': 'request-center' })
    const requested = live.find(record => record.name === 'framing.move.requested')!
    expect(requested.traceId).toBe(started.traceId)
    expect(requested.attributes['framing.command.converted_at']).toBe(at)
    expect(JSON.parse(requested.attributes['framing.mount.before_move']).pierSide).toBe('west')
    const command = JSON.parse(requested.attributes['framing.command.driver'])
    expect(command.decDegrees).toBeCloseTo(desired.decDegrees - 42.4 / 60, 10)
    expect(live.some(record => record.name === 'framing.run' && record.traceId === started.traceId)).toBe(false)
    finishSolve()
    await centering
    await telemetry.forceFlush()
    const saved = await records()
    const solved = saved.find(record => record.name === 'framing.solved' && record.traceId === started.traceId)!
    expect(JSON.parse(solved.attributes['framing.solved.wcs']).cd).toEqual(cd)
    expect(solved.attributes['image.captured_at_source']).toBe('server-estimate')
    expect(JSON.parse(solved.attributes['framing.mount.at_exposure']).pierSide).toBe('east')
    expect(saved.find(record => record.name === 'framing.check-validation' && record.traceId === started.traceId)?.attributes['framing.check.current']).toBe(true)
    expect(saved.find(record => record.name === 'framing.correction.measured')?.attributes).toMatchObject({
      'framing.pointing_side_changed': true, 'framing.outcome': 'centered', 'framing.offset_arcminutes': 0 })
    expect(saved.find(record => record.name === 'framing.run' && record.traceId === started.traceId)?.attributes).toMatchObject({
      'framing.corrections': 1, 'framing.phase': 'checked', 'framing.outcome': 'centered' })
    expect(await readFile(path, 'utf8')).not.toContain('pixels')
  } finally {
    finishSolve()
    await controller.stop()
    await telemetry.shutdown()
    trace.disable()
    context.disable()
    propagation.disable()
    await rm(directory, { recursive: true, force: true })
  }
})
