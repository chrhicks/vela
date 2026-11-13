import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { RigState } from '../../state/rig.ts'
import { entry, foldRig, wire } from '../../state/testing.ts'
import type { Command, Outcome } from '../commands/sender.ts'
import { Feed } from '../feed/feed.ts'
import { cameraControls } from './camera.ts'
import { deviceCommandsFrom } from './device-commands.ts'

const deviceIds = { mount: 'mount', primary: 'asi', focuser: 'focuser', box: 'box', guide: 'guide' }

const temperature = entry('wire', 1, { dir: 'in', device: 'primary', type: 'def', property: 'CCD_TEMPERATURE', state: 'Idle', elements: { CCD_TEMPERATURE_VALUE: 26.1 }, numbers: { CCD_TEMPERATURE_VALUE: { min: -50, max: 50, step: 0, format: '%.2f' } } })

const camera = foldRig([wire('primary', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), temperature])

type Controls = Effect.Success<typeof cameraControls>

function setup(rig: RigState) {
  const sent: Array<string> = []
  const send = (command: Command) => (sent.push(`${command.device} ${command.property} ${JSON.stringify(command.values)}`), Promise.resolve<Outcome>({ result: 'written' }))
  const feed = Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.die('not used'), current: Effect.succeed(rig) })
  const commands = deviceCommandsFrom({ send, ask: () => Promise.resolve({ result: 'written' }), tell: () => undefined, deviceIds, answerSeconds: 10 })
  const press = (choose: (controls: Controls) => Effect.Effect<unknown, unknown>) => Effect.runPromise(Effect.flatMap(cameraControls, choose).pipe(Effect.result, Effect.provide(Layer.mergeAll(feed, commands))))

  return { sent, press }
}

describe('Camera cooler', () => {
  it("sets the temperature, then turns the cooler on, on the camera's rig file id", async () => {
    const { sent, press } = setup(camera)

    expect(await press(controls => controls.coolTo(-10))).toMatchObject({ success: { code: 'cooling', celsius: -10 } })
    expect(sent).toEqual(['asi CCD_TEMPERATURE {"CCD_TEMPERATURE_VALUE":-10}', 'asi CCD_COOLER {"COOLER_ON":true,"COOLER_OFF":false}'])
  })

  it("refuses a setpoint outside the camera's own range, and sends nothing", async () => {
    const { sent, press } = setup(camera)

    expect(await press(controls => controls.coolTo(-60))).toMatchObject({ failure: { refusal: { code: 'out-of-range', value: -60, min: -50, max: 50 } } })
    expect(sent).toEqual([])
  })

  it('turns the cooler off, and refuses both while the camera is not connected', async () => {
    const on = setup(camera)

    expect(await on.press(controls => controls.coolerOff)).toMatchObject({ success: { code: 'cooler-off' } })
    expect(on.sent).toEqual(['asi CCD_COOLER {"COOLER_ON":false,"COOLER_OFF":true}'])

    const off = setup(foldRig([wire('primary', 'CONNECTION', { CONNECT: false, DISCONNECT: true })]))

    expect(await off.press(controls => controls.coolerOff)).toMatchObject({ failure: { refusal: { code: 'not-connected', device: 'primary' } } })
    expect(await off.press(controls => controls.coolTo(-10))).toMatchObject({ failure: { refusal: { code: 'not-connected' } } })
  })
})
