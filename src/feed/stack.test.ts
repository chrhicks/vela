import { Context, Effect, Result } from 'effect'
import { HttpRouter } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { NightName } from '../../state/entries.ts'
import { stackCropPath, stackShapePath } from '../../state/stack.ts'
import { CropOutside, isInside } from '../frames/crop.ts'
import { StackCropRoute, StackPictures, StackShapeRoute } from './stack.ts'

const whole = { width: 20, height: 12 }
const png = Uint8Array.from([137, 80, 78, 71])

const pictures = Context.make(StackPictures, {
  picture: () => Effect.succeed(undefined),
  shape: (_night, sequence) => Effect.succeed(sequence === 'M-33_light' ? whole : undefined),
  crop: (_night, sequence, box) => Effect.succeed(sequence !== 'M-33_light' ? undefined : isInside(box, whole) ? Result.succeed({ png, frames: 3 }) : Result.fail(new CropOutside({ box, ...whole }))),
})

async function get(route: typeof StackCropRoute, address: string) {
  const { handler, dispose } = HttpRouter.toWebHandler(route, { disableLogger: true })
  const response = await handler(new Request(`http://localhost${address}`), pictures)
  const bytes = Buffer.from(await response.arrayBuffer())

  await dispose()

  return { status: response.status, type: response.headers.get('content-type'), cache: response.headers.get('cache-control'), bytes }
}

const night = NightName.make('2026-11-15')

describe("the night's stack at full size", () => {
  it('GET /stack-shape answers with the stack in its own pixels', async () => {
    const answer = await get(StackShapeRoute, `${stackShapePath}?night=${night}&sequence=M-33_light`)

    expect(answer.status).toBe(200)
    expect(JSON.parse(answer.bytes.toString('utf8'))).toEqual(whole)
    expect((await get(StackShapeRoute, `${stackShapePath}?night=${night}&sequence=NGC-7635_light`)).status).toBe(404)
  })

  it('GET /stack-crop answers with the box asked, kept for good only while the frame count matches', async () => {
    const current = await get(StackCropRoute, `${stackCropPath}?night=${night}&sequence=M-33_light&frames=3&x=0&y=0&width=10&height=6`)
    const behind = await get(StackCropRoute, `${stackCropPath}?night=${night}&sequence=M-33_light&frames=2&x=0&y=0&width=10&height=6`)

    expect([current.status, current.type, current.cache, [...current.bytes]]).toEqual([200, 'image/png', 'public, max-age=31536000, immutable', [...png]])
    expect([behind.status, behind.cache]).toEqual([200, 'no-store'])
  })

  it('says 400 to a box outside the stack or with no numbers, and 404 to a target not stacked', async () => {
    expect((await get(StackCropRoute, `${stackCropPath}?night=${night}&sequence=M-33_light&x=15&y=0&width=10&height=6`)).status).toBe(400)
    expect((await get(StackCropRoute, `${stackCropPath}?night=${night}&sequence=M-33_light&x=left&y=0&width=10&height=6`)).status).toBe(400)
    expect((await get(StackCropRoute, `${stackCropPath}?night=${night}&sequence=NGC-7635_light&x=0&y=0&width=10&height=6`)).status).toBe(404)
  })
})
