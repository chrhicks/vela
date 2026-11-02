import { join } from 'node:path'
import type { SolveBody } from '@vela/rig-events'
import { nightOf, type SavedImage, type Trial } from '@vela/rig-frames'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A solve fact without the image id: the corpus names a frame by its entry id, never by an id a solver was handed. */
export type Solve = DistributiveOmit<SolveBody, 'imageId'>

export type Pixels =
  | { readonly kind: 'file'; readonly path: string; readonly sha256: string }
  | { readonly kind: 'missing'; readonly reason: 'not-kept' | 'changed-since-journal' | 'synthetic-not-kept' }

export interface Recorded {
  readonly wcs: Extract<SolveBody, { readonly status: 'solved' }>['wcs']
  readonly hint: { readonly raDegrees: number; readonly decDegrees: number }
}

export interface CorpusEntry {
  readonly id: string
  readonly source: 'alignment-trial' | 'saved-image' | 'audit-synthetic'
  readonly night: string | null
  readonly capturedAt: string | null
  readonly trial: { readonly run: string; readonly phase: 'baseline' | 'adjusting'; readonly position: number; readonly index: number; readonly of: number } | null
  readonly pixels: Pixels
  /** The solve Vela got and journalled at the time. Only alignment trials have one. */
  readonly recorded: Recorded | null
  /** The solve of the real ASTAP binary on the pixels, read from the solve cache. */
  readonly solve: Solve | null
  /** Stars ASTAP found (its `-log` count). Only measured for alignment frames that kept their pixels. */
  readonly stars: number | null
  readonly cases: readonly string[]
  readonly note: string | null
}

/** The audit's range for a few-star frame: 10 to 210 stars. */
export const fewStars = 210

interface Case {
  readonly id: string
  readonly title: string
  /** What proves the case is in the corpus: the pixels of a tagged frame, or a solve of one (for questions about scale and parity). */
  readonly needs: 'pixels' | 'solve'
  readonly serves: (entry: CorpusEntry) => boolean
}

const alignment = (entry: CorpusEntry) => entry.source === 'alignment-trial'

const trialFrame = (run: string, phase: 'baseline' | 'adjusting', position: number) => (entry: CorpusEntry) => entry.trial?.run === run && entry.trial.phase === phase && entry.trial.position === position

const lastOf = (run: string) => (entry: CorpusEntry) => entry.trial?.run === run && entry.trial.index === entry.trial.of - 1

/** The cases the audit (`scope-plate-solving.md`'s findings) cites with frames. Cases about code, timing or the coordinate chain have no frame to keep. */
export const cases: readonly Case[] = [
  { id: 'PS-001', title: 'the false solve accepted in trial eeef34da: 29 stars, scale +20%, mirrored', needs: 'pixels', serves: lastOf('eeef34da') },
  { id: 'PS-003', title: 'a wide-radius search (found at 120 degrees) returning a false solution on a few-star frame', needs: 'pixels', serves: lastOf('eeef34da') },
  { id: 'PS-005', title: 'a poor fit reported as solved on a healthy synthetic frame', needs: 'pixels', serves: entry => entry.id === 'audit:PS-005' },
  { id: 'PS-006', title: 'a refracted synthetic frame (altitude 70) fitted 0.72% off in scale', needs: 'pixels', serves: entry => entry.id === 'audit:PS-006' },
  { id: 'PS-007', title: 'real frames where another option set gives a confident wrong fit', needs: 'pixels', serves: entry => trialFrame('0ded133c', 'baseline', 2)(entry) || trialFrame('283799f5', 'baseline', 2)(entry) },
  { id: 'PS-008', title: `few-star frames: at most ${fewStars} stars`, needs: 'pixels', serves: entry => entry.stars !== null && entry.stars <= fewStars },
  { id: 'PS-014', title: 'the mount hint against the solved sky, on every alignment solve', needs: 'solve', serves: alignment },
  { id: 'PS-015', title: 'frame parity: the sign of the CD determinant, on every alignment solve', needs: 'solve', serves: alignment },
  { id: 'PS-023', title: 'plate scale measured by every alignment solve', needs: 'solve', serves: alignment },
  { id: 'PS-032', title: 'scale and rotation frame to frame inside a run', needs: 'solve', serves: alignment },
]

const synthetic = (id: string, note: string): CorpusEntry => ({
  id: `audit:${id}`,
  source: 'audit-synthetic',
  night: null,
  capturedAt: null,
  trial: null,
  pixels: { kind: 'missing', reason: 'synthetic-not-kept' },
  recorded: null,
  solve: null,
  stars: null,
  cases: [],
  note,
})

