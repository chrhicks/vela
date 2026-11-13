import { Effect, Layer, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Entry } from '../../state/entry.ts'
import type { RigState } from '../../state/rig.ts'
import { entry, foldRig, wire } from '../../state/testing.ts'
import type { Command, Outcome } from '../commands/sender.ts'
import { Feed } from '../feed/feed.ts'
import { deviceCommandsFrom } from './device-commands.ts'
import { Autofocusing, focusControls, FocusSettings } from './focus.ts'
import { MountRuns } from './mount.ts'

const deviceIds = { mount: 'mount', primary: 'primary', focuser: 'eaf', box: 'box', guide: 'guide' }

const reported = (state: string, position: number) => entry('wire', 1, { dir: 'in', device: 'focuser', type: 'set', property: 'ABS_FOCUS_POSITION', state, elements: { FOCUS_ABSOLUTE_POSITION: position } })

const defined = entry('wire', 1, { dir: 'in', device: 'focuser', type: 'def', property: 'ABS_FOCUS_POSITION', state: 'Ok', elements: { FOCUS_ABSOLUTE_POSITION: 32562 }, numbers: { FOCUS_ABSOLUTE_POSITION: { min: 0, max: 60000, step: 30000, format: '%.f' } } })

const idle = foldRig([wire('focuser', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), defined])

const at = (rig: RigState, state: string, position: number) => foldRig([reported(state, position)], rig)

type Controls = Effect.Success<typeof focusControls>

function setup(rig: RigState, subscriptions: ReadonlyArray<ReadonlyArray<Entry>> = [], moveSeconds = 5) {
  const sent: Array<string> = []
  let now = rig
  let next = 0
  const send = (command: Command) => (sent.push(`${command.device} ${command.property} ${JSON.stringify(command.values)}`), Promise.resolve<Outcome>({ result: 'written' }))
  const subscribe = Effect.sync(() => {
    const updates = subscriptions[next] ?? []

    next += 1

    return { state: now, entries: Stream.fromIterable(updates).pipe(Stream.tap(update => Effect.sync(() => (now = foldRig([update], now))))) }
  })
  const feed = Layer.succeed(Feed, { receive: () => Effect.void, subscribe, current: Effect.sync(() => now) })
  const commands = deviceCommandsFrom({ send, ask: () => Promise.resolve({ result: 'written' }), tell: () => undefined, deviceIds, answerSeconds: 10 })
  const runs = Layer.succeed(MountRuns, { endRun: Effect.sync(() => (sent.push('run ended'), true)), idle: Effect.sync(() => void sent.push('no run')), pause: Effect.succeed(false), resume: Effect.void })
  const autofocusing = Layer.succeed(Autofocusing, { start: (exposureSeconds: number) => Effect.sync(() => void sent.push(`autofocus at ${exposureSeconds} s`)) })
  const settings = Layer.succeed(FocusSettings, { moveSeconds })
  const press = (choose: (controls: Controls) => Effect.Effect<unknown, unknown>) => Effect.runPromise(Effect.flatMap(focusControls, choose).pipe(Effect.result, Effect.provide(Layer.mergeAll(feed, commands, runs, autofocusing, settings))))

  return { sent, press }
}

describe('Focus', () => {
  it("keeps the driver's limits from the definition through later updates", () => {
    expect(at(idle, 'Ok', 32600).devices.focuser.ABS_FOCUS_POSITION?.limits).toEqual({ FOCUS_ABSOLUTE_POSITION: { min: 0, max: 60000 } })
  })

  it('moves, waits for the move to end, and answers with where the focuser is', async () => {
    const { sent, press } = setup(idle, [[], [reported('Busy', 32562), reported('Ok', 32000)]])

    expect(await press(focus => focus.focusTo(32000))).toMatchObject({ success: { code: 'focused', position: 32000 } })
    expect(sent).toEqual(['eaf ABS_FOCUS_POSITION {"FOCUS_ABSOLUTE_POSITION":32000}'])
  })

  it('waits for a move already going before it starts, and steps from where that one ended', async () => {
    const { sent, press } = setup(at(idle, 'Busy', 32580), [[reported('Busy', 32600), reported('Ok', 32612)], [reported('Busy', 32612), reported('Ok', 32662)]])

    expect(await press(focus => focus.focusBy(50))).toMatchObject({ success: { code: 'focused', position: 32662 } })
    expect(sent).toEqual(['eaf ABS_FOCUS_POSITION {"FOCUS_ABSOLUTE_POSITION":32662}'])
  })

  it("says the move failed when the driver turns it down", async () => {
    const { press } = setup(idle, [[], [reported('Busy', 32562), reported('Alert', 32562)]])

    expect(await press(focus => focus.focusTo(32000))).toMatchObject({ failure: { refusal: { code: 'move-failed', device: 'focuser' } } })
  })

  it('says still moving when the move has not ended in its time', async () => {
    const { press } = setup(idle, [[], [reported('Busy', 32562)]], 0.05)

    expect(await press(focus => focus.focusTo(32000))).toMatchObject({ success: { code: 'focusing', position: 32000 } })
  })

  it('sends nothing for a move to where the focuser already is', async () => {
    const { sent, press } = setup(idle)

    expect(await press(focus => focus.focusTo(32562))).toMatchObject({ success: { code: 'focused', position: 32562 } })
    expect(sent).toEqual([])
  })

  it("refuses a position outside the driver's limits, with them, and sends nothing", async () => {
    const { sent, press } = setup(idle)

    expect(await press(focus => focus.focusTo(70000))).toMatchObject({ failure: { refusal: { code: 'out-of-range', value: 70000, min: 0, max: 60000 } } })
    expect(await press(focus => focus.focusBy(-40000))).toMatchObject({ failure: { refusal: { code: 'out-of-range', value: -7438 } } })
    expect(sent).toEqual([])
  })

  it('refuses while the focuser is not connected', async () => {
    const { press } = setup(foldRig([wire('focuser', 'CONNECTION', { CONNECT: false, DISCONNECT: true })]))

    expect(await press(focus => focus.focusTo(100))).toMatchObject({ failure: { refusal: { code: 'not-connected', device: 'focuser' } } })
  })

  it('ends the running run, waits for it, then starts autofocus at the chosen exposure', async () => {
    const { sent, press } = setup(idle)

    expect(await press(focus => focus.autofocus(7))).toMatchObject({ success: { code: 'autofocusing', exposureSeconds: 7, endedRun: true } })
    expect(sent).toEqual(['run ended', 'no run', 'autofocus at 7 s'])
  })
})
