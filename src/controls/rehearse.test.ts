import { Effect, Fiber, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { RehearsalId, type SweepMoveBody } from '../../state/entries.ts'
import type { RigState } from '../../state/rig.ts'
import { foldRig, wire } from '../../state/testing.ts'
import { decodeConfig } from '../config.ts'
import { Feed } from '../feed/feed.ts'
import { makeGoto, type GotoResult } from '../pointing/goto.ts'
import { makePicture } from '../rig/picture.ts'
import { poseAt, poseOfAxes, rehearsalPath, rehearsalRoute } from '../sweep/path.ts'
import { SweepSettings } from '../sweep/settings.ts'
import { startedAt, wire as streamWire } from '../testing/entries.ts'
import { Capturing } from './camera.ts'
import { hourAngleOfRa, rehearsalControls, rehearsalGoto, RehearsalGoto, RehearsalLog, RehearsalSettings } from './rehearse.ts'
import { RehearsalRunning, type Cancelled } from './rehearsing.ts'
import { StartRunning } from './start.ts'
import { raForHourAngle } from '../align/run.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const sweep = decodeConfig(SweepSettings, {})

const mountReports = (rig: RigState | undefined, ra: number, dec: number, side: 'PIER_WEST' | 'PIER_EAST'): RigState => ({
  ...foldRig([wire('mount', 'EQUATORIAL_EOD_COORD', { RA: ra, DEC: dec }), wire('mount', 'TELESCOPE_PIER_SIDE', { PIER_WEST: side === 'PIER_WEST', PIER_EAST: side === 'PIER_EAST' })], rig),
  heardAt: Date.now(),
})

const wrapped = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180

const hourAngleRa = (hourAngle: number) => raForHourAngle(hourAngle, phoenix, Date.now())

function readyRig(hourAngle = 0, dec = 60): RigState {
  const base = foldRig([
    wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false }),
    wire('mount', 'GEOGRAPHIC_COORD', { LAT: 33.45, LONG: 360 - 112.07, ELEV: 331 }),
  ])

  return mountReports(base, hourAngleRa(hourAngle), dec, hourAngle > 0 ? 'PIER_EAST' : 'PIER_WEST')
}

interface Options {
  readonly rig?: RigState
  readonly capturing?: boolean
  readonly startGoing?: boolean
  readonly rehearsalGoing?: boolean
  readonly alertAt?: ReadonlyArray<number>
  readonly refuseAt?: ReadonlyArray<number>
  readonly hangAt?: number
}

type Logged = { readonly kind: 'started' | 'moved' | 'ended'; readonly body: Readonly<Record<string, unknown>> }

function setup({ rig = readyRig(), capturing = false, startGoing = false, rehearsalGoing = false, alertAt = [], refuseAt = [], hangAt }: Options = {}) {
  const logged: Array<Logged> = []
  const targets: Array<{ readonly raHours: number; readonly decDegrees: number }> = []
  let current = rig
  let routine: Fiber.Fiber<void> | undefined
  let cancelling: Cancelled = 'pressed'
  let interrupted = false

  const goto = Layer.succeed(RehearsalGoto, {
    to: target =>
      Effect.suspend((): Effect.Effect<GotoResult> => {
        targets.push(target)

        const move = targets.length

        if (move === hangAt) return Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => void (interrupted = true))))

        const hourAngle = hourAngleOfRa(target.raHours, phoenix, Date.now())

        current = mountReports(current, target.raHours, target.decDegrees, hourAngle > 0 ? 'PIER_EAST' : 'PIER_WEST')

        if (alertAt.includes(move)) return Effect.succeed({ ok: false, refusal: 'alert', reason: 'the mount answered with an alert' })
        if (refuseAt.includes(move)) return Effect.succeed({ ok: false, refusal: 'coordinates', reason: 'EQUATORIAL_EOD_COORD refused' })

        return Effect.succeed({ ok: true })
      }),
  })

  const services = Layer.mergeAll(
    Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.never, current: Effect.sync(() => current) }),
    Layer.succeed(Capturing, { busy: Effect.succeed(capturing), start: () => Effect.void, finished: Effect.succeed(undefined) }),
    Layer.succeed(StartRunning, { busy: Effect.succeed(startGoing), began: () => Effect.void }),
    Layer.succeed(RehearsalRunning, { busy: Effect.sync(() => rehearsalGoing || routine !== undefined), began: began => Effect.sync(() => void (routine = began)), cancelled: Effect.sync(() => cancelling) }),
    goto,
    Layer.succeed(RehearsalLog, {
      started: body => Effect.sync(() => void logged.push({ kind: 'started', body })),
      moved: body => Effect.sync(() => void logged.push({ kind: 'moved', body })),
      ended: body => Effect.sync(() => void logged.push({ kind: 'ended', body })),
    }),
    Layer.succeed(RehearsalSettings, { sweep, rigSilentAfterSeconds: 10, newId: Effect.succeed(RehearsalId.make('rehearsal-1')) }),
  )

  const press = () => Effect.runPromise(Effect.flatMap(rehearsalControls, controls => controls.rehearseSweep).pipe(Effect.result, Effect.provide(services)))

  const cancel = (ending: Cancelled) => {
    cancelling = ending

    return Effect.runPromise(Fiber.interrupt(routine!))
  }

  const moves = () => logged.filter(item => item.kind === 'moved').map(item => item.body as unknown as SweepMoveBody)

  return { logged, targets, press, cancel, moves, finished: () => Effect.runPromise(Fiber.await(routine!)), interrupted: () => interrupted, underWay: (count: number) => vi.waitFor(() => expect(targets.length).toBeGreaterThanOrEqual(count)) }
}

