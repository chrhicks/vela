import { Option, Result } from 'effect'
import { readRigEntry, type RigEntry } from './entries.ts'
import { StreamPosition, type Entry } from './entry.ts'
import { advance, emptyRig, type RigState } from './rig.ts'

let seq = 0

export function entry(kind: string, at: number, body: unknown): Entry {
  seq += 1

  return { seq: StreamPosition.make(seq), kind, at, body }
}

export function wire(device: string, property: string | undefined, elements: Readonly<Record<string, number | boolean | string>> = {}): Entry {
  return entry('wire', 0, { dir: 'in', device, type: 'set', ...(property === undefined ? {} : { property }), state: 'Ok', elements })
}

export function runStarted(run: string, at: number, object = 'M 31'): Entry {
  return entry('vela.run.started', at, { run, object, frameType: 'light', exposureSeconds: 120, count: 30, gain: 100, offset: 50, sequence: `${object.replace(/[^A-Za-z0-9]+/g, '-')}_light` })
}

export function velaStarted(at: number, token = '1794500000000'): Entry {
  return entry('vela.started', at, { token })
}

export function frameKept(file: string, at: number, night = '2026-11-08'): Entry {
  return entry('vela.frame', at, { night, file, bytes: 49_000_000, sha256: 'ab' })
}

export function frameMeasured(file: string, at: number, measurements: Readonly<Record<string, number | null>>, night = '2026-11-08', sequence = 'M-31_light'): Entry {
  return entry('vela.frame.stats', at, { night, file, sequence, stars: 846, hfdPixels: 2.9, arcsecPerPixel: 1.45, elongation: 1.06, shapedStars: 40, sky: 1200, noise: 30, ...measurements })
}

export function read(source: Entry): Option.Option<RigEntry> {
  return Result.getOrThrow(readRigEntry(source))
}

export function fold<S>(reduce: (state: S, entry: RigEntry) => S, initial: S, entries: ReadonlyArray<Entry>): S {
  return entries.reduce((state, source) => Option.match(read(source), { onNone: () => state, onSome: rigEntry => reduce(state, rigEntry) }), initial)
}

export function foldRig(entries: ReadonlyArray<Entry>, initial: RigState = emptyRig): RigState {
  return entries.reduce((state, source) => Result.getOrThrow(advance(state, source)), initial)
}

export function reviewAsked(review: string, at: number, file: string, overrides: Readonly<Record<string, unknown>> = {}, night = '2026-11-08'): Entry {
  return entry('vela.review.asked', at, { review, run: 'r1', night, file, models: ['claude-opus-5-5', 'claude-haiku-5-5'], ...overrides })
}

export function reviewAnswered(review: string, at: number, file: string, model: string, outcome: unknown, night = '2026-11-08'): Entry {
  return entry('vela.review.answer', at, { review, night, file, model, seconds: 12.5, outcome, usage: { inputTokens: 1800, outputTokens: 90 } })
}

export const obstructed = { _tag: 'Answered', answer: { obstructed: true, confidence: 0.8, hazard: 'high-tension power poles/lines', what: 'Two soft bright bands cross the frame, like lit power lines.' } }

export const clear = { _tag: 'Answered', answer: { obstructed: false, confidence: 0.93, hazard: 'none', what: 'A clear star field.' } }

export const failed = { _tag: 'Failed', failure: { kind: 'no-credential', message: 'Could not resolve authentication method' } }
