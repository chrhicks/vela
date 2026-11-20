import { Effect, Fiber, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { SweepId, type SweepColumnBody, type SweepFrameBody } from '../../state/entries.ts'
import type { RigState } from '../../state/rig.ts'
import { foldRig, wire } from '../../state/testing.ts'
import { raForHourAngle } from '../align/run.ts'
import { decodeConfig } from '../config.ts'
import { Feed } from '../feed/feed.ts'
import type { GotoResult } from '../pointing/goto.ts'
import { fromMount } from '../sky/coordinates.ts'
import { equatorialOfDate, horizontalOfDate } from '../sky/horizontal.ts'
import type { Taken } from '../sweep/frames.ts'
import { SweepSettings } from '../sweep/settings.ts'
import { Capturing } from './camera.ts'
import { MountGuiding } from './mount.ts'
import { hourAngleOfRa, RehearsalGoto } from './rehearse.ts'
import { RehearsalRunning, type Cancelled, type Routine } from './rehearsing.ts'
import { StartRunning } from './start.ts'
import { SweepFrames, SweepLog, SweepRecord, SweepRunSettings, sweepControls } from './sweep.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }

const fieldHalfHeightDegrees = 1.1
const pointingError = { altitudeDegrees: 0.3, azimuthDegrees: -0.2 }
const skyStars = 800

const horizonAt = (azimuthDegrees: number) => 15 + 10 * Math.sin((azimuthDegrees * Math.PI) / 180)

const mountReports = (rig: RigState | undefined, ra: number, dec: number, side: 'PIER_WEST' | 'PIER_EAST'): RigState => ({
  ...foldRig([wire('mount', 'EQUATORIAL_EOD_COORD', { RA: ra, DEC: dec }), wire('mount', 'TELESCOPE_PIER_SIDE', { PIER_WEST: side === 'PIER_WEST', PIER_EAST: side === 'PIER_EAST' })], rig),
  heardAt: Date.now(),
})

function readyRig(): RigState {
  const base = foldRig([wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), wire('mount', 'GEOGRAPHIC_COORD', { LAT: 33.45, LONG: 360 - 112.07, ELEV: 331 })])

  return mountReports(base, raForHourAngle(0, phoenix, Date.now()), 60, 'PIER_WEST')
}

const settings = decodeConfig(SweepSettings, { columnDegrees: 90, settleSeconds: 0, alertAfterFrames: 6 })

interface Options {
  readonly rig?: RigState
  readonly busy?: boolean
  readonly skyAnswer?: (take: number, fraction: number) => Taken | undefined
  readonly hangOnTake?: number
  readonly problemsAt?: ReadonlyArray<number>
  readonly alertGotoAt?: ReadonlyArray<number>
  readonly recordFails?: boolean
  readonly guiding?: boolean
}

type Logged =
  | { readonly kind: 'started'; readonly body: Readonly<Record<string, unknown>> }
  | { readonly kind: 'framed'; readonly body: SweepFrameBody }
  | { readonly kind: 'columned'; readonly body: SweepColumnBody }
  | { readonly kind: 'alerted'; readonly body: { readonly column: number; readonly text: string } }
  | { readonly kind: 'ended'; readonly body: { readonly ending: string; readonly columns: number } }

