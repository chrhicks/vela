import { join } from 'node:path'
import { readFrameRecords, type FrameRecords } from './frame-records.ts'
import { joinFrames, type FrameJoin } from './join.ts'
import type { SourceProblem } from './jsonl.ts'
import { nightOf } from './night.ts'
import { readSavedImages, type SavedImages } from './saved-images.ts'
import { readTrials, type Trial, type Trials } from './trials.ts'

/** Vela's data folder (`VELA_DATA_DIR`) and the three places in it that hold frames. */
export interface FrameSourcePaths {
  readonly savedImages: string
  readonly frameRecords: string
  readonly trials: string
}

export const pathsIn = (dataDirectory: string): FrameSourcePaths => ({
  savedImages: join(dataDirectory, 'saved-images'),
  frameRecords: join(dataDirectory, 'traces/frames.jsonl'),
  trials: join(dataDirectory, 'alignment-diagnostics/trials'),
})

export interface FrameSources {
  readonly savedImages: SavedImages
  readonly frameRecords: FrameRecords
  readonly trials: Trials
  readonly join: FrameJoin
  readonly problems: readonly SourceProblem[]
}

/** Reads every frame source once. Read-only: it opens nothing for writing. */
export async function scanFrameSources(paths: FrameSourcePaths): Promise<FrameSources> {
  const [savedImages, frameRecords, trials] = await Promise.all([readSavedImages(paths.savedImages), readFrameRecords(paths.frameRecords), readTrials(paths.trials)])

  return {
    savedImages,
    frameRecords,
    trials,
    join: joinFrames(savedImages.images, frameRecords.records),
    problems: [...savedImages.problems, ...frameRecords.problems, ...trials.problems],
  }
}

export interface NightRow {
  readonly night: string
  readonly images: number
  readonly joined: number
  readonly predatesRecords: number
  readonly unexplained: number
  readonly trials: readonly Trial[]
}

/** The same sources grouped by observing night, oldest first. `utcOffsetMinutes` is the site's, supplied by the caller. */
export function nightRows(sources: FrameSources, utcOffsetMinutes: number): NightRow[] {
  const rows = new Map<string, { images: number; joined: number; predatesRecords: number; unexplained: number; trials: Trial[] }>()

  const row = (night: string) => {
    const known = rows.get(night) ?? { images: 0, joined: 0, predatesRecords: 0, unexplained: 0, trials: [] }
    rows.set(night, known)

    return known
  }

  for (const { image } of sources.join.joined) {
    const known = row(nightOf(image.capturedAt, utcOffsetMinutes))
    known.images++
    known.joined++
  }

  for (const image of sources.join.imagesWithoutRecord.predatesRecords) {
    const known = row(nightOf(image.capturedAt, utcOffsetMinutes))
    known.images++
    known.predatesRecords++
  }

  for (const image of sources.join.imagesWithoutRecord.unexplained) {
    const known = row(nightOf(image.capturedAt, utcOffsetMinutes))
    known.images++
    known.unexplained++
  }

  for (const trial of sources.trials.trials) row(nightOf(trial.createdAt, utcOffsetMinutes)).trials.push(trial)

  return [...rows].map(([night, known]) => ({ night, ...known })).toSorted((a, b) => a.night.localeCompare(b.night))
}
