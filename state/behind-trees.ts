import type { Placement } from './targets.ts'

export interface Hiding {
  readonly placement: Placement | null
  readonly darkUntil: number | undefined
}

export type Cause = 'trees' | 'up-line' | 'below-horizon'

export type Behind =
  | { readonly when: 'from'; readonly at: number; readonly cause: Cause; readonly lineDegrees: number }
  | { readonly when: 'now'; readonly clearsAt: number; readonly cause: Cause; readonly lineDegrees: number }

const causeOf = (...sources: ReadonlyArray<Placement['lineSource']>): Cause => (sources.every(source => source === 'horizon') ? 'trees' : 'up-line')

export function behindTrees({ placement, darkUntil }: Hiding): Behind | undefined {
  if (placement === null) return undefined

  const { line } = placement
  const beforeDawn = (at: number) => darkUntil === undefined || at <= darkUntil

  if (line.above === 'until') return beforeDawn(line.until) ? { when: 'from', at: line.until, cause: causeOf(line.lineSource), lineDegrees: line.lineDegrees } : undefined

  if (line.above === 'rises')
    return beforeDawn(line.at)
      ? { when: 'now', clearsAt: line.at, cause: placement.altitudeDegrees < 0 ? 'below-horizon' : causeOf(placement.lineSource, line.lineSource), lineDegrees: line.lineDegrees }
      : undefined

  return undefined
}

const hiddenBy = (cause: Cause, lineDegrees: number) =>
  cause === 'trees' ? 'behind the trees' : cause === 'up-line' ? `below ${Math.round(lineDegrees)}°` : 'below the horizon'

export function behindTreesWords(behind: Behind, time: (at: number) => string) {
  const by = hiddenBy(behind.cause, behind.lineDegrees)

  return behind.when === 'from' ? `${by} from ${time(behind.at)}` : `${by} now, clears at ${time(behind.clearsAt)}`
}
