import { Clock, Effect, Ref, Result, Schema, Semaphore } from 'effect'
import type { ForecastHour, SourceState } from '../../state/forecast.ts'
import type { Site } from '../pointing/target.ts'
import { hourMs, hourStart, NwsGridData, NwsGridPoint, nwsCover, OpenMeteoAnswer, openMeteoCover } from './cover.ts'
import type { ForecastSettings } from './settings.ts'
import { ForecastUnreachable, ForecastUnreadable, type ForecastSource } from './source.ts'

export interface ForecastHours {
  readonly hours: ReadonlyArray<ForecastHour>
  readonly nws: SourceState
  readonly openMeteo: SourceState
}

export interface Forecasts {
  readonly hours: (site: Site, from: number, until: number) => Effect.Effect<ForecastHours>
}

export interface ForecastOptions {
  readonly source: ForecastSource
  readonly settings: ForecastSettings
  readonly report: (line: string) => Effect.Effect<void>
}

interface Kept {
  readonly cover: ReadonlyMap<number, number>
  readonly triedAt: number | undefined
  readonly answeredAt: number | undefined
  readonly failing: boolean
}

interface Entry {
  readonly key: string
  readonly grid: string | undefined
  readonly nws: Kept
  readonly openMeteo: Kept
}

const nothingKept: Kept = { cover: new Map(), triedAt: undefined, answeredAt: undefined, failing: false }

const entryFor = (key: string): Entry => ({ key, grid: undefined, nws: nothingKept, openMeteo: nothingKept })

const secondMs = 1000
const minuteMs = 60 * secondMs

const decoded = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => (body: unknown) =>
  Schema.decodeUnknownEffect(schema)(body).pipe(Effect.mapError(() => new ForecastUnreadable()))

const reasonOf = (failure: ForecastUnreachable | ForecastUnreadable) => (failure._tag === 'ForecastUnreachable' ? failure.reason : 'the answer was not in the form expected')

