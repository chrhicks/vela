import { Effect, Layer, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Entry } from '../../state/entry.ts'
import { emptyRig } from '../../state/rig.ts'
import { entry } from '../../state/testing.ts'
import type { Outcome, Request } from '../commands/sender.ts'
import { Feed } from '../feed/feed.ts'
import { deviceCommandsFrom } from './device-commands.ts'
import type { Guiding } from '../../state/guiding.ts'
import { guidingControls, GuidingSettings, mountGuiding } from './guiding.ts'

const deviceIds = { mount: 'mount', primary: 'primary', focuser: 'focuser', box: 'box', guide: 'guide' }

type Controls = Effect.Success<typeof guidingControls>

type Replying = (method: string) => Readonly<Record<string, unknown>> | undefined

function setup(replying: Replying, outcome: Outcome = { result: 'written' }, guiding: Guiding = emptyRig.guiding) {
  const asked: Array<string> = []
  const replies: Array<Entry> = []
  let ids = 0
  const ask = (request: Request) => {
    asked.push(`${request.device} ${JSON.stringify(request.body)}`)

    const reply = replying(String(request.body['method']))

    if (reply !== undefined) replies.push(entry('phd2.reply', 1, { jsonrpc: '2.0', id: request.id, ...reply }))

    return Promise.resolve(outcome)
  }
  const subscribe = Effect.sync(() => ({ state: emptyRig, entries: Stream.suspend(() => (replies.length === 0 ? Stream.never : Stream.fromIterable([...replies]))) }))
  const feed = Layer.succeed(Feed, { receive: () => Effect.void, subscribe, current: Effect.succeed({ ...emptyRig, guiding }) })
  const commands = deviceCommandsFrom({ send: () => Promise.resolve({ result: 'written' }), ask, tell: () => undefined, deviceIds, answerSeconds: 10 })
  const settings = Layer.succeed(GuidingSettings, { settle: { pixels: 1.5, time: 10, timeout: 90 }, replySeconds: 0.05, connectSeconds: 0.05, newId: Effect.sync(() => `id-${(ids += 1)}`) })
  const press = (choose: (controls: Controls) => Effect.Effect<unknown, unknown>) => Effect.runPromise(Effect.flatMap(guidingControls, choose).pipe(Effect.result, Effect.provide(Layer.mergeAll(feed, commands, settings))))
  const around = (choose: (around: Effect.Success<typeof mountGuiding>) => Effect.Effect<unknown, unknown>) => Effect.runPromise(Effect.flatMap(mountGuiding, choose).pipe(Effect.result, Effect.provide(Layer.mergeAll(feed, commands, settings))))

  return { asked, press, around }
}

const guide = 'phd2 {"method":"guide","params":{"settle":{"pixels":1.5,"time":10,"timeout":90},"recalibrate":false}}'

describe('Guiding', () => {
  it("start connects PHD2's equipment when it is not connected, then guides", async () => {
    const { asked, press } = setup(method => ({ result: method === 'get_connected' ? false : 0 }))

    expect(await press(controls => controls.startGuiding)).toMatchObject({ success: { code: 'guiding-starting', recalibrate: false } })
    expect(asked).toEqual(['phd2 {"method":"get_connected"}', 'phd2 {"method":"set_connected","params":{"connected":true}}', guide])
  })

  it('start goes straight to guiding when the equipment is connected; calibrate asks for a new calibration', async () => {
    const started = setup(method => ({ result: method === 'get_connected' ? true : 0 }))
    const calibrated = setup(method => ({ result: method === 'get_connected' ? true : 0 }))

    await started.press(controls => controls.startGuiding)

    expect(await calibrated.press(controls => controls.calibrateGuiding)).toMatchObject({ success: { code: 'guiding-starting', recalibrate: true } })
    expect(started.asked).toEqual(['phd2 {"method":"get_connected"}', guide])
    expect(calibrated.asked[1]).toBe('phd2 {"method":"guide","params":{"settle":{"pixels":1.5,"time":10,"timeout":90},"recalibrate":true}}')
  })

  it('pick new star loops, picks a star, then guides; stop stops the capture', async () => {
    const picked = setup(method => ({ result: method === 'get_connected' ? true : 0 }))
    const stopped = setup(() => ({ result: 0 }))

    await picked.press(controls => controls.pickGuideStar)

    expect(await stopped.press(controls => controls.stopGuiding)).toMatchObject({ success: { code: 'guiding-stopped' } })
    expect(picked.asked).toEqual(['phd2 {"method":"get_connected"}', 'phd2 {"method":"loop"}', 'phd2 {"method":"find_star"}', guide])
    expect(stopped.asked).toEqual(['phd2 {"method":"stop_capture"}'])
  })

  it("answers with PHD2's own error, with its silence, and with the rig program's refusal", async () => {
    const refused = setup(method => (method === 'get_connected' ? { result: true } : { error: { code: 1, message: 'could not find star' } }))
    const silent = setup(() => undefined)
    const away = setup(() => undefined, { result: 'refused', reason: 'PHD2 is not connected' })

    expect(await refused.press(controls => controls.startGuiding)).toMatchObject({ failure: { refusal: { code: 'guider-refused', text: 'could not find star' } } })
    expect(await silent.press(controls => controls.stopGuiding)).toMatchObject({ failure: { refusal: { code: 'guider-silent', seconds: 0.05 } } })
    expect(await away.press(controls => controls.stopGuiding)).toMatchObject({ failure: { refusal: { code: 'rig-refused', text: 'PHD2 is not connected' } } })
  })

  it('refuses when the answer to get_connected is not yes or no, and asks PHD2 for nothing more', async () => {
    const { asked, press } = setup(() => ({ result: 'maybe' }))

    expect(await press(controls => controls.startGuiding)).toMatchObject({ failure: { refusal: { code: 'guider-refused' } } })
    expect(asked).toEqual(['phd2 {"method":"get_connected"}'])
  })
})

describe('guiding around a mount move', () => {
  it('stops PHD2 and says guiding was on, so a flip can start it again', async () => {
    const { asked, around } = setup(() => ({ result: 0 }), undefined, { link: 'connected', activity: 'guiding' })

    expect(await around(guider => guider.stop)).toMatchObject({ success: true })
    expect(asked).toEqual(['phd2 {"method":"stop_capture"}'])
  })

  it('stops a loop without counting it as guiding, and leaves a stopped or unlinked PHD2 alone', async () => {
    const looping = setup(() => ({ result: 0 }), undefined, { link: 'connected', activity: 'looping' })
    const stopped = setup(() => ({ result: 0 }), undefined, { link: 'connected', activity: 'stopped' })
    const unlinked = setup(() => ({ result: 0 }), undefined, { link: 'closed', activity: 'guiding' })

    expect(await looping.around(guider => guider.stop)).toMatchObject({ success: false })
    expect(await stopped.around(guider => guider.stop)).toMatchObject({ success: false })
    expect(await unlinked.around(guider => guider.stop)).toMatchObject({ success: false })
    expect([looping.asked, stopped.asked, unlinked.asked]).toEqual([['phd2 {"method":"stop_capture"}'], [], []])
  })

  it("passes on PHD2's silence when it does not answer the stop", async () => {
    const { around } = setup(() => undefined, undefined, { link: 'connected', activity: 'guiding' })

    expect(await around(guider => guider.stop)).toMatchObject({ failure: { refusal: { code: 'guider-silent' } } })
  })
})
