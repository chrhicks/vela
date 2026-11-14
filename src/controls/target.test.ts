import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { RigState } from '../../state/rig.ts'
import { foldRig, wire } from '../../state/testing.ts'
import type { CaptureRequest } from '../capture/request.ts'
import { testCatalog } from '../catalog/testing.ts'
import { Feed } from '../feed/feed.ts'
import { Capturing } from './camera.ts'
import { TargetCatalog, targetControls } from './target.ts'

const camera = foldRig([wire('primary', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), wire('primary', 'CCD_CONTROLS', { Gain: 100, Offset: 50 })])
const noCamera = foldRig([])

function setup(rig: RigState, busy = false) {
  const started: Array<CaptureRequest> = []
  const capturing = Layer.succeed(Capturing, { busy: Effect.succeed(busy), start: (request: CaptureRequest) => Effect.sync(() => void started.push(request)), finished: Effect.succeed(undefined) })
  const feed = Layer.succeed(Feed, { receive: () => Effect.void, subscribe: Effect.die('not used'), current: Effect.succeed(rig) })
  const catalog = Layer.succeed(TargetCatalog, { find: id => testCatalog.find(id) })
  const start = (id: string, exposureSeconds: number, frames: number | undefined) =>
    Effect.runPromise(Effect.flatMap(targetControls, controls => controls.startTarget(id, exposureSeconds, frames)).pipe(Effect.result, Effect.provide(Layer.mergeAll(feed, capturing, catalog))))

  return { started, start }
}

describe('Start a target', () => {
  it("starts a light run named by the target's catalog name, with the camera's own gain and offset and the cooler left alone", async () => {
    const { started, start } = setup(camera)

    expect(await start('orion', 120, 100)).toMatchObject({ success: { code: 'capturing-target', name: 'M 42', exposureSeconds: 120, frames: 100 } })
    expect(started).toEqual([
      { object: 'M 42', frameType: 'light', exposureSeconds: 120, count: 100, gain: 100, offset: 50, cooler: 'keep', target: { id: 'orion', name: 'M 42', raDegrees: 83.82, decDegrees: -5.39 } },
    ])
  })

  it('runs until stopped when no frame count is given', async () => {
    const { started, start } = setup(camera)

    expect(await start('orion', 60, undefined)).toMatchObject({ success: { code: 'capturing-target', name: 'M 42', exposureSeconds: 60 } })
    expect(started[0]).not.toHaveProperty('count')
  })

  it('takes typed coordinates as the target', async () => {
    const { started, start } = setup(camera)

    await start('23h18m56s +61d33m37s', 60, 300)

    expect(started[0]).toMatchObject({ object: '23h18m56s +61°33′37″', target: { name: '23h18m56s +61°33′37″' } })
  })

  it('refuses a target that is not in the catalog, a camera that has not reported, and a run already going, and starts nothing', async () => {
    const unknown = setup(camera)
    const silent = setup(noCamera)
    const busy = setup(camera, true)

    expect(await unknown.start('nowhere', 60, 1)).toMatchObject({ failure: { refusal: { code: 'unknown-target', text: 'nowhere' } } })
    expect(await silent.start('orion', 60, 1)).toMatchObject({ failure: { refusal: { code: 'not-connected', device: 'primary' } } })
    expect(await busy.start('orion', 60, 1)).toMatchObject({ failure: { refusal: { code: 'run-active' } } })
    expect([...unknown.started, ...silent.started, ...busy.started]).toEqual([])
  })
})
