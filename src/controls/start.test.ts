import { Effect, Fiber, Layer, Stream } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { StartId, type RunEnding, type TargetStepBody } from '../../state/entries.ts'
import type { Entry } from '../../state/entry.ts'
import type { RigState } from '../../state/rig.ts'
import { entry, foldRig, wire } from '../../state/testing.ts'
import type { CaptureRequest } from '../capture/request.ts'
import { testCatalog } from '../catalog/testing.ts'
import type { Command, Outcome, Request } from '../commands/sender.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import { Capturing } from './camera.ts'
import { deviceCommandsFrom } from './device-commands.ts'
import { Autofocusing } from './focus.ts'
import { GuidingSettings } from './guiding.ts'
import { startControls, StartLog, StartRunning, StartSettings, TargetCatalog, TargetCentring } from './start.ts'

const deviceIds = { mount: 'mount', primary: 'asi', focuser: 'focuser', box: 'box', guide: 'guide' }

const ready = (): RigState => ({
  ...foldRig([wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), wire('primary', 'CCD_CONTROLS', { Gain: 100, Offset: 50 })]),
  heardAt: Date.now(),
})

const homeReported = (state: string) => entry('wire', 1, { dir: 'in', device: 'mount', type: 'set', property: 'TELESCOPE_HOME', state, elements: { GO: state === 'Busy' } })

const done: RunEnding = 'done'

const settleDone = entry('phd2.SettleDone', 1, { Event: 'SettleDone', Status: 0 })

interface Options {
  readonly rig?: RigState
  readonly busy?: boolean
  readonly centreRefused?: boolean
  readonly mountAnswers?: boolean
}

function setup({ rig = ready(), busy = false, centreRefused = false, mountAnswers = true }: Options = {}) {
  const did: Array<string> = []
  const reported: Array<string> = []
  const started: Array<CaptureRequest> = []
  const heard: Array<Entry> = mountAnswers ? [homeReported('Busy'), homeReported('Ok'), settleDone] : []
  let ids = 0
  let routine: Fiber.Fiber<void> | undefined

  const send = (command: Command) => (did.push(`${command.device} ${command.property}`), Promise.resolve<Outcome>({ result: 'written' }))
  const ask = (request: Request) => {
    did.push(`guider ${String(request.body['method'])}`)
    heard.push(entry('phd2.reply', 1, { jsonrpc: '2.0', id: request.id, result: true }))

    return Promise.resolve<Outcome>({ result: 'written' })
  }
  const entries = Stream.suspend(() => (mountAnswers ? Stream.concat(Stream.fromIterable([...heard]), Stream.never) : Stream.never))
  const report = (step: TargetStepBody) => Effect.sync(() => void reported.push(`${step.step} ${step.outcome}${step.refusal === undefined ? '' : ` ${step.refusal.code}`}`))

  const services = Layer.mergeAll(
    Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.sync(() => ({ state: rig, entries })), current: Effect.succeed(rig) }),
    deviceCommandsFrom({ send, ask, tell: () => undefined, deviceIds, answerSeconds: 10 }),
    Layer.succeed(GuidingSettings, { settle: { pixels: 1.5, time: 10, timeout: 90 }, replySeconds: 1, connectSeconds: 1, newId: Effect.sync(() => `guider-${(ids += 1)}`) }),
    Layer.succeed(Capturing, { busy: Effect.succeed(busy), start: (request: CaptureRequest) => Effect.sync(() => void started.push(request)), finished: Effect.succeed(done) }),
    Layer.succeed(TargetCentring, {
      centre: id => (centreRefused ? Effect.fail(new CommandRefused({ refusal: { code: 'refused', text: 'the mount is parked' } })) : Effect.sync(() => void did.push(`centre ${id}`))),
    }),
    Layer.succeed(Autofocusing, { start: exposureSeconds => Effect.sync(() => void did.push(`autofocus ${exposureSeconds}`)) }),
    Layer.succeed(TargetCatalog, { find: id => testCatalog.find(id) }),
    Layer.succeed(StartLog, { report }),
    Layer.succeed(StartRunning, { busy: Effect.sync(() => routine !== undefined), began: begun => Effect.sync(() => void (routine = begun)) }),
    Layer.succeed(StartSettings, { homeSeconds: 5, guidingSeconds: 5, rigSilentAfterSeconds: 10, autofocusExposureSeconds: { in: 10, out: 2 }, newId: Effect.succeed(StartId.make('start-1')) }),
  )

  const press = (id: string, exposureSeconds: number, frames: number | undefined, centre?: { readonly raDegrees: number; readonly decDegrees: number }) =>
    Effect.runPromise(Effect.flatMap(startControls, controls => controls.startTarget(id, exposureSeconds, frames, centre)).pipe(Effect.result, Effect.provide(services)))

  return { did, reported, started, press, finished: () => Effect.runPromise(Fiber.await(routine!)), stop: () => Effect.runPromise(Fiber.interrupt(routine!)), underWay: () => vi.waitFor(() => expect(reported).toContain('home started')) }
}

