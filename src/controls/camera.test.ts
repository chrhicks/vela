import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { RigState } from '../../state/rig.ts'
import { entry, foldRig, wire } from '../../state/testing.ts'
import type { Command, Outcome } from '../commands/sender.ts'
import { Feed } from '../feed/feed.ts'
import { CalibrationSettings, cameraControls, Capturing } from './camera.ts'
import type { CaptureRequest } from '../capture/request.ts'
import { deviceCommandsFrom } from './device-commands.ts'

const deviceIds = { mount: 'mount', primary: 'asi', focuser: 'focuser', box: 'box', guide: 'guide' }

const temperature = entry('wire', 1, { dir: 'in', device: 'primary', type: 'def', property: 'CCD_TEMPERATURE', state: 'Idle', elements: { CCD_TEMPERATURE_VALUE: 26.1 }, numbers: { CCD_TEMPERATURE_VALUE: { min: -50, max: 50, step: 0, format: '%.2f' } } })

const camera = foldRig([wire('primary', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), temperature, wire('primary', 'CCD_CONTROLS', { Gain: 100, Offset: 50 })])

type Controls = Effect.Success<typeof cameraControls>

function setup(rig: RigState, busy = false) {
  const sent: Array<string> = []
  const capturing = Layer.succeed(Capturing, { busy: Effect.succeed(busy), start: (request: CaptureRequest) => Effect.sync(() => void sent.push(`capture ${JSON.stringify(request)}`)), finished: Effect.succeed(undefined) })
  const send = (command: Command) => (sent.push(`${command.device} ${command.property} ${JSON.stringify(command.values)}`), Promise.resolve<Outcome>({ result: 'written' }))
  const feed = Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.die('not used'), current: Effect.succeed(rig) })
  const commands = deviceCommandsFrom({ send, ask: () => Promise.resolve({ result: 'written' }), tell: () => undefined, deviceIds, answerSeconds: 10 })
  const press = (choose: (controls: Controls) => Effect.Effect<unknown, unknown>) => Effect.runPromise(Effect.flatMap(cameraControls, choose).pipe(Effect.result, Effect.provide(Layer.mergeAll(feed, commands, capturing, Layer.succeed(CalibrationSettings, { biasExposureSeconds: 0.000032 })))))

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

describe('Test frame', () => {
  it("takes one frame named as a test frame, at the camera's gain and offset, with the cooler left as it is", async () => {
    const { sent, press } = setup(camera)

    expect(await press(controls => controls.testFrame(2))).toMatchObject({ success: { code: 'test-frame', exposureSeconds: 2, sequence: 'test-frame_light' } })
    expect(sent).toEqual(['capture {"object":"test-frame","frameType":"light","exposureSeconds":2,"count":1,"gain":100,"offset":50,"cooler":"keep"}'])
  })

  it('refuses while a run is capturing, and starts nothing', async () => {
    const { sent, press } = setup(camera, true)

    expect(await press(controls => controls.testFrame(2))).toMatchObject({ failure: { refusal: { code: 'run-active' } } })
    expect(sent).toEqual([])
  })

  it("takes darks at the given exposure and temperature, the camera's gain and offset, cooler on", async () => {
    const { sent, press } = setup(camera)

    expect(await press(controls => controls.takeDarks(30, 120, -10))).toMatchObject({ success: { code: 'darks', frames: 30, exposureSeconds: 120, celsius: -10 } })
    expect(sent).toEqual(['capture {"object":"dark","frameType":"dark","exposureSeconds":120,"count":30,"gain":100,"offset":50,"cooler":"on","setpoint":-10,"waitForSetpoint":true}'])
  })

  it('refuses darks while a run is capturing, or at a temperature the camera cannot reach', async () => {
    expect(await setup(camera, true).press(controls => controls.takeDarks(30, 120, -10))).toMatchObject({ failure: { refusal: { code: 'run-active' } } })
    expect(await setup(camera).press(controls => controls.takeDarks(30, 120, -60))).toMatchObject({ failure: { refusal: { code: 'out-of-range' } } })
  })

  it('takes dark flats as dark frames named apart from darks, and bias at the shortest exposure', async () => {
    const { sent, press } = setup(camera)

    expect(await press(controls => controls.takeDarkFlats(30, 0.5, -10))).toMatchObject({ success: { code: 'dark-flats', frames: 30, exposureSeconds: 0.5, celsius: -10 } })
    expect(await press(controls => controls.takeBias(30, -10))).toMatchObject({ success: { code: 'bias', frames: 30, celsius: -10 } })
    expect(sent).toEqual([
      'capture {"object":"dark-flat","frameType":"dark","exposureSeconds":0.5,"count":30,"gain":100,"offset":50,"cooler":"on","setpoint":-10,"waitForSetpoint":true}',
      'capture {"object":"bias","frameType":"bias","exposureSeconds":0.000032,"count":30,"gain":100,"offset":50,"cooler":"on","setpoint":-10,"waitForSetpoint":true}',
    ])
  })
})
