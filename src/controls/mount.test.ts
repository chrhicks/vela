import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { foldRig, wire } from '../../state/testing.ts'
import type { RigState } from '../../state/rig.ts'
import type { Command, Outcome } from '../commands/sender.ts'
import { Feed } from '../feed/feed.ts'
import { deviceCommandsFrom } from './device-commands.ts'
import { mountControls, MountRuns } from './mount.ts'

const deviceIds = { mount: 'am5', primary: 'primary', focuser: 'focuser', box: 'box', guide: 'guide' }

const connected = foldRig([wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false })])

const notConnected = foldRig([wire('mount', 'CONNECTION', { CONNECT: false, DISCONNECT: true })])

const written = () => Promise.resolve<Outcome>({ result: 'written' })

type Controls = Effect.Success<typeof mountControls>

function setup(rig: RigState, answer: (command: Command, signal: AbortSignal) => Promise<Outcome> = written, answerSeconds = 10) {
  const sent: Array<string> = []
  const send = (command: Command, signal: AbortSignal) => (sent.push(`${command.device} ${command.property} ${JSON.stringify(command.values)}`), answer(command, signal))
  const feed = Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.die('not used'), current: Effect.succeed(rig) })
  const runs = Layer.succeed(MountRuns, { stopMoving: Effect.sync(() => void sent.push('vela run stopped')) })
  const press = (choose: (controls: Controls) => Effect.Effect<void, unknown>) =>
    Effect.runPromise(Effect.flatMap(mountControls, controls => choose(controls)).pipe(Effect.flip, Effect.option, Effect.provide(Layer.mergeAll(feed, runs, deviceCommandsFrom({ send, deviceIds, answerSeconds })))))

  return { sent, press }
}

describe('Home', () => {
  it("writes TELESCOPE_HOME GO to the mount's rig file id once the mount is connected", async () => {
    const { sent, press } = setup(connected)

    expect(await press(mount => mount.home)).toMatchObject({ _tag: 'None' })
    expect(sent).toEqual(['am5 TELESCOPE_HOME {"GO":true}'])
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
  it("ends Vela's own run that moves the mount, then aborts the motion", async () => {
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
