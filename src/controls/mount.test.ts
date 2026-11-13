import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { foldRig, wire } from '../../state/testing.ts'
import type { RigState } from '../../state/rig.ts'
import type { Command, Outcome } from '../commands/sender.ts'
import { Feed } from '../feed/feed.ts'
import { deviceCommandsFrom } from './device-commands.ts'
import { mountControls } from './mount.ts'

const deviceIds = { mount: 'am5', primary: 'primary', focuser: 'focuser', box: 'box', guide: 'guide' }

const connected = foldRig([wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false })])

function setup(rig: RigState, answer: (command: Command, signal: AbortSignal) => Promise<Outcome>, answerSeconds = 10) {
  const sent: Array<Command> = []
  const send = (command: Command, signal: AbortSignal) => (sent.push(command), answer(command, signal))
  const feed = Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.die('not used'), current: Effect.succeed(rig) })
  const home = Effect.runPromise(Effect.flip(Effect.flatMap(mountControls, mount => mount.home)).pipe(Effect.provide(Layer.mergeAll(feed, deviceCommandsFrom({ send, deviceIds, answerSeconds }))), Effect.option))

  return { sent, home }
}

const written = () => Promise.resolve<Outcome>({ result: 'written' })

describe('Home', () => {
  it("writes TELESCOPE_HOME GO to the mount's rig file id once the mount is connected", async () => {
    const { sent, home } = setup(connected, written)

    expect(await home).toMatchObject({ _tag: 'None' })
    expect(sent).toEqual([{ device: 'am5', property: 'TELESCOPE_HOME', values: { GO: true } }])
  })

  it('refuses before sending anything while the mount is not connected', async () => {
    const { sent, home } = setup(foldRig([wire('mount', 'CONNECTION', { CONNECT: false, DISCONNECT: true })]), written)

    expect(await home).toMatchObject({ value: { refusal: { code: 'not-connected', device: 'mount' } } })
    expect(sent).toEqual([])
  })

  it("passes on the rig program's refusal with its words", async () => {
    const { home } = setup(connected, () => Promise.resolve({ result: 'refused', reason: 'TELESCOPE_HOME is busy' }))

    expect(await home).toMatchObject({ value: { refusal: { code: 'rig-refused', text: 'TELESCOPE_HOME is busy' } } })
  })

  it('says no answer after the answer time, and stops waiting for it', async () => {
    let aborted = false
    const { home } = setup(connected, (_command, signal) => new Promise(() => signal.addEventListener('abort', () => (aborted = true))), 0.02)

    expect(await home).toMatchObject({ value: { refusal: { code: 'no-answer', seconds: 0.02 } } })
    expect(aborted).toBe(true)
  })
})
