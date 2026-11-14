import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { RigState } from '../../state/rig.ts'
import { entry, foldRig, wire } from '../../state/testing.ts'
import type { Command, Outcome } from '../commands/sender.ts'
import { Feed } from '../feed/feed.ts'
import { deviceCommandsFrom } from './device-commands.ts'
import { dewControls, DewSettings } from './dew.ts'

const deviceIds = { mount: 'mount', primary: 'asi', focuser: 'focuser', box: 'ppba', guide: 'guide' }

const percent = { min: 0, max: 100, step: 10, format: '%.0f' }

const duty = entry('wire', 1, { dir: 'in', device: 'box', type: 'def', property: 'DEW_DUTY_CYCLES', state: 'Idle', elements: { DEW_CHANNEL_1: 0, DEW_CHANNEL_2: 0 }, numbers: { DEW_CHANNEL_1: percent, DEW_CHANNEL_2: percent } })

const box = foldRig([wire('box', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), duty, wire('box', 'DEW_CHANNELS', { DEW_CHANNEL_1: true, DEW_CHANNEL_2: true }), wire('box', 'AUTO_DEW_CONTROL', { DEW_CHANNEL_1: true })])

type Controls = Effect.Success<typeof dewControls>

function setup(rig: RigState) {
  const sent: Array<string> = []
  const send = (command: Command) => (sent.push(`${command.device} ${command.property} ${JSON.stringify(command.values)}`), Promise.resolve<Outcome>({ result: 'written' }))
  const feed = Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.die('not used'), current: Effect.succeed(rig) })
  const commands = deviceCommandsFrom({ send, ask: () => Promise.resolve({ result: 'written' }), tell: () => undefined, deviceIds, answerSeconds: 10 })
  const press = (choose: (controls: Controls) => Effect.Effect<unknown, unknown>) =>
    Effect.runPromise(Effect.flatMap(dewControls, choose).pipe(Effect.result, Effect.provide(Layer.mergeAll(feed, commands, Layer.succeed(DewSettings, { channel: 'DEW_CHANNEL_1' })))))

  return { sent, press }
}

describe('Dew heater', () => {
  it('fixed: auto off, then the level, then the output on, only on the configured output', async () => {
    const { sent, press } = setup(box)

    expect(await press(controls => controls.dewFixed(40))).toMatchObject({ success: { code: 'dew-fixed', percent: 40 } })
    expect(sent).toEqual(['ppba AUTO_DEW_CONTROL {"DEW_CHANNEL_1":false}', 'ppba DEW_DUTY_CYCLES {"DEW_CHANNEL_1":40}', 'ppba DEW_CHANNELS {"DEW_CHANNEL_1":true}'])
  })

  it("refuses a level outside the box's own range, and sends nothing", async () => {
    const { sent, press } = setup(box)

    expect(await press(controls => controls.dewFixed(120))).toMatchObject({ failure: { refusal: { code: 'out-of-range', value: 120, min: 0, max: 100 } } })
    expect(sent).toEqual([])
  })

  it('auto turns auto and the output on; off turns both off', async () => {
    const auto = setup(box)

    expect(await auto.press(controls => controls.dewAuto)).toMatchObject({ success: { code: 'dew-auto' } })
    expect(auto.sent).toEqual(['ppba AUTO_DEW_CONTROL {"DEW_CHANNEL_1":true}', 'ppba DEW_CHANNELS {"DEW_CHANNEL_1":true}'])

    const off = setup(box)

    expect(await off.press(controls => controls.dewOff)).toMatchObject({ success: { code: 'dew-off' } })
    expect(off.sent).toEqual(['ppba AUTO_DEW_CONTROL {"DEW_CHANNEL_1":false}', 'ppba DEW_CHANNELS {"DEW_CHANNEL_1":false}'])
  })

  it('refuses while the box is not connected', async () => {
    const { sent, press } = setup(foldRig([wire('box', 'CONNECTION', { CONNECT: false, DISCONNECT: true })]))

    expect(await press(controls => controls.dewAuto)).toMatchObject({ failure: { refusal: { code: 'not-connected', device: 'box' } } })
    expect(sent).toEqual([])
  })
})