export interface Facts {
  readonly trials: readonly Trial[]
  readonly images: readonly SavedImage[]
  /** sha256 of each file that was read, by path. */
  readonly digests: ReadonlyMap<string, string>
  /** The real ASTAP's solve, by pixel digest. */
  readonly solves: ReadonlyMap<string, Solve>
  /** The stars ASTAP found, by pixel digest. */
  readonly stars: ReadonlyMap<string, number>
  readonly utcOffsetMinutes: number
}

export function inventoryOf(facts: Facts): CorpusEntry[] {
  const { digests, solves, stars } = facts

  const fromTrials = facts.trials.flatMap(trial =>
    trial.frames.map((frame, index): CorpusEntry => {
      const path = join(trial.directory, frame.filename)
      const kept = frame.onDisk && digests.get(path) === frame.sha256

      return {
        id: `trial:${trial.runId.slice(0, 8)}:${index}`,
        source: 'alignment-trial',
        night: nightOf(frame.capturedAt, facts.utcOffsetMinutes),
        capturedAt: new Date(frame.capturedAt).toISOString(),
        trial: { run: trial.runId.slice(0, 8), phase: frame.phase, position: frame.position, index, of: trial.frames.length },
        pixels: kept ? { kind: 'file', path, sha256: frame.sha256 } : { kind: 'missing', reason: frame.onDisk ? 'changed-since-journal' : 'not-kept' },
        recorded: { wcs: frame.solved.wcs, hint: { raDegrees: frame.hint.raDegrees, decDegrees: frame.hint.decDegrees } },
        solve: (kept && solves.get(frame.sha256)) || null,
        stars: (kept && stars.get(frame.sha256)) || null,
        cases: [],
        note: null,
      }
    }),
  )

  const fromImages = facts.images.map((image): CorpusEntry => {
    const sha256 = digests.get(image.fitsPath)

    return {
      id: `image:${image.id}`,
      source: 'saved-image',
      night: nightOf(image.capturedAt, facts.utcOffsetMinutes),
      capturedAt: new Date(image.capturedAt).toISOString(),
      trial: null,
      pixels: sha256 === undefined ? { kind: 'missing', reason: 'not-kept' } : { kind: 'file', path: image.fitsPath, sha256 },
      recorded: null,
      solve: (sha256 !== undefined && solves.get(sha256)) || null,
      stars: null,
      cases: [],
      note: null,
    }
  })

  const fromAudit = [
    synthetic('PS-005', 'Made by the audit from a Gaia star field with a known WCS: corner error 1.4 to 1.6 arcsec, scale off by 112 ppm. The frame was not kept.'),
    synthetic('PS-006', 'Made by the audit: the n60 field at altitude 70 degrees with refraction applied, 1445 stars. ASTAP gave scale 1.91676 against 1.93061 true. The frame was not kept.'),
  ]

  return [...fromTrials, ...fromImages, ...fromAudit].map(entry => ({ ...entry, cases: cases.flatMap(item => (item.serves(entry) ? [item.id] : [])) }))
}

export interface Handed {
  readonly scale: number
  readonly parity: 1 | -1
}

/** The scale of a CD matrix in arcseconds per pixel, and which way it is handed (-1 is mirrored). */
export function scaleAndParity(cd: readonly number[]): Handed {
  const determinant = cd[0]! * cd[3]! - cd[1]! * cd[2]!

  return { scale: Math.sqrt(Math.abs(determinant)) * 3600, parity: determinant < 0 ? -1 : 1 }
}

export const measuredOf = (entry: CorpusEntry) => {
  const wcs = entry.recorded?.wcs ?? (entry.solve?.status === 'solved' ? entry.solve.wcs : undefined)

  return wcs === undefined ? undefined : scaleAndParity(wcs.cd)
}

export function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b)

  return sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]! : ((sorted[sorted.length / 2 - 1] ?? Number.NaN) + (sorted[sorted.length / 2] ?? Number.NaN)) / 2
}

export interface CaseResult {
  readonly id: string
  readonly title: string
  readonly entries: number
  readonly withPixels: number
  readonly status: 'found' | 'missing'
}

export function caseResults(entries: readonly CorpusEntry[]): CaseResult[] {
  return cases.map(item => {
    const tagged = entries.filter(entry => entry.cases.includes(item.id))
    const withPixels = tagged.filter(entry => entry.pixels.kind === 'file').length
    const proven = item.needs === 'pixels' ? withPixels : tagged.filter(entry => measuredOf(entry) !== undefined).length

    return { id: item.id, title: item.title, entries: tagged.length, withPixels, status: proven > 0 ? 'found' : 'missing' }
  })
}
