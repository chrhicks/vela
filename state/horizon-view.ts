import type { HorizonNight, SpellEdge, TargetPath } from './horizon-night.ts'

export interface SkyPoint {
  readonly azimuthDegrees: number
  readonly altitudeDegrees: number
}

export interface PathPiece {
  readonly clear: boolean
  readonly points: ReadonlyArray<SkyPoint>
}

export interface LineRun {
  readonly known: boolean
  readonly points: ReadonlyArray<SkyPoint>
}

export interface HourTick {
  readonly at: number
  readonly label: string
  readonly point: SkyPoint
}

export interface FactCell {
  readonly label: string
  readonly value: string
  readonly note: string | null
}

interface Sample extends SkyPoint {
  readonly at: number
}

const secondMs = 1000
const hourSeconds = 3600
const minuteSeconds = 60
const halfTurn = 180
const fullTurn = 360
const quarterTurn = 90

const samplesOf = (path: TargetPath): ReadonlyArray<Sample> =>
  path.altitudes.flatMap((altitudeDegrees, index) => {
    const azimuthDegrees = path.azimuths[index]

    return azimuthDegrees === undefined ? [] : [{ at: path.startAt + index * path.stepSeconds * secondMs, azimuthDegrees, altitudeDegrees }]
  })

export const nightEnd = (path: TargetPath): number => path.startAt + Math.max(path.altitudes.length - 1, 0) * path.stepSeconds * secondMs

export function skyPointAt(path: TargetPath, at: number): SkyPoint | undefined {
  if (at < path.startAt || at > nightEnd(path)) return undefined

  const samples = samplesOf(path)
  const position = (at - path.startAt) / (path.stepSeconds * secondMs)
  const before = samples[Math.floor(position)]
  const after = samples[Math.ceil(position)]

  if (before === undefined || after === undefined) return undefined

  const fraction = position - Math.floor(position)
  const wraps = Math.abs(after.azimuthDegrees - before.azimuthDegrees) > halfTurn

  if (wraps) {
    const nearer = fraction < 0.5 ? before : after

    return { azimuthDegrees: nearer.azimuthDegrees, altitudeDegrees: nearer.altitudeDegrees }
  }

  return {
    azimuthDegrees: before.azimuthDegrees + (after.azimuthDegrees - before.azimuthDegrees) * fraction,
    altitudeDegrees: before.altitudeDegrees + (after.altitudeDegrees - before.altitudeDegrees) * fraction,
  }
}

export function pathPieces(path: TargetPath, clear: HorizonNight['clear']): ReadonlyArray<PathPiece> {
  const isClear = (at: number) => clear.some(spell => at >= spell.from && at <= spell.until)
  const pieces: Array<{ clear: boolean; points: Array<SkyPoint> }> = []
  let previous: Sample | undefined

  for (const sample of samplesOf(path)) {
    const before = previous

    if (sample.altitudeDegrees < 0) {
      previous = undefined
      continue
    }

    previous = sample

    const clearHere = isClear(sample.at)
    const open = pieces.at(-1)
    const wrapped = before !== undefined && Math.abs(sample.azimuthDegrees - before.azimuthDegrees) > halfTurn

    if (before === undefined || wrapped || open === undefined) {
      pieces.push({ clear: clearHere, points: [sample] })
    } else if (open.clear === clearHere) {
      open.points.push(sample)
    } else {
      pieces.push({ clear: clearHere, points: [before, sample] })
    }
  }

  return pieces
}

const zonedParts = (zone: string, at: number) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  const part = (type: string) => Number(parts.find(found => found.type === type)?.value ?? 0)

  return { hour: part('hour'), minute: part('minute'), second: part('second') }
}

export const clockIn = (zone: string) => {
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })

  return (at: number) => format.format(at)
}

export function hourTicks(path: TargetPath, zone: string): ReadonlyArray<HourTick> {
  const { minute, second } = zonedParts(zone, path.startAt)
  const wait = (hourSeconds - ((minute * minuteSeconds + second) % hourSeconds)) % hourSeconds
  const end = nightEnd(path)
  const label = (at: number) => String(zonedParts(zone, at).hour).padStart(2, '0')
  const ticks: Array<HourTick> = []

  for (let at = path.startAt + wait * secondMs; at <= end; at += hourSeconds * secondMs) {
    const point = skyPointAt(path, at)

    if (point !== undefined && point.altitudeDegrees >= 0) ticks.push({ at, label: label(at), point })
  }

  return ticks
}

export function nowPoint(path: TargetPath, now: number | undefined): SkyPoint | undefined {
  if (now === undefined) return undefined

  const point = skyPointAt(path, now)

  return point !== undefined && point.altitudeDegrees >= 0 ? point : undefined
}

