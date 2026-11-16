import { Schema } from 'effect'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readFits } from '../frames/fits.ts'
import { listNight } from '../frames/library.ts'
import { stretch, superpixels, text, type PreviewSettings } from '../frames/preview.ts'
import { encodePng } from '../frames/png.ts'
import type { SkyPosition } from '../../state/entries.ts'
import { fieldHeightDegrees, isLight, PlateSolution, pointingOf, readSolution, statsName } from '../frames/stats.ts'
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
  readonly solve: (path: string, near: SkyPosition, fieldDegrees: number | undefined) => Promise<string>
  readonly failed: (file: string, error: unknown) => void
}

interface Kept {
  readonly stack: Stack
  readonly topDown: boolean
  picture: Buffer | undefined
}

const stacked = (sequence: string | undefined): sequence is string => sequence !== undefined && !sequence.startsWith('test-frame')

const decodeKept = Schema.decodeUnknownPromise(Schema.fromJsonString(Schema.Struct({ solution: Schema.optionalKey(Schema.NullOr(PlateSolution)) })))

const isMissing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT'

async function keptSolution(path: string): Promise<PlateSolution | null | undefined> {
  const text = await readFile(statsName(path), 'utf8').catch((error: unknown) => {
    if (isMissing(error)) return undefined
    throw error
  })

  return text === undefined ? undefined : (await decodeKept(text)).solution
}

export function makeStacks({ keepDir, preview, solve, failed }: StacksOptions) {
  const kept = new Map<string, Kept>()
  const leftOut = new Map<string, number>()
  const added = new Set<string>()
  let night: string | undefined

  const countOf = (frameNight: string, sequence: string): StackCount => ({ night: frameNight, sequence, frames: kept.get(sequence)?.stack.frames ?? 0, leftOut: leftOut.get(sequence) ?? 0 })
  const leaveOut = (sequence: string) => leftOut.set(sequence, (leftOut.get(sequence) ?? 0) + 1)

  async function add(frame: StackedFrame, known: PlateSolution | null | undefined): Promise<StackCount | undefined> {
    const { sequence } = frame

    if (!stacked(sequence) || added.has(`${frame.night}/${frame.file}`)) return undefined
    if (frame.night !== night) {
      kept.clear()
      leftOut.clear()
      added.clear()
      night = frame.night
    }

    return stackFrame(frame, sequence, known).catch((error: unknown) => {
      failed(frame.file, error)
      added.add(`${frame.night}/${frame.file}`)
      leaveOut(sequence)

      return countOf(frame.night, sequence)
    })
  }

  async function stackFrame(frame: StackedFrame, sequence: string, known: PlateSolution | null | undefined): Promise<StackCount | undefined> {
    const path = join(keepDir, frame.night, frame.file)
    const fits = readFits(await readFile(path))

    if (!isLight(fits.header)) return undefined

    added.add(`${frame.night}/${frame.file}`)

    const near = pointingOf(fits.header)
    const recorded = known === undefined ? await keptSolution(path) : known
    const solution = recorded !== undefined ? recorded : near === undefined ? null : readSolution(await solve(path, near, fieldHeightDegrees(fits.header, fits.height)))
    const binned = { ...superpixels(fits, preview.bin), cell: preview.bin * 2 }

    if (solution === null) {
      leaveOut(sequence)

      return countOf(frame.night, sequence)
    }

    const entry = kept.get(sequence) ?? { stack: makeStack(solution, binned), topDown: text(fits.header, 'ROWORDER')?.toUpperCase() === 'TOP-DOWN', picture: undefined }

    if (!entry.stack.add(binned, solution)) leaveOut(sequence)

    entry.picture = undefined
    kept.set(sequence, entry)

    return countOf(frame.night, sequence)
  }

  function picture(asked: string, sequence: string): { readonly png: Buffer; readonly frames: number } | undefined {
    const entry = asked === night ? kept.get(sequence) : undefined

    if (entry === undefined || entry.stack.frames === 0) return undefined
    if (entry.picture !== undefined) return { png: entry.picture, frames: entry.stack.frames }

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

    return { png: entry.picture, frames: entry.stack.frames }
  }

  async function rebuild(tonight: string, each: (count: StackCount) => void) {
    const { frames } = await listNight(keepDir, tonight)

    for (const row of [...frames].reverse()) {
      const count = await add({ night: tonight, file: row.file, sequence: row.sequence ?? undefined }, undefined)

      if (count !== undefined) each(count)
    }
  }

  return { add, picture, rebuild }
}
