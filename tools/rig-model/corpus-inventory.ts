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
  /** Picks the real frames that serve the case. A case only synthetic specimens serve has none. */
  readonly serves?: (entry: CorpusEntry) => boolean
}

const alignment = (entry: CorpusEntry) => entry.source === 'alignment-trial'

const trialFrame = (run: string, phase: 'baseline' | 'adjusting', position: number) => (entry: CorpusEntry) => entry.trial?.run === run && entry.trial.phase === phase && entry.trial.position === position

const lastOf = (run: string) => (entry: CorpusEntry) => entry.trial?.run === run && entry.trial.index === entry.trial.of - 1

const optionSensitive = (entry: CorpusEntry) => trialFrame('0ded133c', 'baseline', 2)(entry) || trialFrame('283799f5', 'baseline', 2)(entry)

/** The cases the audit's findings (`PS-001` to `PS-038`) cite with frames. `noFrame` holds the rest, each with its reason. */
export const cases: readonly Case[] = [
  { id: 'PS-001', title: 'the false solve accepted in trial eeef34da: 29 stars, scale +20%, mirrored', needs: 'pixels', serves: lastOf('eeef34da') },
  { id: 'PS-003', title: 'a wide-radius search returning a false solution on a few-star frame (real: found at 120 degrees; synthetic: 12 stars, no sky)', needs: 'pixels', serves: lastOf('eeef34da') },
  { id: 'PS-005', title: 'a poor fit reported as solved on a healthy synthetic frame', needs: 'pixels' },
  { id: 'PS-006', title: 'a refracted synthetic frame (altitude 70) fitted 0.72% off in scale', needs: 'pixels' },
  { id: 'PS-007', title: 'real frames where another option set gives a confident wrong fit', needs: 'pixels', serves: optionSensitive },
  { id: 'PS-008', title: `few-star frames: at most ${fewStars} stars`, needs: 'pixels', serves: entry => entry.stars !== null && entry.stars <= fewStars },
  { id: 'PS-009', title: 'synthetic fields scored against catalogue epochs 2000 and 2025', needs: 'pixels' },
  { id: 'PS-010', title: 'refraction: synthetic fields at altitudes 20 to 85, refracted and not', needs: 'pixels' },
  { id: 'PS-011', title: 'plate scale against altitude: the same refraction fields', needs: 'pixels' },
  { id: 'PS-012', title: 'optical distortion with the optical centre off the frame centre (synthetic)', needs: 'pixels' },
  { id: 'PS-013', title: 'a hint far off the true field (synthetic, 40 to 175 degrees)', needs: 'pixels' },
  { id: 'PS-014', title: 'the mount hint against the solved sky, on every alignment solve', needs: 'solve', serves: alignment },
  { id: 'PS-015', title: 'frame parity: the sign of the CD determinant on every alignment solve, and the FITS row-order variants (synthetic)', needs: 'solve', serves: alignment },
  { id: 'PS-023', title: 'plate scale measured by every alignment solve', needs: 'solve', serves: alignment },
  { id: 'PS-024', title: 'the field height passed as -fov, 0.5 to 2 times the truth (synthetic)', needs: 'pixels' },
  { id: 'PS-025', title: 'fields that wrap RA 360 and sit at the south pole (synthetic)', needs: 'pixels' },
  { id: 'PS-030', title: 'the real 32-star frame, where -check y moves the centre', needs: 'pixels', serves: trialFrame('0ded133c', 'baseline', 2) },
  { id: 'PS-031', title: 'which alignment frames kept their pixels: every alignment solve, kept or not', needs: 'solve', serves: alignment },
  { id: 'PS-032', title: 'scale and rotation frame to frame inside a run', needs: 'solve', serves: alignment },
  { id: 'PS-034', title: 'clean synthetic frames with known truth, including the two bad fits', needs: 'pixels' },
  { id: 'PS-035', title: 'the four retained frames of trial 24390f55', needs: 'pixels', serves: entry => entry.trial?.run === '24390f55' && entry.pixels.kind === 'file' },
  { id: 'PS-036', title: 'the default field height of 3 degrees against 2.25 true (synthetic)', needs: 'pixels' },
  { id: 'PS-038', title: 'bad fits that a tighter -t or -z 1 fixes: clean, refracted and dim synthetic frames, and the real option-sensitive frames', needs: 'pixels', serves: optionSensitive },
]

/** Audit cases with no frame to keep. */
export const noFrame = {
  'PS-002': 'a fake ASTAP output, not a frame; step 6 tests it on the verdict',
  'PS-004': 'ASTAP records no quality measure; the corpus measures stars itself',
  'PS-016': 'rotation maths on generated WCS objects',
  'PS-017': 'shutter timing, unmeasured',
  'PS-018': 'a timestamp source no frame used',
  'PS-019': 'coordinate chain only',
  'PS-020': 'coordinate chain only',
  'PS-021': 'a test gap; this corpus is the known-answer input for it',
  'PS-022': 'binary and catalogue provenance',
  'PS-026': 'a fake executable',
  'PS-027': 'a fake executable',
  'PS-028': 'a duplicate solver boundary',
  'PS-029': 'a binning path the rig does not use',
  'PS-033': 'a specimen the audit never made',
  'PS-037': 'resource use',
} satisfies Record<string, string>

