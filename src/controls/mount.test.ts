import { Effect, Layer, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { entry, foldRig, wire } from '../../state/testing.ts'
import type { RigState } from '../../state/rig.ts'
import type { Entry } from '../../state/entry.ts'
import type { Command, Outcome, Request } from '../commands/sender.ts'
import { Feed } from '../feed/feed.ts'
import { deviceCommandsFrom } from './device-commands.ts'
import { NudgeId } from '../../state/commands.ts'
import { Centring, mountControls, MountRuns, MountSettings } from './mount.ts'

const deviceIds = { mount: 'am5', primary: 'primary', focuser: 'focuser', box: 'box', guide: 'guide' }

const connected = foldRig([wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false })])

const pointing = foldRig([wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), wire('mount', 'EQUATORIAL_EOD_COORD', { RA: 23.3, DEC: 61.2 })])

const notConnected = foldRig([wire('mount', 'CONNECTION', { CONNECT: false, DISCONNECT: true })])

const pointingNow = (state: string) => entry('wire', 2, { dir: 'in', device: 'mount', type: 'set', property: 'EQUATORIAL_EOD_COORD', state, elements: { RA: 23.3, DEC: 61.2 } })

const step = (rig: RigState, state: string) => ({ rig: foldRig([pointingNow(state)], rig), entry: pointingNow(state) })

const written = () => Promise.resolve<Outcome>({ result: 'written' })

type Controls = Effect.Success<typeof mountControls>

function setup(rig: RigState, answer: (command: Command, signal: AbortSignal) => Promise<Outcome> = written, answerSeconds = 10, later: ReadonlyArray<{ readonly rig: RigState; readonly entry: Entry }> = []) {
  let now = rig
  const sent: Array<string> = []
  const send = (command: Command, signal: AbortSignal) => (sent.push(`${command.device} ${command.property} ${JSON.stringify(command.values)}`), answer(command, signal))
  const ask = (request: Request, signal: AbortSignal) => (sent.push(`${request.device} ${request.id} ${JSON.stringify(request.body)}`), answer({ device: request.device, property: request.label, values: {} }, signal))
  const tell = (device: string, body: Readonly<Record<string, unknown>>) => void sent.push(`${device} told ${JSON.stringify(body)}`)
  const settings = Layer.succeed(MountSettings, { nudgeRates: { slow: '7x', fast: '8x' }, flipSettleSeconds: 5 })
  const centring = Layer.succeed(Centring, { centreOn: (target: string) => Effect.sync(() => (sent.push(`centre on ${target}`), `${target} found`)) })
  const entries = Stream.fromIterable(later).pipe(Stream.map(next => ((now = next.rig), next.entry)))
  const feed = Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.succeed({ state: rig, entries }), current: Effect.sync(() => now) })
  const runs = Layer.succeed(MountRuns, { endRun: Effect.sync(() => (sent.push('vela run stopped'), true)), idle: Effect.sync(() => void sent.push('no run')), pause: Effect.sync(() => (sent.push('run paused'), true)), resume: Effect.sync(() => void sent.push('run resumed')) })
  const services = Layer.mergeAll(feed, runs, settings, centring, deviceCommandsFrom({ send, ask, tell, deviceIds, answerSeconds }))
  const press = (choose: (controls: Controls) => Effect.Effect<unknown, unknown>) =>
    Effect.runPromise(Effect.flatMap(mountControls, controls => choose(controls)).pipe(Effect.flip, Effect.option, Effect.provide(services)))
  const done = (choose: (controls: Controls) => Effect.Effect<unknown, unknown>) => Effect.runPromise(Effect.flatMap(mountControls, controls => choose(controls)).pipe(Effect.option, Effect.provide(services)))

  return { sent, press, done }
}

describe('Home', () => {
  it("writes TELESCOPE_HOME GO to the mount's rig file id once the mount is connected", async () => {
    const { sent, press } = setup(connected)

    expect(await press(mount => mount.home)).toMatchObject({ _tag: 'None' })
    expect(sent).toEqual(['vela run stopped', 'am5 TELESCOPE_HOME {"GO":true}'])
  })

  it('refuses before sending anything while the mount is not connected', async () => {
    const { sent, press } = setup(notConnected)

    expect(await press(mount => mount.home)).toMatchObject({ value: { refusal: { code: 'not-connected', device: 'mount' } } })
    expect(sent).toEqual([])
  })

  it("passes on the rig program's refusal with its words", async () => {
    const { press } = setup(connected, () => Promise.resolve({ result: 'refused', reason: 'TELESCOPE_HOME is busy' }))

    expect(await press(mount => mount.home)).toMatchObject({ value: { refusal: { code: 'rig-refused', text: 'TELESCOPE_HOME is busy' } } })
  })

  it('says no answer after the answer time, and stops waiting for it', async () => {
    let aborted = false
    const { press } = setup(connected, (_command, signal) => new Promise(() => signal.addEventListener('abort', () => (aborted = true))), 0.02)

    expect(await press(mount => mount.home)).toMatchObject({ value: { refusal: { code: 'no-answer', seconds: 0.02 } } })
    expect(aborted).toBe(true)
  })
})

