import { describe, expect, it, vi } from 'vitest'
import type { TargetPosition } from '@vela/model/web'
import type { MonoFrame, PlateSolver, SolveResult } from '../plate-solving/solver.js'
import { projectSky } from '../plate-solving/solver.js'
import { correctedPointing, createFramingController, type FramingHardware, type FramingMount } from './framing.js'
import { angularDistance } from './sky.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })

  return { promise, resolve, reject }
}

const desired = { raDegrees: 10, decDegrees: 20 }

const at = '2026-09-07T04:00:00Z'

function solution(position = { raDegrees: 9, decDegrees: 20 }): SolveResult {
  return { status: 'solved', ...position, capturedAt: at,
    wcs: { width: 100, height: 80, referenceX: 50.5, referenceY: 40.5, ...position, cd: [-0.01, 0.002, 0.003, 0.01] } }
}

function workshop(wait: (signal: AbortSignal) => Promise<void> = async signal => { signal.throwIfAborted() }) {
  let date = new Date(at)
  const controller = createFramingController(() => date, wait)

  const mount: FramingMount = {
    rightAscensionDegrees: 10, declinationDegrees: 20, coordinateSystem: 'j2000', tracking: true,
    slewing: false, parked: false, observedAt: at, latitudeDegrees: 40, longitudeDegrees: -75,
  }

  const slews: TargetPosition[] = []
  const frame: MonoFrame = { width: 100, height: 80, pixels: new Float64Array(8000), capturedAt: at }

  const hardware: FramingHardware = {
    status: vi.fn(async signal => {
      signal?.throwIfAborted()

      return { ...mount }
    }),
    tracking: vi.fn(async (enabled, signal) => { signal.throwIfAborted(); mount.tracking = enabled }),
    slew: vi.fn(async (position, _frame, signal) => {
      signal.throwIfAborted()
      slews.push(position)
      mount.rightAscensionDegrees = position.raDegrees
      mount.declinationDegrees = position.decDegrees
    }),
    capture: vi.fn(async ({ signal }) => {
      signal.throwIfAborted()

      return frame
    }),
  }

  const solver: PlateSolver = { solve: vi.fn(async () => solution()) }

  const start = (input: { center?: boolean, check?: boolean, desired?: TargetPosition, configuration?: string } = {}) => {
    const finished = deferred<void>()
    const release = vi.fn(() => finished.resolve())
    const initial = controller.start({ desired: input.desired ?? desired, targetId: 'target', exposureSeconds: 2, configuration: input.configuration ?? 'camera+mount+focal-length', action: input.check ? 'check' : input.center ? 'center' : 'start' }, hardware, solver, release)

    return { initial, release, finished: finished.promise }
  }

  return { controller, hardware, solver, mount, slews, frame, start, advance: (milliseconds: number) => { date = new Date(date.getTime() + milliseconds) } }
}

