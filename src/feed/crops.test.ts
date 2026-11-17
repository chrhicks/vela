import { Context, Effect } from 'effect'
import { HttpRouter } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { FrameFile, NightName } from '../../state/entries.ts'
import { frameCropPath, frameShapePath } from '../../state/frames.ts'
import { develop } from '../frames/crop.ts'
import { syntheticFits } from '../testing/fits.ts'
import { decodePng } from '../testing/png.ts'
import { DevelopedFrames, FrameCropRoute, FrameShapeRoute, FrameUndeveloped } from './crops.ts'

const developed = develop(syntheticFits({ width: 16, height: 12, pattern: 'RGGB', rowOrder: 'TOP-DOWN', pixel: (x, y) => 1000 + ((x * 7 + y * 13) % 5) * 20 }), { bin: 1, blackSigmas: 2.8, targetMedian: 0.25 })

const frames = Context.make(DevelopedFrames, {
  get: (night, file) =>
    file === FrameFile.make('kept.fits') ? Effect.succeed(developed) : file === FrameFile.make('torn.fits') ? Effect.fail(new FrameUndeveloped({ night, file, cause: 'short file' })) : Effect.succeed(undefined),
})

async function get(route: typeof FrameCropRoute, address: string) {
  const { handler, dispose } = HttpRouter.toWebHandler(route, { disableLogger: true })
  const response = await handler(new Request(`http://localhost${address}`), frames)
  const bytes = Buffer.from(await response.arrayBuffer())

  await dispose()

  return { status: response.status, type: response.headers.get('content-type'), bytes }
}

const night = NightName.make('2026-11-08')

describe('a kept frame at full size', () => {
  it('GET /frame-shape answers with the frame in camera pixels', async () => {
    const answer = await get(FrameShapeRoute, `${frameShapePath}?night=${night}&file=kept.fits`)

    expect(answer.status).toBe(200)
    expect(JSON.parse(answer.bytes.toString('utf8'))).toEqual({ width: 16, height: 12 })
  })

  it('GET /frame-crop answers with a picture of the box asked, one pixel a camera pixel', async () => {
    const answer = await get(FrameCropRoute, `${frameCropPath}?night=${night}&file=kept.fits&x=4&y=2&width=8&height=6`)

    expect([answer.status, answer.type]).toEqual([200, 'image/png'])
    expect(decodePng(answer.bytes)).toMatchObject({ width: 8, height: 6 })
  })

  it('says 400 to a box outside the frame or with no numbers, 404 to a frame not kept and 500 to one it cannot read', async () => {
    expect((await get(FrameCropRoute, `${frameCropPath}?night=${night}&file=kept.fits&x=12&y=2&width=8&height=6`)).status).toBe(400)
    expect((await get(FrameCropRoute, `${frameCropPath}?night=${night}&file=kept.fits&x=a&y=2&width=8&height=6`)).status).toBe(400)
    expect((await get(FrameCropRoute, `${frameCropPath}?night=${night}&file=gone.fits&x=0&y=0&width=8&height=6`)).status).toBe(404)
    expect((await get(FrameCropRoute, `${frameCropPath}?night=${night}&file=torn.fits&x=0&y=0&width=8&height=6`)).status).toBe(500)
    expect((await get(FrameShapeRoute, `${frameShapePath}?night=${night}&file=gone.fits`)).status).toBe(404)
  })
})