describe('Stop', () => {
  it('ends whatever run is going, then aborts the motion', async () => {
    const { sent, press } = setup(connected)

    expect(await press(mount => mount.stop)).toMatchObject({ _tag: 'None' })
    expect(sent).toEqual(['vela run stopped', 'am5 TELESCOPE_ABORT_MOTION {"ABORT":true}'])
  })

  it('sends the abort even when the page shows the mount as not connected', async () => {
    const { sent, press } = setup(notConnected)

    await press(mount => mount.stop)

    expect(sent).toContain('am5 TELESCOPE_ABORT_MOTION {"ABORT":true}')
  })
})

describe('Tracking', () => {
  it('writes both switches of TELESCOPE_TRACK_STATE', async () => {
    const { sent, press } = setup(connected)

    await press(mount => mount.tracking(false))
    await press(mount => mount.tracking(true))

    expect(sent).toEqual(['am5 TELESCOPE_TRACK_STATE {"TRACK_ON":false,"TRACK_OFF":true}', 'am5 TELESCOPE_TRACK_STATE {"TRACK_ON":true,"TRACK_OFF":false}'])
  })
})

describe('Nudge', () => {
  const id = NudgeId.make('6f1c0e2a-4b3d-4e5f-8a9b-0c1d2e3f4a5b')

  it("asks the rig program to move at the mount's element for the rate, holds without waiting, and releases", async () => {
    const { sent, press } = setup(connected)

    expect(await press(mount => mount.nudge(id, 'north', 'fast'))).toMatchObject({ _tag: 'None' })
    await press(mount => mount.holdNudge(id))
    await press(mount => mount.releaseNudge(id))

    expect(sent).toEqual([
      `am5 nudge-${id} {"nudge":"north","rate":"8x"}`,
      `am5 told {"hold":"nudge-${id}"}`,
      `am5 nudge-${id}-release {"release":"nudge-${id}"}`,
    ])
  })

  it('refuses to start while the mount is not connected, and sends nothing', async () => {
    const { sent, press } = setup(notConnected)

    expect(await press(mount => mount.nudge(id, 'east', 'slow'))).toMatchObject({ value: { refusal: { code: 'not-connected', device: 'mount' } } })
    expect(sent).toEqual([])
  })
})

describe('Slew and centre, and Flip now', () => {
  it('ends whatever run is going, waits for it to finish, then starts centring on the named target', async () => {
    const { sent, press } = setup(connected)

    await press(mount => mount.slewAndCentre('NGC 7635'))

    expect(sent).toEqual(['vela run stopped', 'no run', 'centre on NGC 7635'])
  })

  it('pauses the run, points the mount again where it points now, waits for it to settle, resumes, and says it flipped', async () => {
    const west = foldRig([wire('mount', 'TELESCOPE_PIER_SIDE', { PIER_WEST: true, PIER_EAST: false })], pointing)
    const eastSettled = foldRig([wire('mount', 'TELESCOPE_PIER_SIDE', { PIER_WEST: false, PIER_EAST: true })], pointing)
    const { sent, done } = setup(west, written, 10, [step(west, 'Busy'), step(eastSettled, 'Ok')])

    expect(await done(mount => mount.flipNow)).toMatchObject({ value: { code: 'flip', settled: true, flipped: true, pierSide: 'east', pausedRun: true } })
    expect(sent).toEqual(['run paused', 'am5 ON_COORD_SET {"SLEW":false,"TRACK":true,"SYNC":false}', 'am5 EQUATORIAL_EOD_COORD {"RA":23.3,"DEC":61.2}', 'run resumed'])
  })

  it('says no flip when the pier side stays, and not settled when the mount never reports its goto ending', async () => {
    const west = foldRig([wire('mount', 'TELESCOPE_PIER_SIDE', { PIER_WEST: true, PIER_EAST: false })], pointing)
    expect(await setup(west, written, 10, [step(west, 'Busy'), step(west, 'Ok')]).done(mount => mount.flipNow)).toMatchObject({ value: { flipped: false, settled: true, pierSide: 'west' } })
    expect(await setup(west, written, 10, [step(west, 'Busy')]).done(mount => mount.flipNow)).toMatchObject({ value: { settled: false } })
  })

  it('refuses both while the mount is not connected', async () => {
    const { sent, press } = setup(notConnected)

    expect(await press(mount => mount.flipNow)).toMatchObject({ value: { refusal: { code: 'not-connected' } } })
    expect(await press(mount => mount.slewAndCentre('M 31'))).toMatchObject({ value: { refusal: { code: 'not-connected' } } })
    expect(sent).toEqual([])
  })
})