describe('Rehearse sweep', () => {
  it('refuses at the press, and sends and records nothing, for a silent rig, a mount that is not connected, a site or position not reported, and a run, a Start or another rehearsal going', async () => {
    const silent = { ...readyRig(), heardAt: Date.now() - 60_000 }
    const disconnected = { ...readyRig(), ...foldRig([wire('mount', 'CONNECTION', { CONNECT: false, DISCONNECT: true })], readyRig()), heardAt: Date.now() }
    const noSite = { ...foldRig([wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), wire('mount', 'EQUATORIAL_EOD_COORD', { RA: 1, DEC: 1 })]), heardAt: Date.now() }
    const noPosition = { ...foldRig([wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), wire('mount', 'GEOGRAPHIC_COORD', { LAT: 33.45, LONG: 247.93, ELEV: 331 })]), heardAt: Date.now() }
    const cases = [
      [setup({ rig: silent }), { code: 'rig-silent', seconds: 60 }],
      [setup({ rig: disconnected }), { code: 'not-connected', device: 'mount' }],
      [setup({ rig: noSite }), { code: 'not-reported', device: 'mount', property: 'GEOGRAPHIC_COORD' }],
      [setup({ rig: noPosition }), { code: 'not-reported', device: 'mount', property: 'EQUATORIAL_EOD_COORD' }],
      [setup({ capturing: true }), { code: 'run-active' }],
      [setup({ startGoing: true }), { code: 'run-active' }],
      [setup({ rehearsalGoing: true }), { code: 'rehearsal-active' }],
    ] as const

    for (const [rig, refusal] of cases) {
      expect(await rig.press()).toMatchObject({ failure: { refusal } })
      expect([...rig.logged, ...rig.targets]).toEqual([])
    }
  })

  it('refuses a second press while the first rehearsal is going', async () => {
    const { press, cancel, underWay } = setup({ hangAt: 2 })

    expect(await press()).toMatchObject({ success: { code: 'rehearsing-sweep' } })
    await underWay(2)
    expect(await press()).toMatchObject({ failure: { refusal: { code: 'rehearsal-active' } } })
    await cancel('stopped')
  })

  it('chains legs from a far-off pose to the first pose, none turning an axis more than the leg limit', async () => {
    const { press, finished, moves, targets } = setup({ rig: readyRig(120, 80) })
    const from = poseOfAxes({ hourAngleDegrees: 120, declinationDegrees: 80 }, phoenix)
    const route = rehearsalRoute(from, phoenix, sweep)

    expect(await press()).toMatchObject({ success: { code: 'rehearsing-sweep', moves: route.length } })
    await finished()

    const chain = route.findIndex(move => move.pose.altitudeDegrees === 2 && move.pose.azimuthDegrees === 172.5) + 1
    let previous = from

    expect(chain).toBeGreaterThan(10)
    expect(moves()[chain - 1]).toMatchObject({ altitudeDegrees: 2, azimuthDegrees: 172.5 })
    expect(moves()[chain - 1]!.hourAngleDegrees).toBeCloseTo(-12.7759785, 6)

    for (const [index, target] of targets.slice(0, chain).entries()) {
      const hourAngle = hourAngleOfRa(target.raHours, phoenix, Date.now())

      expect(Math.abs(wrapped(hourAngle - previous.hourAngleDegrees))).toBeLessThanOrEqual(sweep.legDegrees + 0.01)
      expect(Math.abs(target.decDegrees - previous.declinationDegrees)).toBeLessThanOrEqual(sweep.legDegrees + 0.01)
      previous = route[index]!.pose
    }
  })

  it('visits every pose of the route in order with the right ascension worked out from its hour angle, and records each move', async () => {
    const { press, finished, moves, targets, logged } = setup({ rig: readyRig(-60, 20) })
    const from = poseOfAxes({ hourAngleDegrees: -60, declinationDegrees: 20 }, phoenix)
    const route = rehearsalRoute(from, phoenix, sweep)

    await press()
    await finished()

    expect(logged[0]).toEqual({ kind: 'started', body: { rehearsal: 'rehearsal-1', total: route.length } })
    expect(logged[logged.length - 1]).toEqual({ kind: 'ended', body: { rehearsal: 'rehearsal-1', total: route.length, ending: 'finished' } })
    expect(targets).toHaveLength(route.length)
    expect(moves().map(move => move.move)).toEqual(route.map((_, index) => index + 1))

    for (const [index, move] of route.entries()) {
      const target = targets[index]!
      const body = moves()[index]!

      expect(Math.abs(wrapped(hourAngleOfRa(target.raHours, phoenix, Date.now()) - move.pose.hourAngleDegrees))).toBeLessThan(0.05)
      expect(target.decDegrees).toBeCloseTo(move.pose.declinationDegrees, 3)
      expect(body).toMatchObject({ rehearsal: 'rehearsal-1', total: route.length, column: move.column, flipExpected: move.flipExpected, predictedPierSide: move.pose.predictedPierSide, outcome: 'arrived' })
      expect(body.altitudeDegrees).toBeCloseTo(move.pose.altitudeDegrees, 3)
      expect(body.azimuthDegrees).toBeCloseTo(move.pose.azimuthDegrees, 3)
      expect(body.hourAngleDegrees).toBeCloseTo(move.pose.hourAngleDegrees, 3)
      expect(body.declinationDegrees).toBeCloseTo(move.pose.declinationDegrees, 3)
    }
  })

  it('walks the whole rehearsal path after the chain, column by column', async () => {
    const path = rehearsalPath(phoenix, sweep)
    const { press, finished, moves } = setup({ rig: readyRig(path[0]!.pose.hourAngleDegrees, path[0]!.pose.declinationDegrees) })

    await press()
    await finished()

    const reached = moves()

    expect(reached).toHaveLength(path.length)
    expect([...new Set(reached.map(move => move.column))]).toEqual(Array.from({ length: 24 }, (_, index) => index))
  })

  it("records what the mount reports on arrival, its EQUATORIAL_EOD_COORD and TELESCOPE_PIER_SIDE, and the flip when the pier side changes", async () => {
    const { press, finished, moves } = setup({ rig: readyRig(120, 80) })

    await press()
    await finished()

    const reached = moves()
    const flip = reached.find(move => move.flipExpected)!
    const before = reached[reached.indexOf(flip) - 1]!

    expect(reached.every(move => move.EQUATORIAL_EOD_COORD !== undefined && move.TELESCOPE_PIER_SIDE !== undefined)).toBe(true)
    expect(before.TELESCOPE_PIER_SIDE).toBe('PIER_EAST')
    expect(flip.TELESCOPE_PIER_SIDE).toBe('PIER_WEST')
    expect(flip.EQUATORIAL_EOD_COORD?.DEC).toBeCloseTo(flip.declinationDegrees, 9)
    expect(reached.filter(move => move.flipExpected).length).toBeGreaterThanOrEqual(1)
  })

  it('records a move the mount answers with an alert, and goes on with the next pose', async () => {
    const { press, finished, moves, logged, targets } = setup({ alertAt: [2], refuseAt: [4] })

    await press()
    await finished()

    const reached = moves()

    expect(reached[1]).toMatchObject({ move: 2, outcome: 'alert', reason: 'the mount answered with an alert' })
    expect(reached[3]).toMatchObject({ move: 4, outcome: 'refused', reason: 'EQUATORIAL_EOD_COORD refused' })
    expect(reached.filter(move => move.outcome === 'arrived')).toHaveLength(reached.length - 2)
    expect(targets).toHaveLength(reached.length)
    expect(logged[logged.length - 1]).toMatchObject({ kind: 'ended', body: { ending: 'finished' } })
  })

  it('ends when it is stopped, in the middle of a move, with the ending the press gave', async () => {
    for (const ending of ['stopped', 'pressed'] as const) {
      const { press, cancel, underWay, logged, moves, targets, interrupted } = setup({ hangAt: 4 })

      await press()
      await underWay(4)
      await cancel(ending)

      expect(interrupted()).toBe(true)
      expect(moves().map(move => move.move)).toEqual([1, 2, 3])
      expect(logged[logged.length - 1]).toMatchObject({ kind: 'ended', body: { rehearsal: 'rehearsal-1', ending } })
      expect(targets).toHaveLength(4)
    }
  })
})