function setup({ rig = readyRig(), busy = false, skyAnswer, hangOnTake, problemsAt = [], alertGotoAt = [], recordFails = false, guiding = false }: Options = {}) {
  const logged: Array<Logged> = []
  const records: Array<{ readonly record: string; readonly line: unknown }> = []
  const targets: Array<{ readonly raHours: number; readonly decDegrees: number }> = []
  const truths: Array<{ readonly altitudeDegrees: number; readonly azimuthDegrees: number; readonly fraction: number }> = []
  const steps: Array<string> = []
  let current = rig
  let routine: Fiber.Fiber<void> | undefined
  let which: Routine | undefined
  let cancelling: Cancelled = 'stopped'
  let takes = 0
  let begun: number | undefined
  let ended = false
  let interrupted = false

  const trueSkyOf = () => {
    const coordinates = current.devices.mount.EQUATORIAL_EOD_COORD!.values
    const commanded = horizontalOfDate({ raHours: coordinates.RA, decDegrees: coordinates.DEC }, Date.now(), phoenix)

    return { altitudeDegrees: commanded.altitudeDegrees + pointingError.altitudeDegrees, azimuthDegrees: commanded.azimuthDegrees + pointingError.azimuthDegrees }
  }

  const frameOf = (take: number): Taken => {
    const truth = trueSkyOf()
    const fraction = Math.max(0, Math.min(1, (truth.altitudeDegrees + fieldHalfHeightDegrees - horizonAt(truth.azimuthDegrees)) / (2 * fieldHalfHeightDegrees)))

    truths.push({ ...truth, fraction })

    const answered = skyAnswer?.(take, fraction)

    if (answered !== undefined) return answered

    const centre = fromMount(
      (({ raHours, decDegrees }) => ({ raDegrees: raHours * 15, decDegrees }))(equatorialOfDate(truth.altitudeDegrees, truth.azimuthDegrees, Date.now(), phoenix)),
      new Date(),
    )
    const solved = fraction >= 0.8

    return {
      taken: 'measured',
      file: `horizon-sweep_light_${String(take).padStart(3, '0')}.fits`,
      answer: {
        file: `horizon-sweep_light_${String(take).padStart(3, '0')}.fits`,
        result: 'measured',
        solve: solved ? { solved: true, raDegrees: centre.raDegrees, decDegrees: centre.decDegrees, rotationDegrees: 12, scaleArcsecPerPixel: 1.2 } : { solved: false, reason: 'no star pattern matched' },
        stars: fraction === 0 ? { measured: false, reason: 'no stars' } : { measured: true, hfd: 3, count: Math.round(skyStars * fraction) },
        header: { 'DATE-OBS': new Date(Date.now() - 1000).toISOString(), EXPTIME: 2 },
      },
    }
  }

  const services = Layer.mergeAll(
    Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.never, current: Effect.sync(() => current) }),
    Layer.succeed(Capturing, { busy: Effect.succeed(busy), start: () => Effect.void, finished: Effect.succeed(undefined) }),
    Layer.succeed(StartRunning, { busy: Effect.succeed(false), began: () => Effect.void }),
    Layer.succeed(RehearsalRunning, {
      busy: Effect.sync(() => routine !== undefined),
      which: Effect.sync(() => which),
      began: (began, kind) => Effect.sync(() => void ((routine = began), (which = kind))),
      cancelled: Effect.sync(() => cancelling),
    }),
    Layer.succeed(RehearsalGoto, {
      to: target =>
        Effect.suspend((): Effect.Effect<GotoResult> => {
          targets.push(target)

          const hourAngle = hourAngleOfRa(target.raHours, phoenix, Date.now())

          current = mountReports(current, target.raHours, target.decDegrees, hourAngle > 0 ? 'PIER_EAST' : 'PIER_WEST')

          return Effect.succeed(alertGotoAt.includes(targets.length) ? { ok: false, refusal: 'alert', reason: 'the mount answered with an alert' } : { ok: true })
        }),
    }),
    Layer.succeed(MountGuiding, { stop: Effect.sync(() => (steps.push('guiding stopped'), guiding)), start: Effect.succeed(false) }),
    Layer.succeed(SweepFrames, {
      begin: exposureSeconds => Effect.sync(() => void ((begun = exposureSeconds), steps.push('begun'))),
      take: Effect.suspend(() => {
        takes += 1

        if (takes === hangOnTake) return Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => void (interrupted = true))))

        return Effect.succeed(frameOf(takes))
      }),
      problems: Effect.sync(() => (problemsAt.includes(takes) ? [`horizon-sweep_light_${takes}.fits was measured but not kept: EXDEV`] : [])),
      end: Effect.sync(() => void ((ended = true), steps.push('ended'))),
    }),
    Layer.succeed(SweepLog, {
      started: body => Effect.sync(() => void logged.push({ kind: 'started', body })),
      framed: body => Effect.sync(() => void logged.push({ kind: 'framed', body })),
      columned: body => Effect.sync(() => void logged.push({ kind: 'columned', body })),
      alerted: body => Effect.sync(() => void logged.push({ kind: 'alerted', body })),
      ended: body => Effect.sync(() => void logged.push({ kind: 'ended', body })),
    }),
    Layer.succeed(SweepRecord, {
      append: (record, _at, line) => (recordFails ? Effect.fail('the disk is full') : Effect.sync(() => void records.push({ record, line }))),
    }),
    Layer.succeed(SweepRunSettings, { sweep: settings, rigSilentAfterSeconds: 10, newId: Effect.succeed(SweepId.make('sweep-1')) }),
  )

  const press = (exposureSeconds = 2) => Effect.runPromise(Effect.flatMap(sweepControls, controls => controls.startSweep(exposureSeconds)).pipe(Effect.result, Effect.provide(services)))

  const frames = () => logged.filter((item): item is Extract<Logged, { kind: 'framed' }> => item.kind === 'framed').map(item => item.body)
  const columns = () => logged.filter((item): item is Extract<Logged, { kind: 'columned' }> => item.kind === 'columned').map(item => item.body)
  const alerts = () => logged.filter((item): item is Extract<Logged, { kind: 'alerted' }> => item.kind === 'alerted').map(item => item.body.text)

  return {
    logged,
    records,
    targets,
    truths,
    steps,
    press,
    frames,
    columns,
    alerts,
    finished: () => Effect.runPromise(Fiber.await(routine!)),
    cancel: (ending: Cancelled) => {
      cancelling = ending

      return Effect.runPromise(Fiber.interrupt(routine!))
    },
    exposure: () => begun,
    ended: () => ended,
    interrupted: () => interrupted,
    takes: () => takes,
    underWay: (count: number) => vi.waitFor(() => expect(takes).toBeGreaterThanOrEqual(count)),
  }
}

