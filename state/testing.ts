import type { Entry } from './entry.ts'

let seq = 0

export function entry(kind: string, at: number, body: unknown): Entry {
  seq += 1

  return { seq, kind, at, body }
}

export function wire(device: string, property: string | undefined, elements: Readonly<Record<string, number | boolean | string>> = {}): Entry {
  return entry('wire', 0, { dir: 'in', device, type: 'set', ...(property === undefined ? {} : { property }), state: 'Ok', elements })
}

export function runStarted(run: string, at: number, object = 'M 31'): Entry {
  return entry('vela.run.started', at, { run, object, frameType: 'light', exposureSeconds: 120, count: 30, gain: 100, offset: 50, sequence: 1 })
}

export function frameKept(file: string, at: number, night = '2026-11-08'): Entry {
  return entry('vela.frame', at, { night, file, bytes: 49_000_000, sha256: 'ab' })
}

export function frameMeasured(file: string, at: number, measurements: Readonly<Record<string, number | null>>, night = '2026-11-08'): Entry {
  return entry('vela.frame.stats', at, { night, file, stars: 846, hfdPixels: 2.9, arcsecPerPixel: 1.45, elongation: 1.06, shapedStars: 40, sky: 1200, noise: 30, ...measurements })
}
