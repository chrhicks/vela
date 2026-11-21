import { CloudSource, type Forecast, type ForecastHour } from './forecast.ts'
import type { HorizonNight } from './horizon-night.ts'
import { skyPointAt, spanWords, type FactCell, type SkyPoint, type TimeRun } from './horizon-view.ts'

export interface CloudHour extends TimeRun {
  readonly coverPercent: number | null
  readonly source: ForecastHour['source']
}

export interface CloudLabel {
  readonly words: string
  readonly point: SkyPoint
}

const hourMs = 3_600_000
const secondMs = 1000

export function cloudHours(span: TimeRun, forecast: Forecast | undefined): ReadonlyArray<CloudHour> {
  const known = new Map((forecast?.hours ?? []).map(hour => [hour.at, hour]))
  const hours: Array<CloudHour> = []

  for (let at = Math.floor(span.from / hourMs) * hourMs; at < span.until; at += hourMs) {
    const hour = known.get(at)

    hours.push({ from: Math.max(at, span.from), until: Math.min(at + hourMs, span.until), coverPercent: hour?.coverPercent ?? null, source: hour?.source ?? null })
  }

  return hours
}

export const isCloudy = (hour: CloudHour, cloudyPercent: number): boolean => hour.coverPercent !== null && hour.coverPercent >= cloudyPercent

export function cloudyRuns(hours: ReadonlyArray<CloudHour>, cloudyPercent: number): ReadonlyArray<TimeRun> {
  const runs: Array<{ from: number; until: number }> = []

  for (const hour of hours) {
    if (!isCloudy(hour, cloudyPercent)) continue

    const open = runs.at(-1)

    if (open !== undefined && open.until === hour.from) open.until = hour.until
    else runs.push({ from: hour.from, until: hour.until })
  }

  return runs
}

export const cloudAt = (hours: ReadonlyArray<CloudHour>, at: number): CloudHour | undefined => hours.find(hour => at >= hour.from && at < hour.until) ?? (hours.at(-1)?.until === at ? hours.at(-1) : undefined)

export function cloudWords(hours: ReadonlyArray<CloudHour>, at: number): string {
  const hour = cloudAt(hours, at)

  return hour === undefined || hour.coverPercent === null ? 'Cloud unknown' : `Cloud ${Math.round(hour.coverPercent)}%`
}

const hourWords = (clock: (at: number) => string, at: number) => clock(at).replace(/:00$/, '')

export function cloudLabels(night: HorizonNight, runs: ReadonlyArray<TimeRun>, clock: (at: number) => string): ReadonlyArray<CloudLabel> {
  const { path } = night

  return runs.flatMap(run => {
    const samples = path.altitudes.map((altitude, index) => ({ at: path.startAt + index * path.stepSeconds * secondMs, altitude })).filter(sample => sample.at >= run.from && sample.at < run.until)
    const highest = samples.reduce<(typeof samples)[number] | undefined>((best, sample) => (best === undefined || sample.altitude > best.altitude ? sample : best), undefined)
    const point = highest === undefined ? undefined : skyPointAt(path, highest.at)

    return point === undefined || point.altitudeDegrees < 0 ? [] : [{ words: `Clouds ${hourWords(clock, run.from)} to ${hourWords(clock, run.until)} · forecast`, point }]
  })
}

const sourceNames: Readonly<Record<CloudSource, string>> = { nws: 'NWS', 'open-meteo': 'Open-Meteo' }

export function forecastNote(forecast: Forecast | undefined, hours: ReadonlyArray<CloudHour>): string {
  if (forecast === undefined) return 'No cloud forecast'

  const used = CloudSource.literals.filter(source => hours.some(hour => hour.source === source))

  if (used.length === 0) return forecast.nws.failing || forecast.openMeteo.failing ? 'No cloud forecast, lookup failing' : 'No cloud forecast'

  const state = (source: CloudSource) => (source === 'nws' ? forecast.nws : forecast.openMeteo)

  return `Clouds: ${used.map(source => `${sourceNames[source]}, ${state(source).ageSeconds === null ? 'age unknown' : `${spanWords(state(source).ageSeconds ?? 0)} old`}${state(source).failing ? ', refresh failing' : ''}`).join(' and ')}`
}

export function forecastClearCell(night: HorizonNight, hours: ReadonlyArray<CloudHour>, cloudyPercent: number): FactCell | undefined {
  const { clear } = night.facts

  if (clear === null) return undefined

  const overlap = (hour: CloudHour) => Math.max(0, Math.min(hour.until, clear.endsAt) - Math.max(hour.from, clear.clearsAt)) / secondMs
  const within = hours.filter(hour => overlap(hour) > 0)
  const unknown = within.filter(hour => hour.coverPercent === null).reduce((sum, hour) => sum + overlap(hour), 0)

  if (within.length > 0 && unknown === within.reduce((sum, hour) => sum + overlap(hour), 0)) return { label: 'Forecast clear', value: 'Unknown', note: 'No cloud forecast for this spell' }

  const cloudy = within.filter(hour => isCloudy(hour, cloudyPercent)).reduce((sum, hour) => sum + overlap(hour), 0)

  return { label: 'Forecast clear', value: spanWords(Math.max(0, clear.clearForSeconds - cloudy)), note: unknown > 0 ? `${spanWords(unknown)} with no forecast` : null }
}

export function withForecastClear(cells: ReadonlyArray<FactCell>, cell: FactCell | undefined): ReadonlyArray<FactCell> {
  if (cell === undefined) return cells

  const at = cells.findIndex(found => found.label === 'Clear for')

  return at < 0 ? cells : [...cells.slice(0, at + 1), cell, ...cells.slice(at + 1)]
}
