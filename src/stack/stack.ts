import type { PlateSolution } from '../frames/stats.ts'
import { toPixel, toSky } from './tan.ts'

export interface Binned {
  readonly width: number
  readonly height: number
  readonly cell: number
  readonly planes: ReadonlyArray<Uint16Array>
}

export interface Stack {
  readonly width: number
  readonly height: number
  readonly frames: number
  readonly add: (frame: Binned, solution: PlateSolution) => boolean
  readonly mean: () => ReadonlyArray<Uint16Array>
}

const fullPixel = (binned: number, cell: number) => binned * cell + (cell - 1) / 2 + 1

const binnedPixel = (full: number, cell: number) => (full - 1 - (cell - 1) / 2) / cell

function sample(plane: Uint16Array, width: number, x: number, y: number) {
  const left = Math.floor(x)
  const top = Math.floor(y)
  const across = x - left
  const down = y - top
  const at = top * width + left

  return (
    (plane[at] ?? 0) * (1 - across) * (1 - down) +
    (plane[at + 1] ?? 0) * across * (1 - down) +
    (plane[at + width] ?? 0) * (1 - across) * down +
    (plane[at + width + 1] ?? 0) * across * down
  )
}

export function makeStack(reference: PlateSolution, { width, height, cell }: Omit<Binned, 'planes'>): Stack {
  const sums = [new Float32Array(width * height), new Float32Array(width * height), new Float32Array(width * height)]
  const covered = new Uint16Array(width * height)
  const skyRa = new Float64Array(width * height)
  const skyDec = new Float64Array(width * height)

  for (let at = 0; at < skyRa.length; at += 1) {
    const { raDegrees, decDegrees } = toSky(reference, { x: fullPixel(at % width, cell), y: fullPixel(Math.floor(at / width), cell) })

    skyRa[at] = raDegrees
    skyDec[at] = decDegrees
  }
  let frames = 0

  return {
    width,
    height,
    get frames() {
      return frames
    },
    add(frame, solution) {
      if (frame.width !== width || frame.height !== height || frame.cell !== cell) return false

      for (let at = 0; at < skyRa.length; at += 1) {
        const pixel = toPixel(solution, { raDegrees: skyRa[at] ?? 0, decDegrees: skyDec[at] ?? 0 })

        if (pixel === undefined) continue

        const x = binnedPixel(pixel.x, cell)
        const y = binnedPixel(pixel.y, cell)

        if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) continue

        sums.forEach((sum, channel) => {
          const plane = frame.planes[channel]

          if (plane !== undefined) sum[at] = (sum[at] ?? 0) + sample(plane, width, x, y)
        })
        covered[at] = (covered[at] ?? 0) + 1
      }

      frames += 1

      return true
    },
    mean: () => sums.map(sum => Uint16Array.from(sum, (total, at) => Math.round(total / Math.max(1, covered[at] ?? 0)))),
  }
}