describe('Start a target', () => {
  it('goes home, stops guiding, centres, focuses, guides and then starts the run, in that order', async () => {
    const { did, started, press, finished } = setup()

    expect(await press('orion', 120, 100)).toMatchObject({ success: { code: 'starting-target', name: 'M 42', exposureSeconds: 120, frames: 100 } })
    await finished()

    expect(did).toEqual(['mount TELESCOPE_HOME', 'guider stop_capture', 'centre orion', 'autofocus 2', 'guider get_connected', 'guider guide'])
    expect(started).toEqual([{ object: 'M 42', frameType: 'light', exposureSeconds: 120, count: 100, gain: 100, offset: 50, cooler: 'keep', target: { id: 'orion', name: 'M 42', raDegrees: 83.82, decDegrees: -5.39 } }])
  })

  it('reports each step as it starts and as it ends', async () => {
    const { reported, press, finished } = setup()

    await press('orion', 60, undefined)
    await finished()

    expect(reported).toEqual(['home started', 'home done', 'stop-guiding started', 'stop-guiding done', 'centre started', 'centre done', 'autofocus started', 'autofocus done', 'guiding started', 'guiding done', 'capture started', 'capture done'])
  })

  it('says why a step failed and goes on to the next', async () => {
    const { reported, started, press, finished } = setup({ centreRefused: true })

    await press('orion', 60, 300)
    await finished()

    expect(reported).toContain('centre failed refused')
    expect(reported.slice(-2)).toEqual(['capture started', 'capture done'])
    expect(started).toHaveLength(1)
  })

  it('reports the step under way as stopped when the routine is stopped, and starts no more', async () => {
    const { reported, started, press, stop, underWay } = setup({ mountAnswers: false })

    await press('orion', 60, 300)
    await underWay()
    await stop()

    expect(reported).toEqual(['home started', 'home stopped'])
    expect(started).toEqual([])
  })

  it('centres on a given position while the run stays on the target', async () => {
    const { did, started, press, finished } = setup()

    await press('orion', 60, 300, { raDegrees: 83.9, decDegrees: -5.2 })
    await finished()

    expect(did).toContain('centre 83.900000 -5.200000')
    expect(started[0]).toMatchObject({ object: 'M 42', target: { id: 'orion', raDegrees: 83.82 } })
  })

  it('names a typed position in plain letters, for the files and the header', async () => {
    const { started, press, finished } = setup()

    await press('23h18m56s +61d33m37s', 60, 300)
    await finished()

    expect(started[0]).toMatchObject({ object: '23h18m56s +61d33m37s', target: { name: '23h18m56s +61d33m37s' } })
  })

  it('refuses at the press, and moves nothing, for an unknown target, a silent rig, a mount or camera that has not reported, and a run already going', async () => {
    const silent = { ...ready(), heardAt: Date.now() - 60_000 }
    const noMount = { ...foldRig([wire('primary', 'CCD_CONTROLS', { Gain: 100, Offset: 50 })]), heardAt: Date.now() }
    const noCamera = { ...foldRig([wire('mount', 'CONNECTION', { CONNECT: true, DISCONNECT: false })]), heardAt: Date.now() }
    const cases = [
      [setup(), 'nowhere', { code: 'unknown-target', text: 'nowhere' }],
      [setup({ rig: silent }), 'orion', { code: 'rig-silent', seconds: 60 }],
      [setup({ rig: noMount }), 'orion', { code: 'not-connected', device: 'mount' }],
      [setup({ rig: noCamera }), 'orion', { code: 'not-connected', device: 'primary' }],
      [setup({ busy: true }), 'orion', { code: 'run-active' }],
    ] as const

    for (const [rig, id, refusal] of cases) {
      expect(await rig.press(id, 60, 1)).toMatchObject({ failure: { refusal } })
      expect([...rig.did, ...rig.reported, ...rig.started]).toEqual([])
    }
  })
})
