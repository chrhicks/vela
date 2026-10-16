import { Effect, Exit, Fiber, Scope } from 'effect'
import { settle, type Ending, type Outcome } from '@cria/primitives'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCriaEquipment, type CriaEquipment } from '../../src/v5/equipment.js'
import { openSession, type Session } from '../../src/v5/session.js'
import { FakeCria, type Route } from './fake-cria.js'

let cria: FakeCria

let scope: Scope.Closeable

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 3) })
  cria = new FakeCria()
  scope = Scope.makeUnsafe()
})

afterEach(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
  cria.close()
  vi.useRealTimers()
})

const slew = {
  kind: 'mount-slew',
  parameters: { rightAscensionDegrees: 120, declinationDegrees: 10, coordinateSystem: 'topocentric' },
} as const

const checked = { confirmed: true, note: 'Checked the mount at the pier' } as const

interface Opened {
  readonly session: Session
  readonly rig: CriaEquipment
}

function open(): Opened {
  const session = Effect.runSync(Scope.provide(scope)(openSession({ origin: cria.origin, token: undefined, fetch: cria.fetch })))

  const rig = createCriaEquipment(session, [
    { deviceId: 'fra-camera', criaDeviceId: 'camera', expectedName: 'Fake CCD' },
    { deviceId: 'fra-mount', criaDeviceId: 'mount', expectedName: 'ZWO AM5' },
    { deviceId: 'fra-focuser', criaDeviceId: 'focuser', expectedName: 'Fake Focuser' },
  ])

  return { session, rig }
}

async function connected(): Promise<Opened> {
  const opened = open()

  await vi.advanceTimersByTimeAsync(10)

  return opened
}

/** Once a Stop is recorded, the fiber's own exit is only an interrupt, so the outcome is read inside the uninterruptible region. */
function execute<A>(work: Effect.Effect<A, Ending>) {
  let outcome: Outcome<A> | undefined

  const fiber = Effect.runFork(
    Effect.uninterruptible(
      settle(work).pipe(
        Effect.tap(settled =>
          Effect.sync(() => {
            outcome = settled
          }),
        ),
      ),
    ),
  )

  return {
    stop: () => Effect.runFork(Fiber.interrupt(fiber)),
    get outcome() {
      return outcome
    },
  }
}

function sent(...routes: ReadonlyArray<Route>) {
  return cria.received.filter(request => request.route !== undefined && routes.includes(request.route)).map(request => request.route)
}

function current(rig: CriaEquipment) {
  return Effect.runSync(rig.received)
}

function holds(rig: CriaEquipment) {
  return Effect.runSync(rig.holds).map(hold => ({ deviceId: hold.deviceId, kind: hold.kind }))
}

describe('admission', () => {
  it('answers a dropped admission reply by lookup and POSTs the slew once', async () => {
    const { rig } = await connected()

    cria.durationMs['mount-slew'] = 30_000
    cria.dropReply('submit')
    const run = execute(rig.run('fra-mount', slew))

    await vi.advanceTimersByTimeAsync(31_000)

    expect(run.outcome).toEqual({ kind: 'confirmed', value: { values: {}, image: null } })
    expect(sent('submit', 'lookup', 'cancel')).toEqual(['submit', 'lookup'])
    expect(holds(rig)).toEqual([])
  })

  it('keeps a request Cria has not shown running with an unknown hold, then follows and cancels it once Cria admits it', async () => {
    const { rig } = await connected()

    cria.durationMs['mount-slew'] = 30_000
    cria.delay('submit', 4_500)
    const run = execute(rig.run('fra-mount', slew))

    await vi.advanceTimersByTimeAsync(2_500)

    expect(run.outcome).toBeUndefined()
    expect(holds(rig)).toEqual([{ deviceId: 'fra-mount', kind: 'unknown' }])

    run.stop()
    await vi.advanceTimersByTimeAsync(2_400)

    expect(run.outcome).toBeUndefined()
    expect(sent('submit', 'lookup', 'cancel')).toEqual(['submit', 'lookup', 'lookup', 'lookup'])

    await vi.advanceTimersByTimeAsync(1_000)

    expect(run.outcome).toEqual({ kind: 'stopped' })
    expect(sent('submit', 'lookup', 'cancel')).toEqual(['submit', 'lookup', 'lookup', 'lookup', 'lookup', 'cancel'])
  })
})