describe('Rehearse sweep with the shared goto', () => {
  it('stops sending moves once it is interrupted, and finishes a move only when the property goes Busy and then Ok', async () => {
    const picture = makePicture()
    let rig = readyRig(0, -54.55)
    let at = startedAt
    const sent: Array<string> = []
    const logged: Array<string> = []
    let routine: Fiber.Fiber<void> | undefined
    const gotoOf = { holder: undefined as ReturnType<typeof makeGoto> | undefined }

    picture.apply(streamWire((at += 1), 'def', 'mount', 'ON_COORD_SET', { SLEW: true, TRACK: false, SYNC: false }, 'Ok'), at)

    gotoOf.holder = makeGoto({
      picture,
      mount: 'mount',
      sender: {
        send: async command => {
          sent.push(command.property)

          if (command.property === 'EQUATORIAL_EOD_COORD') {
            const values = command.values as { RA: number; DEC: number }

            setTimeout(() => {
              gotoOf.holder?.observe(streamWire((at += 1), 'set', 'mount', 'EQUATORIAL_EOD_COORD', values, 'Busy'))
              setTimeout(() => {
                rig = mountReports(rig, values.RA, values.DEC, 'PIER_WEST')
                gotoOf.holder?.observe(streamWire((at += 1), 'set', 'mount', 'EQUATORIAL_EOD_COORD', values, 'Ok'))
              }, 2)
            }, 2)
          }

          return { result: 'written' }
        },
      },
    })

    const services = Layer.mergeAll(
      Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.never, current: Effect.sync(() => rig) }),
      Layer.succeed(Capturing, { busy: Effect.succeed(false), start: () => Effect.void, finished: Effect.succeed(undefined) }),
      Layer.succeed(StartRunning, { busy: Effect.succeed(false), began: () => Effect.void }),
      Layer.succeed(RehearsalRunning, { busy: Effect.sync(() => routine !== undefined), began: began => Effect.sync(() => void (routine = began)), cancelled: Effect.succeed<'stopped'>('stopped') }),
      Layer.succeed(RehearsalGoto, rehearsalGoto(gotoOf.holder)),
      Layer.succeed(RehearsalLog, {
        started: () => Effect.void,
        moved: body => Effect.sync(() => void logged.push(`move ${body.move} ${body.outcome}`)),
        ended: body => Effect.sync(() => void logged.push(`ended ${body.ending}`)),
      }),
      Layer.succeed(RehearsalSettings, { sweep, rigSilentAfterSeconds: 10, newId: Effect.succeed(RehearsalId.make('rehearsal-1')) }),
    )

    await Effect.runPromise(Effect.flatMap(rehearsalControls, controls => controls.rehearseSweep).pipe(Effect.provide(services)))
    await vi.waitFor(() => expect(logged.length).toBeGreaterThanOrEqual(3))
    await Effect.runPromise(Fiber.interrupt(routine!))

    const gotos = sent.filter(property => property === 'EQUATORIAL_EOD_COORD').length

    await new Promise(resolve => setTimeout(resolve, 30))

    expect(sent.filter(property => property === 'EQUATORIAL_EOD_COORD')).toHaveLength(gotos)
    expect(logged.slice(0, 3)).toEqual(['move 1 arrived', 'move 2 arrived', 'move 3 arrived'])
    expect(logged[logged.length - 1]).toBe('ended stopped')
  })
})

describe('the hour angle of a right ascension', () => {
  it('is the inverse of the right ascension for an hour angle, wrapped to -180 to 180', () => {
    const at = startedAt

    for (const hourAngle of [-170, -90, 0, 15, 90, 179]) expect(hourAngleOfRa(raForHourAngle(hourAngle, phoenix, at), phoenix, at)).toBeCloseTo(hourAngle, 6)
    expect(hourAngleOfRa(raForHourAngle(-179.9, phoenix, at), phoenix, at)).toBeCloseTo(-179.9, 6)
    expect(poseAt(10, 180, phoenix).hourAngleDegrees).toBeCloseTo(0, 6)
  })
})