describe('Sweep', () => {
  it('refuses at the press, and moves and records nothing, for a silent rig, a mount not connected or without a site or position, and a rehearsal, sweep, run or Start going', async () => {
    const silent = { ...readyRig(), heardAt: Date.now() - 60_000 }
    const disconnected = { ...readyRig(), ...foldRig([wire('mount', 'CONNECTION', { CONNECT: false, DISCONNECT: true })], readyRig()), heardAt: Date.now() }
    const noSite = { ...foldRig([wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), wire('mount', 'EQUATORIAL_EOD_COORD', { RA: 1, DEC: 1 })]), heardAt: Date.now() }
    const noPosition = { ...foldRig([wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), wire('mount', 'GEOGRAPHIC_COORD', { LAT: 33.45, LONG: 247.93, ELEV: 331 })]), heardAt: Date.now() }
    const cases = [
      [setup({ rig: silent }), { code: 'rig-silent', seconds: 60 }],
      [setup({ rig: disconnected }), { code: 'not-connected', device: 'mount' }],
      [setup({ rig: noSite }), { code: 'not-reported', device: 'mount', property: 'GEOGRAPHIC_COORD' }],
      [setup({ rig: noPosition }), { code: 'not-reported', device: 'mount', property: 'EQUATORIAL_EOD_COORD' }],
      [setup({ busy: true }), { code: 'run-active' }],
    ] as const

    for (const [rig, refusal] of cases) {
      expect(await rig.press()).toMatchObject({ failure: { refusal } })
      expect([...rig.logged, ...rig.targets, ...rig.steps]).toEqual([])
    }
  })

  it('refuses a second press while the first sweep is going', async () => {
    const { press, cancel, underWay } = setup({ hangOnTake: 2 })

    expect(await press()).toMatchObject({ success: { code: 'sweeping' } })
    await underWay(2)
    expect(await press()).toMatchObject({ failure: { refusal: { code: 'sweep-active' } } })
    await cancel('stopped')
  })

  it('stops guiding first and starts the frames at the exposure pressed, and says so', async () => {
    const { press, finished, steps, exposure } = setup({ guiding: true })

    expect(await press(3)).toMatchObject({ success: { code: 'sweeping', columns: 4, exposureSeconds: 3, stoppedGuiding: true } })
    await finished()
    expect(steps.slice(0, 2)).toEqual(['guiding stopped', 'begun'])
    expect(exposure()).toBe(3)
  })

  it('finds the edge of a fake horizon in every column, within a step, taking only plain gotos between frames', async () => {
    const { press, finished, frames, columns, logged, targets, truths, steps } = setup()

    await press()
    await finished()

    expect(logged[0]).toEqual({ kind: 'started', body: { sweep: 'sweep-1', exposureSeconds: 2, columns: 4 } })
    expect(logged[logged.length - 1]).toEqual({ kind: 'ended', body: { sweep: 'sweep-1', columns: 4, ending: 'finished' } })
    expect(steps[steps.length - 1]).toBe('ended')
    expect(columns().map(column => column.azimuthDegrees)).toEqual([135, 45, 225, 315])

    for (const column of columns()) {
      expect(Math.abs(column.edgeAltitudeDegrees - horizonAt(column.azimuthDegrees))).toBeLessThanOrEqual(settings.stepDegrees)
      expect(column.frames).toBe(frames().filter(frame => frame.column === column.column).length)
    }

    expect(frames().length).toBeLessThan(40)
    expect(targets.length).toBeGreaterThan(frames().length)
    expect(truths).toHaveLength(frames().length)
  })

  it('classifies each frame from its star count against a baseline taken from the solved frames, and says why a frame did not solve', async () => {
    const { press, finished, frames } = setup()

    await press()
    await finished()

    const all = frames()
    const first = all[0]!

    expect(first.baseline).toBeUndefined()
    expect(first.class).toBe(first.solve.solved ? 'sky' : 'blocked')

    for (const frame of all.slice(1)) {
      expect(frame.baseline).toBeGreaterThan(0)
      expect(frame.class).toBe(frame.stars < 0.15 * frame.baseline! ? 'blocked' : frame.solve.solved && frame.stars >= 0.65 * frame.baseline! ? 'sky' : 'edge')
    }

    expect(all.some(frame => frame.class === 'blocked')).toBe(true)
    expect(all.filter(frame => !frame.solve.solved).every(frame => frame.solve.solved === false && frame.solve.reason.length > 0)).toBe(true)
    expect(all.filter(frame => frame.solve.solved).every(frame => frame.solve.solved && frame.solve.rotationDegrees === 12 && frame.solve.scaleArcsecPerPixel === 1.2)).toBe(true)
  })

  it('takes the pointing from the solve when it solved, and from the commanded position plus the offset of the last solve on the same pier side when it did not', async () => {
    const { press, finished, frames, truths } = setup()

    await press()
    await finished()

    const all = frames()

    for (const [index, frame] of all.entries()) {
      const truth = truths[index]!
      const solvedBefore = all.slice(0, index).some(earlier => earlier.solve.solved && earlier.TELESCOPE_PIER_SIDE === frame.TELESCOPE_PIER_SIDE)

      if (frame.solve.solved) expect(frame.pointing.source).toBe('solve')
      else expect(frame.pointing.source).toBe(solvedBefore ? 'commanded+offset' : 'commanded')

      if (frame.pointing.source !== 'commanded') {
        expect(Math.abs(frame.pointing.altitudeDegrees - truth.altitudeDegrees)).toBeLessThan(0.05)
        expect(Math.abs(frame.pointing.azimuthDegrees - truth.azimuthDegrees)).toBeLessThan(0.05)
      } else {
        expect(Math.abs(frame.pointing.altitudeDegrees - truth.altitudeDegrees)).toBeCloseTo(pointingError.altitudeDegrees, 1)
      }
    }

    expect(all.some(frame => frame.pointing.source === 'commanded+offset')).toBe(true)
  })

  it('records the commanded pose, the mount\'s reported position and pier side, and the time of each frame', async () => {
    const { press, finished, frames } = setup()

    await press()
    await finished()

    for (const frame of frames()) {
      expect(frame.file).toMatch(/^horizon-sweep_light_\d+\.fits$/)
      expect(frame.EQUATORIAL_EOD_COORD).toBeDefined()
      expect(frame.TELESCOPE_PIER_SIDE).toBe(frame.commanded.hourAngleDegrees > 0 ? 'PIER_EAST' : 'PIER_WEST')
      expect(frame.commanded.altitudeDegrees).toBeGreaterThanOrEqual(settings.floorDegrees)
      expect(Math.abs(frame.at - Date.now())).toBeLessThan(60_000)
    }
  })

  it('starts each column at the edge of the one before it, and the first at the first guess', async () => {
    const { press, finished, frames, columns } = setup()

    await press()
    await finished()

    const firstOf = (column: number) => frames().find(frame => frame.column === column)!

    expect(firstOf(0).commanded.altitudeDegrees).toBeCloseTo(settings.firstGuessDegrees, 6)

    for (const [index, column] of columns().slice(0, -1).entries()) expect(firstOf(index + 1).commanded.altitudeDegrees).toBeCloseTo(column.edgeAltitudeDegrees, 6)
  })

  it('appends each frame and each column as a line of the record, and goes on when the record cannot be written, with an alert', async () => {
    const written = setup()

    await written.press()
    await written.finished()

    expect(written.records.filter(item => item.record === 'frames').map(item => item.line)).toEqual(written.frames())
    expect(written.records.filter(item => item.record === 'columns').map(item => item.line)).toEqual(written.columns())

    const failing = setup({ recordFails: true })

    await failing.press()
    await failing.finished()

    expect(failing.columns()).toHaveLength(4)
    expect(failing.logged[failing.logged.length - 1]).toMatchObject({ kind: 'ended', body: { ending: 'finished' } })
    expect(failing.alerts().filter(text => text.includes('the disk is full')).length).toBe(failing.frames().length + 4)
  })

  it('publishes an alert after the set number of frames in one column and goes on', async () => {
    const { press, finished, alerts, columns, frames } = setup()

    await press()
    await finished()

    const long = columns().filter(column => column.frames >= settings.alertAfterFrames)

    expect(long.length).toBeGreaterThan(0)
    expect(alerts().filter(text => text.includes('no edge yet')).length).toBe(long.length)
    expect(frames().length).toBeGreaterThan(0)
  })

  it('records a frame the rig program refused to measure with an alert, and goes on with the next step', async () => {
    const { press, finished, frames, alerts, columns, logged } = setup({ skyAnswer: take => (take === 2 ? { taken: 'refused', file: 'horizon-sweep_light_002.fits', reason: 'not a frame name in the measure folder' } : undefined) })

    await press()
    await finished()

    const refused = frames().find(frame => frame.file === 'horizon-sweep_light_002.fits')!

    expect(refused.solve).toEqual({ solved: false, reason: 'the rig program did not measure it: not a frame name in the measure folder' })
    expect(refused.stars).toBe(0)
    expect(alerts().some(text => text.includes('was not measured: not a frame name in the measure folder'))).toBe(true)
    expect(columns()).toHaveLength(4)
    expect(logged[logged.length - 1]).toMatchObject({ kind: 'ended', body: { ending: 'finished' } })
  })

  it('turns a frame measured but not kept into an alert, and goes on', async () => {
    const { press, finished, alerts, columns } = setup({ problemsAt: [1, 3] })

    await press()
    await finished()

    expect(alerts().filter(text => text.includes('measured but not kept: EXDEV'))).toHaveLength(2)
    expect(columns()).toHaveLength(4)
  })

  it('takes a frame again from the same place when the exposure failed', async () => {
    let failedOnce = false
    const { press, finished, frames, alerts, targets } = setup({
      skyAnswer: () => {
        if (failedOnce) return undefined

        failedOnce = true

        return { taken: 'failed', reason: 'the exposure did not finish' }
      },
    })

    await press()
    await finished()

    expect(alerts().some(text => text.includes('a frame was not taken: the exposure did not finish'))).toBe(true)
    expect(frames()[0]!.commanded.altitudeDegrees).toBeCloseTo(settings.firstGuessDegrees, 6)
    expect(frames()[0]!.commanded.azimuthDegrees).toBeCloseTo(135, 6)
    expect(targets.length).toBeGreaterThan(frames().length)
  })

  it('ends with an alert, not as finished, when the capture run ends under it', async () => {
    const { press, finished, alerts, logged } = setup({ skyAnswer: take => (take === 3 ? { taken: 'ended', reason: 'the capture run ended: the camera has no CCD_EXPOSURE' } : undefined) })

    await press()
    await finished()

    expect(alerts()).toContain('the sweep cannot go on: the capture run ended: the camera has no CCD_EXPOSURE')
    expect(logged[logged.length - 1]).toMatchObject({ kind: 'ended', body: { ending: 'stopped' } })
  })

  it('keeps going when a move is answered with an alert, saying so on the frame', async () => {
    const { press, finished, alerts, frames, columns } = setup({ alertGotoAt: [5, 14] })

    await press()
    await finished()

    expect(alerts().some(text => text.includes('the mount answered with an alert'))).toBe(true)
    expect(columns()).toHaveLength(4)
    expect(frames().length).toBeGreaterThan(0)
  })

  it('ends when it is stopped in the middle of a column, with the ending the press gave, and sends no further move', async () => {
    for (const ending of ['stopped', 'pressed'] as const) {
      const { press, cancel, underWay, logged, targets, interrupted, ended, frames, columns } = setup({ hangOnTake: 4 })

      await press()
      await underWay(4)

      const gotos = targets.length

      await cancel(ending)

      expect(interrupted()).toBe(true)
      expect(ended()).toBe(true)
      expect(targets.length).toBe(gotos)
      expect(frames()).toHaveLength(3)
      expect(columns().length).toBeLessThan(4)
      expect(logged[logged.length - 1]).toMatchObject({ kind: 'ended', body: { sweep: 'sweep-1', ending } })
    }
  })
})