describe('the recovery fence', () => {
  it.each([
    { stop: true, outcome: { kind: 'stopped' } },
    {
      stop: false,
      outcome: { kind: 'failed', reason: 'unavailable', message: 'Cria never admitted mount-slew; recovery fenced the request' },
    },
  ])('fences a request Cria never showed and ends the execution $outcome.kind', async ({ stop, outcome }) => {
    const { rig } = await connected()
    const binding = cria.bindingOf('mount')

    cria.delay('submit', 10_000)
    const run = execute(rig.run('fra-mount', slew))

    await vi.advanceTimersByTimeAsync(2_500)

    if (stop) run.stop()
    const [hold] = Effect.runSync(rig.holds)
    const recovery = execute(rig.recover(hold?.token ?? never(), checked))

    await vi.advanceTimersByTimeAsync(500)

    expect(recovery.outcome).toEqual({ kind: 'confirmed', value: { found: 'Cria never admitted mount-slew' } })
    expect(run.outcome).toEqual(outcome)
    expect(cria.bindingOf('mount')).not.toBe(binding)
    expect(holds(rig)).toEqual([])

    await vi.advanceTimersByTimeAsync(8_000)

    const latest = current(rig)

    expect(latest.state === 'live' && latest.snapshot.operations).toEqual([])
    expect(sent('submit')).toEqual(['submit'])
  })

  it('cancels and follows a request recovery finds open, then recovers again', async () => {
    const { rig } = await connected()

    cria.durationMs['mount-slew'] = 60_000
    cria.stopMs = 1_000
    cria.delay('submit', 4_500)
    const run = execute(rig.run('fra-mount', slew))

    await vi.advanceTimersByTimeAsync(4_600)

    const [hold] = Effect.runSync(rig.holds)
    const recovery = execute(rig.recover(hold?.token ?? never(), checked))

    await vi.advanceTimersByTimeAsync(2_000)

    expect(recovery.outcome).toEqual({ kind: 'confirmed', value: { found: 'Cria had run mount-slew: stopped' } })
    expect(run.outcome).toEqual({ kind: 'stopped' })
    expect(sent('recover', 'cancel')).toEqual(['recover', 'cancel', 'recover'])
    expect(sent('submit')).toEqual(['submit'])
    expect(holds(rig)).toEqual([])
  })
})

describe('cancel', () => {
  it('sends a cancel again until Cria acknowledges it, and the slew still once', async () => {
    const { rig } = await connected()

    cria.durationMs['mount-slew'] = 60_000
    cria.stopMs = 5_000
    const run = execute(rig.run('fra-mount', slew))

    await vi.advanceTimersByTimeAsync(100)
    cria.dropReply('cancel')
    run.stop()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(run.outcome).toEqual({ kind: 'stopped' })
    expect(sent('submit', 'cancel')).toEqual(['submit', 'cancel', 'cancel'])
  })

  it('ends the cancel when Cria answers 404 for an operation it no longer holds', async () => {
    const { session, rig } = await connected()

    cria.durationMs['mount-slew'] = 60_000
    execute(rig.run('fra-mount', slew))
    await vi.advanceTimersByTimeAsync(100)
    const latest = current(rig)
    const [operation] = latest.state === 'live' ? latest.snapshot.operations : []

    cria.restart()
    const cancelled = execute(session.cancel(operation ?? never()))

    await vi.advanceTimersByTimeAsync(5_000)

    expect(cancelled.outcome).toEqual({ kind: 'confirmed', value: undefined })
    expect(sent('cancel')).toEqual(['cancel'])
    expect(sent('submit')).toEqual(['submit'])
  })

  it.each([2_000, 19_000])('follows a cancelled slew that stands still %d ms after the abort to stopped', async stopMs => {
    const { rig } = await connected()

    cria.durationMs['mount-slew'] = 60_000
    cria.stopMs = stopMs
    const run = execute(rig.run('fra-mount', slew))

    await vi.advanceTimersByTimeAsync(100)
    run.stop()
    await vi.advanceTimersByTimeAsync(stopMs - 100)

    expect(run.outcome).toBeUndefined()

    await vi.advanceTimersByTimeAsync(200)

    expect(run.outcome).toEqual({ kind: 'stopped' })
    expect(sent('submit', 'cancel', 'lookup')).toEqual(['submit', 'cancel'])
  })
})