export function meridianAzimuths(night: HorizonNight): ReadonlyArray<number> {
  const transit = night.facts.transitAt === null ? undefined : skyPointAt(night.path, night.facts.transitAt)

  if (transit === undefined) return []

  return Math.abs(transit.azimuthDegrees - halfTurn) <= quarterTurn ? [halfTurn] : [0, fullTurn]
}

export function lineRuns(horizon: HorizonNight['horizon']): ReadonlyArray<LineRun> {
  const runs: Array<{ known: boolean; points: Array<SkyPoint> }> = []
  const altitudeOf = (bin: number) => horizon.altitudesDegrees[bin % fullTurn] ?? null

  for (let bin = 0; bin < fullTurn; bin += 1) {
    const here = altitudeOf(bin)
    const next = altitudeOf(bin + 1)
    const known = here !== null && next !== null
    const pointAt = (azimuthDegrees: number, altitude: number | null): SkyPoint => ({ azimuthDegrees, altitudeDegrees: known ? (altitude ?? horizon.upLineDegrees) : horizon.upLineDegrees })
    const open = runs.at(-1)

    if (open === undefined || open.known !== known) runs.push({ known, points: [pointAt(bin, here)] })

    runs.at(-1)?.points.push(pointAt(bin + 1, next))
  }

  return runs
}

export function lineNote(horizon: HorizonNight['horizon']): string | undefined {
  const known = horizon.altitudesDegrees.filter(altitude => altitude !== null).length

  if (!horizon.fileLoaded || known === 0) return `No horizon file, flat ${horizon.upLineDegrees}° assumed`

  return known < horizon.altitudesDegrees.length ? `Flat ${horizon.upLineDegrees}° assumed where the horizon file has no edge` : undefined
}

export const lastNightsWords = (nights: ReadonlyArray<string>): string | undefined => {
  if (nights.length === 0) return undefined

  const days = nights.map(night => night.slice('0000-'.length))

  return `Trees from the ${days.join(', ')} ${days.length === 1 ? 'sweep' : 'sweeps'}`
}

export function spanWords(seconds: number): string {
  const minutes = Math.round(seconds / minuteSeconds)
  const hours = Math.floor(minutes / minuteSeconds)

  return hours === 0 ? `${minutes} min` : `${hours} h ${String(minutes % minuteSeconds).padStart(2, '0')}`
}

const startWords = (edge: SpellEdge, upLineDegrees: number): string => {
  switch (edge.cause) {
    case 'dark':
      return 'dark'
    case 'trees':
      return `${edge.compass} gap`
    case 'up-line':
      return `over the ${upLineDegrees}° line`
    case 'horizon':
      return 'rises'
  }
}

const endWords = (edge: SpellEdge, upLineDegrees: number): string => {
  switch (edge.cause) {
    case 'dark':
      return 'dark ends'
    case 'trees':
      return `trees ${edge.compass}`
    case 'up-line':
      return `under the ${upLineDegrees}° line`
    case 'horizon':
      return 'sets'
  }
}

export function nightFacts(night: HorizonNight, clock: (at: number) => string): ReadonlyArray<FactCell> {
  const { clear, highest, flip } = night.facts
  const { upLineDegrees } = night.horizon

  const clears: FactCell =
    clear === null
      ? { label: 'Clears', value: 'Never tonight', note: null }
      : {
          label: clear.which === 'now' ? 'Clear since' : 'Clears',
          value: clear.startedBy.cause === 'dark' ? `At dark · ${clock(clear.clearsAt)}` : `${clock(clear.clearsAt)} · ${startWords(clear.startedBy, upLineDegrees)}`,
          note: null,
        }

  const clearFor: ReadonlyArray<FactCell> = clear === null ? [] : [{ label: 'Clear for', value: spanWords(clear.clearForSeconds), note: null }]
  const ends: ReadonlyArray<FactCell> = clear === null ? [] : [{ label: 'Ends', value: `${clock(clear.endsAt)} · ${endWords(clear.endedBy, upLineDegrees)}`, note: null }]

  const flipCell: FactCell =
    flip === null
      ? { label: 'Flip', value: 'Not tonight', note: null }
      : { label: 'Flip', value: clock(flip.at), note: flip.basis === 'meridian' ? 'Predicted at the meridian' : `Predicted from the mount's ${flip.limitDegrees === null ? '' : `${flip.limitDegrees}° `}limit` }

  return [clears, ...clearFor, { label: 'Highest', value: `${Math.round(highest.altitudeDegrees)}° at ${clock(highest.at)}`, note: null }, flipCell, ...ends]
}