describe('framing controller', () => {
  it('holds the operation lease through exposure and solving, shows actual WCS, and only corrects on an explicit next request', async () => {
    const fake = workshop()
    fake.mount.tracking = false
    const exposure = deferred<MonoFrame>()
    const exposing = deferred<void>()
    const solve = deferred<SolveResult>()
    const solving = deferred<void>()
    fake.hardware.capture = vi.fn(async () => {
      exposing.resolve()

      return exposure.promise
    })
    fake.solver.solve = vi.fn(async () => {
      solving.resolve()

      return solve.promise
    })
    const run = fake.start()
    await exposing.promise
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'exposing', active: true, actual: null })
    expect(run.release).not.toHaveBeenCalled()
    expect(fake.hardware.tracking).toHaveBeenCalledWith(true, expect.any(AbortSignal))
    exposure.resolve(fake.frame)
    await solving.promise
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'solving', active: true })
    expect(run.release).not.toHaveBeenCalled()
    const solved = solution()
    solve.resolve(solved)
    await run.finished
    const view = fake.controller.snapshot()
    expect(view).toMatchObject({ phase: 'checked', active: false, error: null, actual: { raDegrees: 9, decDegrees: 20, capturedAt: at } })
    expect(run.release).toHaveBeenCalledTimes(1)
    expect(fake.slews).toEqual([desired])
    expect(view.actual!.offsetArcminutes).toBeCloseTo(angularDistance(desired, { raDegrees: 9, decDegrees: 20 }) * 60, 10)
    expect(view.actual!.rotationDegrees).toBeCloseTo(-Math.atan2(0.002, 0.01) * 180 / Math.PI, 10)
    expect(solved.status).toBe('solved')

    if (solved.status !== 'solved') throw new Error('Expected fixture')

    for (const [index, [x, y]] of [[-0.5, -0.5], [99.5, -0.5], [99.5, 79.5], [-0.5, 79.5]].entries()) {
      const corner = projectSky(solved.wcs, view.actual!.corners[index]!)!
      expect(corner.x).toBeCloseTo(x!, 8)
      expect(corner.y).toBeCloseTo(y!, 8)
    }

    expect(fake.controller.canCenter(fake.mount, 'camera+mount+focal-length')).toBe(true)
    fake.solver.solve = vi.fn(async () => solution(desired))
    const center = fake.start({ center: true })
    expect(fake.controller.snapshot().actual).toEqual(view.actual)
    expect(fake.controller.checkCurrent(fake.mount, 'camera+mount+focal-length')).toBe(false)
    await center.finished
    expect(fake.slews).toHaveLength(2)
    expect(angularDistance(fake.slews[1]!, correctedPointing(desired, { raDegrees: 9, decDegrees: 20 }, desired))).toBeLessThan(1e-10)
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'checked', actual: { offsetArcminutes: 0 } })
    expect(fake.controller.canCenter(fake.mount, 'camera+mount+focal-length')).toBe(true)
  })

  it('reports the tangent-plane angle of a rotated non-square solved footprint', async () => {
    const fake = workshop()
    const angle = 40 * Math.PI / 180
    const solved = solution()

    if (solved.status !== 'solved') throw new Error('Expected fixture')
    solved.wcs = { ...solved.wcs, width: 2000, height: 1000, referenceX: 1000.5, referenceY: 500.5,
      cd: [-0.001 * Math.cos(angle), -0.001 * Math.sin(angle), -0.001 * Math.sin(angle), 0.001 * Math.cos(angle)] }
    fake.solver.solve = async () => solved
    await fake.start().finished
    const actual = fake.controller.snapshot().actual!
    expect(actual.rotationDegrees).toBeCloseTo(40, 10)
    // These are the actual plate edges, including the measured center offset.
    // The TAN projection makes angular spans slightly smaller than plane spans.
    expect(angularDistance(actual.corners[0]!, actual.corners[1]!)).toBeCloseTo(2, 3)
    expect(angularDistance(actual.corners[1]!, actual.corners[2]!)).toBeCloseTo(1, 3)
    const upperRight = projectSky(solved.wcs, actual.corners[2]!)!
    expect(upperRight.x).toBeCloseTo(1999.5, 8)
    expect(upperRight.y).toBeCloseTo(999.5, 8)
  })

  it('keeps the solved footprint and centering history through read recovery without another capture or correction', async () => {
    const fake = workshop()
    await fake.start({ check: true }).finished
    const previous = fake.controller.snapshot().actual
    const capture = deferred<Parameters<FramingHardware['capture']>[0]>()
    const frame = deferred<MonoFrame>()
    fake.hardware.capture = vi.fn(input => {
      capture.resolve(input)

      return frame.promise
    })
    fake.solver.solve = vi.fn(async () => solution(desired))
    const run = fake.start({ center: true })
    const pending = await capture.promise
    const history = fake.controller.snapshot().centering
    pending.onReadout()
    pending.onReadState('retrying')
    expect(fake.controller.snapshot()).toMatchObject({ active: true, phase: 'downloading', captureReadState: 'retrying', actual: previous, centering: history })
    expect(run.release).not.toHaveBeenCalled()
    pending.onReadState('current')
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'downloading', captureReadState: 'current', actual: previous, centering: history })
    expect(fake.solver.solve).not.toHaveBeenCalled()
    expect(fake.hardware.capture).toHaveBeenCalledOnce()
    expect(fake.slews).toHaveLength(1)
    frame.resolve(fake.frame)
    await run.finished
    pending.onReadState('retrying')
    pending.onReadout()
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'checked', captureReadState: 'current', active: false, centering: { outcome: 'centered', correction: 1 } })
    expect(fake.controller.snapshot().centering?.measurements).toHaveLength(2)
    expect(run.release).toHaveBeenCalledOnce()
  })

  it.each([
    { cleanup: new DOMException('Stopped', 'AbortError'), phase: 'stopped' },
    { cleanup: new Error('Camera cleanup unconfirmed'), phase: 'failed' },
  ])('holds the lease and history through Stop during read interruption until cleanup reports $phase', async ({ cleanup, phase }) => {
    const fake = workshop()
    await fake.start({ check: true }).finished
    const previous = fake.controller.snapshot().actual
    const capture = deferred<Parameters<FramingHardware['capture']>[0]>()
    const frame = deferred<MonoFrame>()
    fake.hardware.capture = vi.fn(input => {
      capture.resolve(input)

      return frame.promise
    })
    const run = fake.start({ center: true })
    const pending = await capture.promise
    pending.onReadState('retrying')
    const stopping = fake.controller.stop()
    pending.onReadState('retrying')
    pending.onReadout()
    expect(pending.signal.aborted).toBe(true)
    expect(fake.controller.snapshot()).toMatchObject({ active: true, phase: 'stopping', captureReadState: 'current', actual: previous })
    expect(run.release).not.toHaveBeenCalled()
    frame.reject(cleanup)
    await stopping
    pending.onReadState('retrying')
    expect(fake.controller.snapshot()).toMatchObject({ active: false, phase, captureReadState: 'current', actual: previous,
      centering: { outcome: 'interrupted', correction: 1, measurements: [expect.objectContaining({ checkId: previous!.checkId, capturedAt: previous!.capturedAt })] } })
    expect(fake.hardware.capture).toHaveBeenCalledOnce()
    expect(fake.slews).toHaveLength(1)
    expect(run.release).toHaveBeenCalledOnce()
  })

  it.each(['no-solution', 'solver-error'] as const)('never marks an unsuccessful solve as checked: %s', async failure => {
    const fake = workshop()
    fake.solver.solve = async () => {
      if (failure === 'solver-error') throw new Error('Solver failed to launch')

      return { status: 'no-solution' }
    }

    const run = fake.start()
    await run.finished
    expect(fake.controller.snapshot()).toMatchObject({ phase: failure === 'no-solution' ? 'needs-check' : 'failed', active: false, actual: null, error: expect.any(String) })
    expect(fake.controller.canCenter(fake.mount, 'camera+mount+focal-length')).toBe(false)
    expect(fake.slews).toHaveLength(1)
    expect(run.release).toHaveBeenCalledTimes(1)
  })

  it.each(['configuration', 'movement', 'expired', 'pointing-side'] as const)('rejects a stale centering check before commanding: %s', async cause => {
    const fake = workshop()
    fake.mount.pierSide = 'west'
    await fake.start().finished
    let configuration = 'camera+mount+focal-length'

    if (cause === 'configuration') configuration = 'replacement camera'

    if (cause === 'movement') fake.mount.rightAscensionDegrees += 0.1

    if (cause === 'expired') fake.advance(15 * 60_000)

    if (cause === 'pointing-side') fake.mount.pierSide = 'east'
    expect(fake.controller.canCenter(fake.mount, configuration)).toBe(false)
    const center = fake.start({ center: true, configuration })
    await center.finished
    expect(fake.slews).toHaveLength(1)
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'needs-check', active: false, error: expect.stringContaining('no longer matches') })
    expect(center.release).toHaveBeenCalledTimes(1)
  })

  it('rechecks fresh hardware before centering even when the displayed check was eligible', async () => {
    const fake = workshop()
    await fake.start().finished
    const configuration = 'camera+mount+focal-length'
    expect(fake.controller.canCenter(fake.mount, configuration)).toBe(true)
    const observed = deferred<FramingMount>()
    fake.hardware.status = vi.fn(() => observed.promise)
    const center = fake.start({ center: true })
    expect(fake.controller.snapshot().active).toBe(true)
    expect(fake.controller.canCenter(fake.mount, configuration)).toBe(false)
    expect(fake.slews).toHaveLength(1)
    observed.resolve({ ...fake.mount, tracking: false })
    await center.finished
    expect(fake.slews).toHaveLength(1)
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'needs-check', error: expect.stringContaining('no longer matches') })
  })

  it.each([desired, { raDegrees: 7, decDegrees: 20 }, { raDegrees: 10, decDegrees: 36.2 }])('keeps a current check usable across small and large offsets: %j', async position => {
    const fake = workshop()
    fake.solver.solve = async () => solution(position)
    await fake.start().finished
    expect(fake.controller.checkCurrent(fake.mount, 'camera+mount+focal-length')).toBe(true)
    expect(fake.controller.canCenter(fake.mount, 'camera+mount+focal-length')).toBe(true)
    fake.solver.solve = async () => solution(desired)
    await fake.start({ center: true }).finished
    expect(fake.slews).toHaveLength(position === desired ? 1 : 2)
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'checked', active: false, error: null })
  })

  it('checks the current frame without issuing a slew or tracking command', async () => {
    const fake = workshop()
    const edited = { raDegrees: 12, decDegrees: 23 }
    await fake.start({ check: true, desired: edited }).finished
    expect(fake.hardware.slew).not.toHaveBeenCalled()
    expect(fake.hardware.tracking).not.toHaveBeenCalled()
    expect(fake.hardware.capture).toHaveBeenCalledTimes(1)
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'checked', desired: edited })
  })

  it('applies the current solved correction to the newly edited destination', async () => {
    const fake = workshop()
    await fake.start().finished
    const checked = fake.controller.snapshot().actual!
    const edited = { raDegrees: 11.5, decDegrees: 19.7 }
    await fake.start({ center: true, desired: edited }).finished
    expect(angularDistance(fake.slews[1]!, correctedPointing(desired, checked, edited))).toBeLessThan(1e-10)
    expect(fake.controller.snapshot().desired).toEqual(edited)
    expect(fake.controller.snapshot().centering?.measurements[0]?.offsetArcminutes).toBeCloseTo(angularDistance(checked, edited) * 60, 8)
  })

  it.each(['west', 'unknown'] as const)('refines from each fresh solve through historical worsening and recovery; initial side=%s', async initialSide => {
    const fake = workshop()
    const offsets = [42.4, 86.4, 8.95, 2.38, 0.35]
    fake.mount.pierSide = initialSide
    fake.solver.solve = vi.fn(async () => {
      const solved = solution({ raDegrees: desired.raDegrees, decDegrees: desired.decDegrees + offsets[fake.slews.length]! / 60 })

      if (solved.status === 'solved' && fake.slews.length > 0) solved.wcs.cd = [0.01, -0.002, -0.003, -0.01]

      return solved
    })
    await fake.start({ check: true }).finished
    const originalSlew = fake.hardware.slew
    fake.hardware.slew = async (...args) => {
      await originalSlew(...args)

      if (initialSide === 'west') fake.mount.pierSide = 'east'
    }

    const run = fake.start({ center: true })
    await run.finished
    const view = fake.controller.snapshot()
    expect(view).toMatchObject({ phase: 'checked', active: false, centering: { outcome: 'centered', correction: 4, toleranceArcminutes: 0.5, maxCorrections: 4 } })
    expect(fake.slews).toHaveLength(4)
    let commandedDec = desired.decDegrees

    for (const [index, commanded] of fake.slews.entries()) {
      // All points lie on one meridian: the next command must subtract the last measured DEC error.
      commandedDec -= offsets[index]! / 60
      expect(commanded.raDegrees).toBeCloseTo(desired.raDegrees, 8)
      expect(commanded.decDegrees).toBeCloseTo(commandedDec, 8)
    }

    const samples = view.centering!.measurements
    expect(samples.map(sample => sample.trend)).toEqual(['starting', 'worsened', 'improved', 'improved', 'within-tolerance'])
    expect(samples[1]!.pointingSideChanged).toBe(initialSide === 'west')
    expect(new Set(samples.map(sample => sample.checkId)).size).toBe(5)
    expect(samples.map(sample => Number(sample.offsetArcminutes.toFixed(2)))).toEqual(offsets)
    expect(fake.hardware.capture).toHaveBeenCalledTimes(5)
    expect(run.release).toHaveBeenCalledTimes(1)
  })

  it.each([
    { offsets: [42.4, 53.8, 67.1], outcome: 'not-converging', moves: 2 },
    { offsets: [42.4, 30, 20, 10, 2], outcome: 'limit-reached', moves: 4 },
    { offsets: [42.4, 42.4, 42.4, 42.4, 42.4], outcome: 'limit-reached', moves: 4 },
  ])('bounds corrections and requires an explicit new check after $outcome ($offsets)', async ({ offsets, outcome, moves }) => {
    const fake = workshop()
    fake.solver.solve = async () => solution({ raDegrees: desired.raDegrees, decDegrees: desired.decDegrees + offsets[fake.slews.length]! / 60 })
    await fake.start({ check: true }).finished
    await fake.start({ center: true }).finished
    expect(fake.slews).toHaveLength(moves)
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'checked', active: false, centering: { outcome, correction: moves } })
    expect(fake.controller.checkCurrent(fake.mount, 'camera+mount+focal-length')).toBe(true)
    expect(fake.controller.canCenter(fake.mount, 'camera+mount+focal-length')).toBe(false)
    await fake.start({ check: true }).finished
    expect(fake.slews).toHaveLength(moves)
    expect(fake.controller.snapshot().centering).toBeNull()
    expect(fake.controller.canCenter(fake.mount, 'camera+mount+focal-length')).toBe(true)
  })

  it('does not derive a correction from a solve whose pointing side changed during exposure', async () => {
    const fake = workshop()
    fake.mount.pierSide = 'west'
    let captures = 0
    fake.hardware.capture = vi.fn(async () => {
      captures++

      if (captures === 1) fake.mount.pierSide = 'east'

      return fake.frame
    })
    await fake.start({ check: true }).finished
    expect(fake.hardware.capture).toHaveBeenCalledTimes(2)
    expect(fake.slews).toHaveLength(0)
    expect(fake.controller.checkCurrent(fake.mount, 'camera+mount+focal-length')).toBe(true)
  })

  it('treats omitted and explicitly unknown pointing sides as the same unavailable observation', async () => {
    const fake = workshop()
    let reads = 0
    fake.hardware.status = async () => {
      reads++

      if (reads > 8) throw new Error('Unnecessary settling retries')

      return reads % 2 === 0 ? { ...fake.mount, pierSide: 'unknown' } : { ...fake.mount }
    }

    await fake.start({ check: true }).finished
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'checked', pointingSide: 'unknown', error: null })
    expect(fake.hardware.capture).toHaveBeenCalledTimes(1)
  })

  it.each(['stop', 'uncertain-slew', 'solve-failed'] as const)('never schedules the next correction after %s', async reason => {
    const fake = workshop()
    await fake.start({ check: true }).finished
    const firstMeasurement = fake.controller.snapshot().actual
    const arrived = deferred<void>()

    if (reason === 'uncertain-slew') fake.hardware.slew = vi.fn(async () => { throw new Error('Slew outcome unknown') })
    else if (reason === 'solve-failed') fake.solver.solve = vi.fn<PlateSolver['solve']>(async () => ({ status: 'no-solution' }))
    else fake.hardware.capture = vi.fn(async ({ signal, onReadout }) => {
      onReadout?.()
      arrived.resolve()

      return new Promise<MonoFrame>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })

    const run = fake.start({ center: true })

    if (reason === 'stop') {
      await arrived.promise
      expect(fake.controller.snapshot()).toMatchObject({ active: true, phase: 'downloading', actual: firstMeasurement })
      expect(run.release).not.toHaveBeenCalled()
      await fake.controller.stop()
    }

    await run.finished
    expect(fake.controller.snapshot()).toMatchObject({ active: false, centering: { outcome: 'interrupted', correction: 1, measurements: [expect.objectContaining({ trend: 'starting' })] } })
    expect(fake.hardware.slew).toHaveBeenCalledTimes(1)
    expect(fake.controller.canCenter(fake.mount, 'camera+mount+focal-length')).toBe(false)
    expect(run.release).toHaveBeenCalledTimes(1)
  })

  it('retains the solved footprint and rechecks after changed mount readings without another slew', async () => {
    const fake = workshop()
    const changed = deferred<void>()
    const nextExposure = deferred<MonoFrame>()
    let captures = 0
    fake.hardware.capture = vi.fn(async () => ++captures === 1 ? fake.frame : nextExposure.promise)
    fake.solver.solve = vi.fn(async () => {
      if (captures === 1) {
        fake.mount.rightAscensionDegrees += 0.1
        changed.resolve()
      }

      return solution()
    })

    const run = fake.start()
    await changed.promise
    await vi.waitFor(() => expect(fake.hardware.capture).toHaveBeenCalledTimes(2))
    expect(fake.controller.snapshot()).toMatchObject({ active: true, actual: { raDegrees: 9, decDegrees: 20 } })
    expect(fake.slews).toHaveLength(1)
    expect(run.release).not.toHaveBeenCalled()
    nextExposure.resolve(fake.frame)
    await run.finished
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'checked', error: null })
    expect(fake.slews).toHaveLength(1)
  })

  it('waits for coordinate observations to settle even when Slewing is already false', async () => {
    const fake = workshop()
    let settlingReads = 0
    fake.hardware.status = vi.fn(async () => {
      if (fake.slews.length > 0) {
        settlingReads++
        // Reproduce a driver that changes DEC after declaring completion.
        fake.mount.declinationDegrees = settlingReads < 3 ? 50.5283 : 47.7542
      }

      return { ...fake.mount }
    })
    fake.hardware.capture = vi.fn(async () => {
      expect(settlingReads).toBeGreaterThanOrEqual(6)

      return fake.frame
    })
    await fake.start().finished
    expect(fake.hardware.capture).toHaveBeenCalledTimes(1)
    expect(fake.controller.snapshot().phase).toBe('checked')
  })

  it('stops a settling wait without taking an exposure or repeating the slew', async () => {
    const waiting = deferred<void>()

    const fake = workshop(signal => new Promise((_resolve, reject) => {
      waiting.resolve()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))

    const run = fake.start()
    await waiting.promise
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'settling', active: true })
    expect(run.release).not.toHaveBeenCalled()
    await fake.controller.stop()
    await run.finished
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'stopped', active: false })
    expect(fake.hardware.capture).not.toHaveBeenCalled()
    expect(fake.slews).toHaveLength(1)
  })

  it.each([false, true])('holds the lease until cancellation cleanup settles; cleanup failure=%s', async failedCleanup => {
    const fake = workshop()
    const moving = deferred<void>()
    const cancelled = deferred<void>()
    const cleanup = deferred<void>()
    fake.hardware.slew = async (_position, _frame, signal) => {
      moving.resolve()
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled.resolve(); resolve() }, { once: true }))
      await cleanup.promise

      if (failedCleanup) throw new Error('Telescope stop could not be confirmed')
      throw new DOMException('Slew cancellation confirmed', 'AbortError')
    }

    const run = fake.start()
    await moving.promise
    const stopped = fake.controller.stop()
    await cancelled.promise
    expect(fake.controller.snapshot()).toMatchObject({ phase: 'stopping', active: true })
    expect(run.release).not.toHaveBeenCalled()
    expect(fake.hardware.capture).not.toHaveBeenCalled()
    cleanup.resolve()
    await stopped
    await run.finished
    expect(run.release).toHaveBeenCalledTimes(1)
    expect(fake.controller.snapshot()).toMatchObject(failedCleanup
      ? { phase: 'failed', active: false, error: 'Telescope stop could not be confirmed' }
      : { phase: 'stopped', active: false, error: null })
    expect(fake.hardware.capture).not.toHaveBeenCalled()
  })

  it('does not expose after cancellation arrives during the tracking change', async () => {
    const fake = workshop()
    fake.mount.tracking = false
    const started = deferred<void>()
    fake.hardware.tracking = async (_enabled, signal) => {
      started.resolve()
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      signal.throwIfAborted()
    }

    const run = fake.start()
    await started.promise
    await fake.controller.stop()
    await run.finished
    expect(fake.slews).toHaveLength(0)
    expect(fake.hardware.capture).not.toHaveBeenCalled()
    expect(fake.controller.snapshot().phase).toBe('stopped')
  })
})

