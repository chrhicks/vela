import type { Point } from '../components/Chart.tsx'

function seeded(seed: number): () => number {
  let state = seed

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296

    return state / 4294967296
  }
}

interface Drift {
  readonly seed: number
  readonly count: number
  readonly from: number
  readonly to: number
  readonly noise: number
}

export function drift({ seed, count, from, to, noise }: Drift): ReadonlyArray<Point> {
  const next = seeded(seed)

  return Array.from({ length: count }, (_, index) => ({
    x: index,
    y: from + ((to - from) * index) / (count - 1) + (next() - 0.5) * 2 * noise,
  }))
}

export interface Star {
  readonly x: number
  readonly y: number
  readonly size: number
}

export function starfield(seed: number, count: number): ReadonlyArray<Star> {
  const next = seeded(seed)

  return Array.from({ length: count }, () => ({ x: next() * 300, y: next() * 200, size: 0.3 + next() * 0.7 }))
}
