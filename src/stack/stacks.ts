import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readFits } from '../frames/fits.ts'
import { listNight } from '../frames/library.ts'
import { stretch, superpixels, text, type PreviewSettings } from '../frames/preview.ts'
import { encodePng } from '../frames/png.ts'
import { isLight, pointingOf, readSolution, statsName, type PlateSolution, type SkyPosition } from '../frames/stats.ts'
import { makeStack, type Stack } from './stack.ts'

export interface StackedFrame {
  readonly night: string
  readonly file: string
  readonly sequence?: string | undefined
}

export interface StackCount {
  readonly night: string
  readonly sequence: string
  readonly frames: number
  readonly leftOut: number
}

export interface StacksOptions {
  readonly keepDir: string
  readonly preview: PreviewSettings
  readonly solve: (path: string, near: SkyPosition) => Promise<string>
}

interface Kept {
  readonly stack: Stack
  readonly topDown: boolean
  picture: Buffer | undefined
}

const stacked = (sequence: string | undefined): sequence is string => sequence !== undefined && !sequence.startsWith('test-frame')

async function keptSolution(path: string): Promise<PlateSolution | null> {
  const stats = await readFile(statsName(path), 'utf8').then(
    text => JSON.parse(text) as { readonly solution?: PlateSolution | null },
    () => undefined,
  )

  return stats?.solution ?? null
}

export function makeStacks({ keepDir, preview, solve }: StacksOptions) {
  const kept = new Map<string, Kept>()
  const leftOut = new Map<string, number>()
  const added = new Set<string>()
  let night: string | undefined

  const countOf = (frameNight: string, sequence: string): StackCount => ({ night: frameNight, sequence, frames: kept.get(sequence)?.stack.frames ?? 0, leftOut: leftOut.get(sequence) ?? 0 })
  const leaveOut = (sequence: string) => leftOut.set(sequence, (leftOut.get(sequence) ?? 0) + 1)

  async function add(frame: StackedFrame, known: PlateSolution | null | undefined): Promise<StackCount | undefined> {
    if (!stacked(frame.sequence) || added.has(`${frame.night}/${frame.file}`)) return undefined

    const path = join(keepDir, frame.night, frame.file)
    const fits = readFits(await readFile(path))

    if (!isLight(fits.header)) return undefined
    if (frame.night !== night) {
      kept.clear()
      leftOut.clear()
      added.clear()
      night = frame.night
    }

    added.add(`${frame.night}/${frame.file}`)

    const near = pointingOf(fits.header)
    const solution = known ?? (await keptSolution(path)) ?? (near === undefined ? null : readSolution(await solve(path, near).catch(() => '')))
    const binned = { ...superpixels(fits, preview.bin), cell: preview.bin * 2 }

    if (solution === null) {
      leaveOut(frame.sequence)

      return countOf(frame.night, frame.sequence)
    }

    const entry = kept.get(frame.sequence) ?? { stack: makeStack(solution, binned), topDown: text(fits.header, 'ROWORDER')?.toUpperCase() === 'TOP-DOWN', picture: undefined }

    if (!entry.stack.add(binned, solution)) leaveOut(frame.sequence)

    entry.picture = undefined
    kept.set(frame.sequence, entry)

    return countOf(frame.night, frame.sequence)
  }

  function picture(asked: string, sequence: string): Buffer | undefined {
    const entry = asked === night ? kept.get(sequence) : undefined

    if (entry === undefined || entry.stack.frames === 0) return undefined
    if (entry.picture !== undefined) return entry.picture

    const { width, height } = entry.stack
    const planes = entry.stack.mean()
    const tables = planes.map(plane => stretch(plane, preview))
    const rgb = new Uint8Array(width * height * 3)

    for (let row = 0; row < height; row += 1) {
      const source = entry.topDown ? row : height - 1 - row

      for (let column = 0; column < width; column += 1) {
        for (let channel = 0; channel < 3; channel += 1) rgb[(row * width + column) * 3 + channel] = tables[channel]?.[planes[channel]?.[source * width + column] ?? 0] ?? 0
      }
    }

    entry.picture = encodePng(width, height, rgb)

    return entry.picture
  }

  async function rebuild(tonight: string, each: (count: StackCount) => void) {
    const { frames } = await listNight(keepDir, tonight)

    for (const row of [...frames].reverse()) {
      const count = await add({ night: tonight, file: row.file, sequence: row.sequence ?? undefined }, undefined).catch(() => undefined)

      if (count !== undefined) each(count)
    }
  }

  return { add, picture, rebuild }
}
