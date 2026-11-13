import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { entry, foldRig, wire } from '../../state/testing.ts'
import type { RigState } from '../../state/rig.ts'
import type { Command, Outcome } from '../commands/sender.ts'
import { Feed } from '../feed/feed.ts'
import { deviceCommandsFrom } from './device-commands.ts'
import { Autofocusing, focusControls } from './focus.ts'
import { MountRuns } from './mount.ts'

const deviceIds = { mount: 'mount', primary: 'primary', focuser: 'eaf', box: 'box', guide: 'guide' }

const defined = entry('wire', 1, { dir: 'in', device: 'focuser', type: 'def', property: 'ABS_FOCUS_POSITION', state: 'Ok', elements: { FOCUS_ABSOLUTE_POSITION: 32562 }, numbers: { FOCUS_ABSOLUTE_POSITION: { min: 0, max: 60000, step: 30000, format: '%.f' } } })

const focuser = foldRig([wire('focuser', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), defined, wire('focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 32562 })])

type Controls = Effect.Success<typeof focusControls>

function setup(rig: RigState) {
  const sent: Array<string> = []
  const send = (command: Command) => (sent.push(`${command.device} ${command.property} ${JSON.stringify(command.values)}`), Promise.resolve<Outcome>({ result: 'written' }))
  const feed = Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.die('not used'), current: Effect.succeed(rig) })
  const commands = deviceCommandsFrom({ send, ask: () => Promise.resolve({ result: 'written' }), tell: () => undefined, deviceIds, answerSeconds: 10 })
  const runs = Layer.succeed(MountRuns, { endRun: Effect.sync(() => (sent.push('run ended'), true)), idle: Effect.sync(() => void sent.push('no run')), pause: Effect.succeed(false), resume: Effect.void })
  const autofocusing = Layer.succeed(Autofocusing, { start: (exposureSeconds: number) => Effect.sync(() => void sent.push(`autofocus at ${exposureSeconds} s`)) })
  const press = (choose: (controls: Controls) => Effect.Effect<unknown, unknown>) => Effect.runPromise(Effect.flatMap(focusControls, choose).pipe(Effect.result, Effect.provide(Layer.mergeAll(feed, commands, runs, autofocusing))))

  return { sent, press }
}

describe('Focus', () => {
  it("keeps the driver's limits from the definition through later updates", () => {
    expect(focuser.devices.focuser.ABS_FOCUS_POSITION?.limits).toEqual({ FOCUS_ABSOLUTE_POSITION: { min: 0, max: 60000 } })
  })

  it("moves to a position, and steps from the current one, on the focuser's rig file id", async () => {
    const { sent, press } = setup(focuser)

    expect(await press(focus => focus.focusTo(32000))).toMatchObject({ success: { code: 'focusing', position: 32000 } })
    expect(await press(focus => focus.focusBy(-50))).toMatchObject({ success: { code: 'focusing', position: 32512 } })
    expect(sent).toEqual(['eaf ABS_FOCUS_POSITION {"FOCUS_ABSOLUTE_POSITION":32000}', 'eaf ABS_FOCUS_POSITION {"FOCUS_ABSOLUTE_POSITION":32512}'])
  })

  it("refuses a position outside the driver's limits, with them, and sends nothing", async () => {
    const { sent, press } = setup(focuser)

    expect(await press(focus => focus.focusTo(70000))).toMatchObject({ failure: { refusal: { code: 'out-of-range', value: 70000, min: 0, max: 60000 } } })
    expect(await press(focus => focus.focusBy(-40000))).toMatchObject({ failure: { refusal: { code: 'out-of-range', value: -7438 } } })
    expect(sent).toEqual([])
  })

  it('refuses while the focuser is not connected', async () => {
    const { press } = setup(foldRig([wire('focuser', 'CONNECTION', { CONNECT: false, DISCONNECT: true })]))

    expect(await press(focus => focus.focusTo(100))).toMatchObject({ failure: { refusal: { code: 'not-connected', device: 'focuser' } } })
  })

  it('ends the running run, waits for it, then starts autofocus at the chosen exposure', async () => {
    const { sent, press } = setup(focuser)

    expect(await press(focus => focus.autofocus(7))).toMatchObject({ success: { code: 'autofocusing', exposureSeconds: 7, endedRun: true } })
    expect(sent).toEqual(['run ended', 'no run', 'autofocus at 7 s'])
  })
})
