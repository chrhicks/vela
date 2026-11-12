import { numberOf, recordOf, textOf, type Entry } from './entry.ts'

export interface Measurements {
  readonly stars: number | null
  readonly hfdPixels: number | null
  readonly elongation: number | null
  readonly sky: number
  readonly noise: number
}

export interface Frame {
  readonly night: string
  readonly file: string
  readonly keptAt: number
  readonly measurements: Measurements | undefined
}

function nullableNumber(body: Readonly<Record<string, unknown>>, name: string): number | null | undefined {
  return body[name] === null ? null : numberOf(body, name)
}

function measurementsOf(body: Readonly<Record<string, unknown>>): Measurements | undefined {
  const stars = nullableNumber(body, 'stars')
  const hfdPixels = nullableNumber(body, 'hfdPixels')
  const elongation = nullableNumber(body, 'elongation')
  const sky = numberOf(body, 'sky')
  const noise = numberOf(body, 'noise')

  if (stars === undefined || hfdPixels === undefined || elongation === undefined || sky === undefined || noise === undefined) return undefined

  return { stars, hfdPixels, elongation, sky, noise }
}

function kept(state: ReadonlyArray<Frame>, entry: Entry): ReadonlyArray<Frame> {
  const body = recordOf(entry.body)
  const night = body === undefined ? undefined : textOf(body, 'night')
  const file = body === undefined ? undefined : textOf(body, 'file')

  if (night === undefined || file === undefined) return state
  if (state.some(frame => frame.night === night && frame.file === file)) return state

  return [...state, { night, file, keptAt: entry.at, measurements: undefined }]
}

function measured(state: ReadonlyArray<Frame>, entry: Entry): ReadonlyArray<Frame> {
  const body = recordOf(entry.body)
  const night = body === undefined ? undefined : textOf(body, 'night')
  const file = body === undefined ? undefined : textOf(body, 'file')
  const measurements = body === undefined ? undefined : measurementsOf(body)
  const isMeasured = (frame: Frame) => frame.night === night && frame.file === file

  if (measurements === undefined || !state.some(isMeasured)) return state

  return state.map(frame => (isMeasured(frame) ? { ...frame, measurements } : frame))
}

export function frames(state: ReadonlyArray<Frame>, entry: Entry): ReadonlyArray<Frame> {
  switch (entry.kind) {
    case 'vela.frame':
      return kept(state, entry)
    case 'vela.frame.stats':
      return measured(state, entry)
    default:
      return state
  }
}
