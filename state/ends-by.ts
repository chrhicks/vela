import type { Placement } from './targets.ts'

export interface Plan {
  readonly now: number
  readonly exposureSeconds: number
  readonly frames: number | undefined
  readonly line: Placement['line'] | undefined
  readonly darkUntil: number | undefined
}

export type Limit = { readonly by: 'target-low' | 'dark'; readonly at: number }

export type EndsBy =
  | { readonly ends: 'at-count'; readonly at: number; readonly passes: Limit | undefined }
  | { readonly ends: 'at-limit'; readonly limit: Limit }
  | { readonly ends: 'unknown' }

function limitsOf({ now, line, darkUntil }: Plan): ReadonlyArray<Limit> {
  const targetLow: ReadonlyArray<Limit> = line === undefined || line.above === 'always' ? [] : [{ by: 'target-low', at: line.above === 'until' ? line.until : now }]
  const dark: ReadonlyArray<Limit> = darkUntil === undefined ? [] : [{ by: 'dark', at: darkUntil }]

  return [...targetLow, ...dark].sort((a, b) => a.at - b.at)
}

export function endsBy(plan: Plan): EndsBy {
  const [first] = limitsOf(plan)

  if (plan.frames === undefined) return first === undefined ? { ends: 'unknown' } : { ends: 'at-limit', limit: first }

  const at = plan.now + plan.frames * plan.exposureSeconds * 1000

  return { ends: 'at-count', at, passes: first !== undefined && first.at < at ? first : undefined }
}