describe('halts', () => {
  it('admits a halt on a held mount, sends its lost reply again with the same request ID, and confirms it', async () => {
    const { rig } = await connected()

    cria.durationMs['mount-slew'] = 60_000
    const slewing = execute(rig.run('fra-mount', slew))

    await vi.advanceTimersByTimeAsync(100)
    const latest = current(rig)
    const [operation] = latest.state === 'live' ? latest.snapshot.operations : []

    cria.settle(operation?.id ?? never(), { kind: 'uncertain', reason: 'stop-not-confirmed', message: 'The mount did not stand still' })
    await vi.advanceTimersByTimeAsync(100)

    expect(slewing.outcome).toEqual({ kind: 'uncertain', reason: 'stop-not-confirmed', message: 'The mount did not stand still' })
    expect(holds(rig)).toEqual([{ deviceId: 'fra-mount', kind: 'quarantine' }])

    cria.dropReply('submit')
    const halting = execute(rig.halt('fra-mount', 'mount-stop'))

    await vi.advanceTimersByTimeAsync(1_000)

    const halts = cria.received.filter(request => request.route === 'submit' && request.body?.includes('mount-stop'))

    expect(halting.outcome).toEqual({ kind: 'confirmed', value: undefined })
    expect(halts.length).toBe(2)
    expect(halts[1]?.body).toBe(halts[0]?.body)
    expect(holds(rig)).toEqual([{ deviceId: 'fra-mount', kind: 'quarantine' }])
  })
})

describe('captures', () => {
  it('fetches and confirms a capture that finished while its cancel was pending', async () => {
    const { rig } = await connected()

    cria.stopMs = 5_000
    const run = execute(rig.capture('fra-camera', { exposureSeconds: 2, light: true }))

    await vi.advanceTimersByTimeAsync(1_000)
    run.stop()
    await vi.advanceTimersByTimeAsync(1_500)

    expect(run.outcome?.kind === 'confirmed' && run.outcome.value.kind === 'frame' && run.outcome.value.bytes.byteLength).toBe(92)
    expect(sent('submit', 'cancel', 'image')).toEqual(['submit', 'cancel', 'image'])
  })

  it('reports an image Cria dropped as one lost frame and exposes no second time', async () => {
    const { rig } = await connected()

    cria.delay('image', 500)
    const run = execute(rig.capture('fra-camera', { exposureSeconds: 1, light: true }))

    await vi.advanceTimersByTimeAsync(1_100)
    const imageId = cria.received.find(request => request.route === 'image')?.path.split('/')[3]

    cria.dropImage(imageId ?? never())
    await vi.advanceTimersByTimeAsync(5_000)

    expect(run.outcome).toEqual({ kind: 'confirmed', value: { kind: 'lost', message: `Cria dropped image ${imageId} before Vela fetched it` } })
    expect(sent('submit', 'image')).toEqual(['submit', 'image'])
  })

  it('ends a capture uncertain with an unknown hold when Cria restarts, and sends nothing again', async () => {
    const { rig } = await connected()
    const run = execute(rig.capture('fra-camera', { exposureSeconds: 10, light: true }))

    await vi.advanceTimersByTimeAsync(2_000)
    cria.restart()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(run.outcome).toEqual({ kind: 'uncertain', reason: 'connection-lost', message: 'Cria restarted while capture was running' })
    expect(holds(rig)).toEqual([{ deviceId: 'fra-camera', kind: 'unknown' }])

    await vi.advanceTimersByTimeAsync(20_000)

    expect(sent('submit', 'lookup', 'cancel', 'image')).toEqual(['submit'])
  })
})

describe('the session', () => {
  it('starts interrupted when Cria is unreachable, refuses commands unsent, and reconnects when Cria comes up', async () => {
    cria.reachable = false
    const { rig } = open()

    await vi.advanceTimersByTimeAsync(5_000)

    expect(current(rig)).toMatchObject({ state: 'interrupted', last: null, message: 'Cria is unreachable: fetch failed' })

    const refused = execute(rig.run('fra-mount', slew))

    await vi.advanceTimersByTimeAsync(10)

    expect(refused.outcome).toMatchObject({ kind: 'failed', reason: 'unavailable' })
    expect(sent('submit')).toEqual([])

    cria.reachable = true
    await vi.advanceTimersByTimeAsync(1_000)

    expect(current(rig)).toMatchObject({ state: 'live', snapshot: { instanceId: cria.instanceId } })
  })

  it('turns interrupted three seconds after the last snapshot and keeps that snapshot', async () => {
    const { rig } = await connected()

    cria.reachable = false
    await vi.advanceTimersByTimeAsync(2_900)

    expect(current(rig).state).toBe('live')

    await vi.advanceTimersByTimeAsync(200)

    expect(current(rig)).toMatchObject({ state: 'interrupted', last: { instanceId: cria.instanceId } })
  })
})

function never(): never {
  throw new Error('The fake did not produce what this test set up')
}
