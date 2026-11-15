import { Data, Effect } from 'effect'
import { cutPlan, tilesOf, type SkyCut } from '../../../../../state/sky-cut.ts'
import { surveyTilesPath, tileFile } from '../../../../../state/survey.ts'

class TileMissing extends Data.TaggedError('TileMissing')<{ readonly tile: number }> {}

const channels = 4
const opaque = 255

const tilePixels = (order: number, tileWidth: number, tile: number): Effect.Effect<Uint8ClampedArray | undefined> =>
  Effect.tryPromise({
    try: async () => {
      const image = new Image()

      image.src = `${surveyTilesPath}/${tileFile(order, tile)}`
      await image.decode()

      const scratch = new OffscreenCanvas(tileWidth, tileWidth).getContext('2d')

      if (scratch === null) throw new Error('no canvas')

      scratch.drawImage(image, 0, 0)

      return scratch.getImageData(0, 0, tileWidth, tileWidth).data
    },
    catch: () => new TileMissing({ tile }),
  }).pipe(Effect.catchTag('TileMissing', () => Effect.succeed(undefined)))

const cutFrom = (cut: SkyCut): Effect.Effect<ImageData> =>
  Effect.gen(function* () {
    const plan = cutPlan(cut)
    const needed = tilesOf(plan)
    const loaded = yield* Effect.forEach(needed, tile => tilePixels(cut.order, cut.tileWidth, tile), { concurrency: 'unbounded' })
    const pixelsOf = new Map(needed.map((tile, index) => [tile, loaded[index]]))
    const picture = new ImageData(cut.widthPixels, cut.heightPixels)

    for (let at = 0; at < plan.tiles.length; at += 1) {
      const source = pixelsOf.get(plan.tiles[at]!)
      const into = at * channels

      picture.data[into + 3] = opaque

      if (source === undefined) continue

      const from = (plan.rows[at]! * cut.tileWidth + plan.columns[at]!) * channels

      picture.data[into] = source[from]!
      picture.data[into + 1] = source[from + 1]!
      picture.data[into + 2] = source[from + 2]!
    }

    return picture
  })

export const skyPictureOf = (cut: SkyCut): Promise<ImageData> => Effect.runPromise(cutFrom(cut))