interface Specimen {
  readonly id: string
  /** The kept FITS, in `<out>/synthetic/`. */
  readonly file: string | null
  readonly cases: readonly string[]
  readonly note: string
}

/** The frames the audit made for itself. Each is a specimen set; the audit kept only the dim one. */
export const specimens: readonly Specimen[] = [
  { id: 'PS-003-12-star-no-sky', file: null, cases: ['PS-003'], note: 'Twelve random stars with no sky behind them, solved at radius 180 with scale 1.7717 (-8.2%) and a mirrored matrix (trial 10 of 40).' },
  { id: 'PS-005-clean-bad-fit', file: null, cases: ['PS-005', 'PS-034', 'PS-038'], note: 'Two of about 84 clean Gaia star fields of about 1000 stars: corners off by up to 1.6 arcsec, scale off by 112 ppm. A tighter -t or -z 1 fixes them.' },
  { id: 'PS-006-refracted-alt70', file: null, cases: ['PS-006', 'PS-038'], note: 'The n60 field at altitude 70 degrees with refraction applied, 1445 stars. ASTAP gave scale 1.91676 against 1.93061 true.' },
  { id: 'PS-008-n85-16-stars', file: null, cases: ['PS-008'], note: 'The n85 field cut to 16 stars: centre 10.34 arcsec off, a corner 43.66 arcsec off, scale off by 1634 ppm, 28 of 28 quads matching.' },
  { id: 'PS-008-dim-s30-14-stars', file: 'dim-s30-14-stars.fits', cases: ['PS-008', 'PS-038'], note: 'The s30 field dimmed to 14 stars: 60 of 60 quads matching, centre 9.41 arcsec off, corners 38 to 71 arcsec off, scale off by 686 ppm.' },
  { id: 'PS-009-epoch-fields', file: null, cases: ['PS-009'], note: 'The eq and n60 fields scored against positions at epochs 2000 and 2025.' },
  { id: 'PS-010-refraction-fields', file: null, cases: ['PS-010', 'PS-011'], note: 'The eq and n60 fields at altitudes 20 to 85 degrees with and without refraction, 36 batch cases.' },
  { id: 'PS-012-distortion-fields', file: null, cases: ['PS-012'], note: 'Radial distortion of 0.2% to 2% with the distortion centre 400 px right and 250 px up from the frame centre.' },
  { id: 'PS-013-far-hint-field', file: null, cases: ['PS-013', 'PS-024', 'PS-036'], note: 'A real-scale field solved with hints 40 to 175 degrees off and field heights 0.5 to 2 times the truth.' },
  { id: 'PS-015-fits-variants', file: null, cases: ['PS-015'], note: 'One field written with ROWORDER top-down, bottom-up and absent, with Bayer pattern right, wrong and absent, as 16-bit and 32-bit.' },
  { id: 'PS-025-wrap-and-pole-fields', file: null, cases: ['PS-025', 'PS-034'], note: 'Fields across RA 0/360 and at declination -88, rggb and mono, both parities.' },
]

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
  /** Where the audit's kept synthetic frames live. */
  readonly synthetic: string
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

  const fromAudit = specimens.map((specimen): CorpusEntry => {
    const path = specimen.file === null ? undefined : join(facts.synthetic, specimen.file)
    const sha256 = path === undefined ? undefined : digests.get(path)

    return {
      id: `audit:${specimen.id}`,
      source: 'audit-synthetic',
      night: null,
      capturedAt: null,
      trial: null,
      pixels: path !== undefined && sha256 !== undefined ? { kind: 'file', path, sha256 } : { kind: 'missing', reason: 'synthetic-not-kept' },
      recorded: null,
      solve: (sha256 !== undefined && solves.get(sha256)) || null,
      stars: null,
      cases: specimen.cases,
      note: specimen.note,
    }
  })

  return [...fromTrials, ...fromImages, ...fromAudit].map(entry => ({ ...entry, cases: [...new Set([...entry.cases, ...cases.flatMap(item => (item.serves?.(entry) ? [item.id] : []))])].toSorted() }))
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
  /** Tagged entries that lack what the case needs. */
  readonly lacking: number
  readonly status: 'found' | 'partial' | 'missing'
}

export function caseResults(entries: readonly CorpusEntry[]): CaseResult[] {
  return cases.map(item => {
    const tagged = entries.filter(entry => entry.cases.includes(item.id))
    const proven = tagged.filter(entry => (item.needs === 'pixels' ? entry.pixels.kind === 'file' : measuredOf(entry) !== undefined)).length

    return {
      id: item.id,
      title: item.title,
      entries: tagged.length,
      withPixels: tagged.filter(entry => entry.pixels.kind === 'file').length,
      lacking: tagged.length - proven,
      status: proven === 0 ? 'missing' : proven === tagged.length ? 'found' : 'partial',
    }
  })
}
