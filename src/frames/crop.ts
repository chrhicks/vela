import { Data, Result } from 'effect'
import { readFits } from './fits.ts'
import { encodePng } from './png.ts'
import { colourAtOf, isTopDown, stretch, superpixels, type PreviewSettings } from './preview.ts'

export interface CropBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Developed {
  readonly width: number
  readonly height: number
  readonly pixels: Uint16Array
  readonly colourAt: (x: number, y: number) => number
  readonly tables: ReadonlyArray<Uint8Array>
  readonly topDown: boolean
}

export class CropOutside extends Data.TaggedError('CropOutside')<{ readonly box: CropBox; readonly width: number; readonly height: number }> {}

const colours = 3

export function develop(bytes: Buffer, settings: PreviewSettings): Developed {
  const fits = readFits(bytes)

  return {
    width: fits.width,
    height: fits.height,
    pixels: fits.pixels,
    colourAt: colourAtOf(fits),
    tables: superpixels(fits, settings.bin).planes.map(plane => stretch(plane, settings)),
    topDown: isTopDown(fits),
  }
}

const inside = ({ x, y, width, height }: CropBox, frame: Developed) =>
  [x, y, width, height].every(Number.isInteger) && x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= frame.width && y + height <= frame.height

export function cropOf(frame: Developed, box: CropBox): Result.Result<Buffer, CropOutside> {
  if (!inside(box, frame)) return Result.fail(new CropOutside({ box, width: frame.width, height: frame.height }))

  const rgb = new Uint8Array(box.width * box.height * colours)

  for (let row = 0; row < box.height; row += 1) {
    const shownRow = box.y + row
    const y = frame.topDown ? shownRow : frame.height - 1 - shownRow

    for (let column = 0; column < box.width; column += 1) {
      const x = box.x + column
      const own = frame.colourAt(x, y)
      const sums = [0, 0, 0]
      const counts = [0, 0, 0]

      for (let nearY = Math.max(0, y - 1); nearY <= Math.min(frame.height - 1, y + 1); nearY += 1) {
        for (let nearX = Math.max(0, x - 1); nearX <= Math.min(frame.width - 1, x + 1); nearX += 1) {
          const colour = frame.colourAt(nearX, nearY)

          if (colour === own && (nearX !== x || nearY !== y)) continue

          sums[colour]! += frame.pixels[nearY * frame.width + nearX]!
          counts[colour]! += 1
        }
      }

      for (let colour = 0; colour < colours; colour += 1) {
        rgb[(row * box.width + column) * colours + colour] = frame.tables[colour]![Math.round(sums[colour]! / Math.max(1, counts[colour]!))]!
      }
    }
  }

  return Result.succeed(encodePng(box.width, box.height, rgb))
}