describe('geometric pointing correction', () => {
  it.each([
    [{ raDegrees: 312.5867, decDegrees: 47.35 }, { raDegrees: 312.7049, decDegrees: 31.1199 }],
    [{ raDegrees: 359.8, decDegrees: 0 }, { raDegrees: 0.2, decDegrees: 0 }],
    [{ raDegrees: 10, decDegrees: 89.8 }, { raDegrees: 220, decDegrees: 89.8 }],
    [{ raDegrees: 350, decDegrees: -89.8 }, { raDegrees: 140, decDegrees: -89.8 }],
  ])('maps measured pointing to desired pointing through RA wrap and poles', (actual, target) => {
    const correction = correctedPointing(actual, actual, target)
    expect(correction.raDegrees).toBeGreaterThanOrEqual(0)
    expect(correction.raDegrees).toBeLessThan(360)
    expect(angularDistance(correction, target)).toBeLessThan(1e-10)
    const companion = { raDegrees: 45, decDegrees: 60 }
    const rotatedCompanion = correctedPointing(companion, actual, target)
    expect(angularDistance(rotatedCompanion, target)).toBeCloseTo(angularDistance(companion, actual), 9)
  })

  it('preserves zero offset and refuses an ambiguous antipodal correction', () => {
    expect(angularDistance(correctedPointing(desired, desired, desired), desired)).toBeLessThan(1e-10)
    expect(() => correctedPointing(desired, { raDegrees: 0, decDegrees: 0 }, { raDegrees: 180, decDegrees: 0 })).toThrow('opposite')
  })
})
