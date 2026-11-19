import { Result, Schema } from 'effect'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CropOutside, isInside, type CropBox } from '../frames/crop.ts'
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

interface Developed {
  readonly planes: ReadonlyArray<Uint16Array>
  readonly tables: ReadonlyArray<Uint8Array>
}

interface Kept {
  readonly stack: Stack
  readonly topDown: boolean
  developed: Developed | undefined
  picture: Buffer | undefined
}

export interface StackPicture {
  readonly png: Buffer
  readonly frames: number
}

export interface StackShape {
  readonly width: number
  readonly height: number
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

    const entry = kept.get(sequence) ?? { stack: makeStack(solution, binned), topDown: text(fits.header, 'ROWORDER')?.toUpperCase() === 'TOP-DOWN', developed: undefined, picture: undefined }

    if (!entry.stack.add(binned, solution)) leaveOut(sequence)

    entry.developed = undefined
    entry.picture = undefined
    kept.set(sequence, entry)

    return countOf(frame.night, sequence)
  }

  const keptFor = (asked: string, sequence: string) => {
    const entry = asked === night ? kept.get(sequence) : undefined

    return entry === undefined || entry.stack.frames === 0 ? undefined : entry
  }

  function developedOf(entry: Kept): Developed {
    if (entry.developed !== undefined) return entry.developed

    const planes = entry.stack.mean()

    entry.developed = { planes, tables: planes.map(plane => stretch(plane, preview)) }

    return entry.developed
  }

  function render(entry: Kept, box: CropBox): Buffer {
    const { width, height } = entry.stack
    const { planes, tables } = developedOf(entry)
    const rgb = new Uint8Array(box.width * box.height * 3)

    for (let row = 0; row < box.height; row += 1) {
      const shownRow = box.y + row
      const source = entry.topDown ? shownRow : height - 1 - shownRow

      for (let column = 0; column < box.width; column += 1) {
        for (let channel = 0; channel < 3; channel += 1) rgb[(row * box.width + column) * 3 + channel] = tables[channel]?.[planes[channel]?.[source * width + box.x + column] ?? 0] ?? 0
      }
    }

    return encodePng(box.width, box.height, rgb)
  }

  function picture(asked: string, sequence: string): StackPicture | undefined {
    const entry = keptFor(asked, sequence)

    if (entry === undefined) return undefined

    entry.picture ??= render(entry, { x: 0, y: 0, width: entry.stack.width, height: entry.stack.height })

    return { png: entry.picture, frames: entry.stack.frames }
  }

  function shape(asked: string, sequence: string): StackShape | undefined {
    const entry = keptFor(asked, sequence)

    return entry === undefined ? undefined : { width: entry.stack.width, height: entry.stack.height }
  }

  function crop(asked: string, sequence: string, box: CropBox): Result.Result<StackPicture, CropOutside> | undefined {
    const entry = keptFor(asked, sequence)

    if (entry === undefined) return undefined

    const { width, height } = entry.stack

    return isInside(box, entry.stack) ? Result.succeed({ png: render(entry, box), frames: entry.stack.frames }) : Result.fail(new CropOutside({ box, width, height }))
  }

  async function rebuild(tonight: string, each: (count: StackCount) => void) {
    const { frames } = await listNight(keepDir, tonight)

    for (const row of [...frames].reverse()) {
      const count = await add({ night: tonight, file: row.file, sequence: row.sequence ?? undefined }, undefined)

      if (count !== undefined) each(count)
    }
  }

  return { add, picture, shape, crop, rebuild }
}