export function makeForecasts({ source, settings, report }: ForecastOptions): Effect.Effect<Forecasts> {
  const refreshMs = settings.refreshMinutes * minuteMs
  const retryMs = settings.retryMinutes * minuteMs
  const keyOf = (site: Site) => `${site.latitudeDegrees.toFixed(settings.positionDecimals)},${site.longitudeDegrees.toFixed(settings.positionDecimals)}`

  const dueAfter = (kept: Kept) => (kept.triedAt === undefined ? 0 : kept.triedAt + (kept.failing ? retryMs : refreshMs))

  const nwsDue = (entry: Entry, now: number) => now >= dueAfter(entry.nws)

  const lacking = (entry: Entry, from: number, until: number) => {
    for (let hour = hourStart(from); hour <= hourStart(until - 1); hour += hourMs) if (!entry.nws.cover.has(hour)) return true

    return false
  }

  const openMeteoDue = (entry: Entry, now: number, from: number, until: number) => lacking(entry, from, until) && now >= dueAfter(entry.openMeteo)

  const gridOf = (key: string) =>
    source.json(`${settings.nwsAddress}/points/${key}`).pipe(
      Effect.flatMap(decoded(NwsGridPoint)),
      Effect.map(({ properties }) => `${settings.nwsAddress}/gridpoints/${properties.gridId}/${properties.gridX},${properties.gridY}`),
    )

  const nwsCoverOf = (grid: string) => source.json(grid).pipe(Effect.flatMap(decoded(NwsGridData)), Effect.map(nwsCover))

  const openMeteoCoverOf = (site: Site) => {
    const query = new URLSearchParams({
      latitude: site.latitudeDegrees.toFixed(settings.positionDecimals),
      longitude: site.longitudeDegrees.toFixed(settings.positionDecimals),
      hourly: 'cloud_cover',
      timeformat: 'unixtime',
      past_hours: String(settings.openMeteoPastHours),
      forecast_days: String(settings.openMeteoForecastDays),
    })

    return source.json(`${settings.openMeteoAddress}/v1/forecast?${query}`).pipe(Effect.flatMap(decoded(OpenMeteoAnswer)), Effect.map(openMeteoCover))
  }

  const settled = (name: string, before: Kept, now: number, outcome: Result.Result<ReadonlyMap<number, number>, ForecastUnreachable | ForecastUnreadable>) =>
    Effect.gen(function* () {
      if (Result.isFailure(outcome)) {
        if (!before.failing) yield* report(`forecast from ${name} unavailable: ${reasonOf(outcome.failure)}`)

        return { ...before, triedAt: now, failing: true }
      }

      if (before.failing) yield* report(`forecast from ${name} is back`)

      return { cover: outcome.success, triedAt: now, answeredAt: now, failing: false }
    })

  const refreshNws = (key: string, entry: Entry, now: number) =>
    Effect.gen(function* () {
      const found: Result.Result<string, ForecastUnreachable | ForecastUnreadable> = entry.grid === undefined ? yield* Effect.result(gridOf(key)) : Result.succeed(entry.grid)

      if (Result.isFailure(found)) return { ...entry, nws: yield* settled('nws', entry.nws, now, Result.fail(found.failure)) }

      const outcome = yield* Effect.result(nwsCoverOf(found.success))

      return { ...entry, grid: found.success, nws: yield* settled('nws', entry.nws, now, outcome) }
    })

  const refreshOpenMeteo = (site: Site, entry: Entry, now: number) => Effect.result(openMeteoCoverOf(site)).pipe(Effect.flatMap(outcome => settled('open-meteo', entry.openMeteo, now, outcome)), Effect.map(openMeteo => ({ ...entry, openMeteo })))

  const stateOf = (kept: Kept, now: number): SourceState => ({ ageSeconds: kept.answeredAt === undefined ? null : Math.floor((now - kept.answeredAt) / secondMs), failing: kept.failing })

  return Effect.gen(function* () {
    const held = yield* Ref.make<Entry | undefined>(undefined)
    const turn = yield* Semaphore.make(1)

    const current = (key: string) => Effect.map(Ref.get(held), found => (found?.key === key ? found : entryFor(key)))

    const refreshed = (site: Site, from: number, until: number) =>
      turn.withPermits(1)(
        Effect.gen(function* () {
          const key = keyOf(site)
          const now = yield* Clock.currentTimeMillis
          let entry = yield* current(key)

          if (nwsDue(entry, now)) entry = yield* refreshNws(key, entry, now)

          if (openMeteoDue(entry, now, from, until)) entry = yield* refreshOpenMeteo(site, entry, now)

          yield* Ref.set(held, entry)
        }),
      )

    return {
      hours: (site, from, until) =>
        Effect.gen(function* () {
          const key = keyOf(site)
          const asked = yield* Clock.currentTimeMillis
          const before = yield* current(key)
          const owed = nwsDue(before, asked) || openMeteoDue(before, asked, from, until)
          const unseen = (nwsDue(before, asked) && before.nws.triedAt === undefined) || (openMeteoDue(before, asked, from, until) && before.openMeteo.triedAt === undefined)

          if (owed && unseen) yield* refreshed(site, from, until)
          else if (owed) yield* Effect.forkDetach(refreshed(site, from, until))

          const entry = yield* current(key)
          const now = yield* Clock.currentTimeMillis
          const hours: Array<ForecastHour> = []

          for (let at = hourStart(from); at <= hourStart(until - 1); at += hourMs) {
            const nws = entry.nws.cover.get(at)
            const openMeteo = entry.openMeteo.cover.get(at)

            hours.push(nws !== undefined ? { at, coverPercent: nws, source: 'nws' } : openMeteo !== undefined ? { at, coverPercent: openMeteo, source: 'open-meteo' } : { at, coverPercent: null, source: null })
          }

          return { hours, nws: stateOf(entry.nws, now), openMeteo: stateOf(entry.openMeteo, now) }
        }),
    }
  })
}
