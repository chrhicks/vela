import { recordOf, type Entry } from '../../state/entry.ts'

export const measureSubject = 'rig-dev.command.measure'

export type Measurement = 'solve' | 'stars'

export type HeaderValue = string | number | boolean

export type RigSolve = { readonly solved: true; readonly raDegrees: number; readonly decDegrees: number } | { readonly solved: false; readonly reason: string }

export type RigStars = { readonly measured: true; readonly hfd: number; readonly count: number } | { readonly measured: false; readonly reason: string }

export type Measured =
  | { readonly file: string; readonly result: 'measured'; readonly solve: RigSolve | undefined; readonly stars: RigStars | undefined; readonly header: Readonly<Record<string, HeaderValue>> }
  | { readonly file: string; readonly result: 'refused'; readonly reason: string }

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

function solveOf(value: unknown): RigSolve | undefined {
  const solve = recordOf(value)

  if (solve === undefined) return undefined
  if (solve['solved'] === true && typeof solve['raDegrees'] === 'number' && typeof solve['decDegrees'] === 'number') return { solved: true, raDegrees: solve['raDegrees'], decDegrees: solve['decDegrees'] }

  return { solved: false, reason: text(solve['reason']) ?? 'no solution' }
}

function starsOf(value: unknown): RigStars | undefined {
  const stars = recordOf(value)

  if (stars === undefined) return undefined
  if (stars['measured'] === true && typeof stars['hfd'] === 'number' && typeof stars['count'] === 'number') return { measured: true, hfd: stars['hfd'], count: stars['count'] }

  return { measured: false, reason: text(stars['reason']) ?? 'no star size' }
}

export function measuredOf(entry: Entry, by: string): Measured | undefined {
  const body = recordOf(entry.body)
  const file = text(body?.['file'])

  if (entry.kind !== 'client.measure' || body === undefined || body['by'] !== by || file === undefined) return undefined
  if (body['result'] === 'refused') return { file, result: 'refused', reason: text(body['reason']) ?? 'no reason given' }
  if (body['result'] !== 'measured') return undefined

  const header = recordOf(body['header']) ?? {}

  return {
    file,
    result: 'measured',
    solve: solveOf(body['solve']),
    stars: starsOf(body['stars']),
    header: Object.fromEntries(Object.entries(header).filter((pair): pair is [string, HeaderValue] => ['string', 'number', 'boolean'].includes(typeof pair[1]))),
  }
}

export interface MeasureRequests {
  readonly publish: (subject: string, payload: string) => void
  readonly newId: () => string
  readonly by: string
}

export function makeMeasureRequests({ publish, newId, by }: MeasureRequests) {
  return (file: string, measure: ReadonlyArray<Measurement>) => publish(measureSubject, JSON.stringify({ id: newId(), by, file, measure, remove: true }))
}
