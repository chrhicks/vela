import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { HorizonNight } from '../../state/horizon-night.ts'
import { nightTimes } from '../sky/darkness.ts'
import { noHorizon, type Horizon } from '../horizon/horizon.ts'
import { makeHorizonNights } from './horizon-night.ts'
import { testCatalog } from './testing.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const afternoon = Date.UTC(2026, 10, 15, 22, 0, 0)
const night = nightTimes(phoenix, afternoon)!
const hourMs = 3_600_000
const naming = { zone: 'America/Phoenix', changesAtHour: 12 }
const settings = { stepSeconds: 60, decimals: 2, upLineDegrees: 30 }
const mapped: Horizon = { ...noHorizon, altitudesDegrees: noHorizon.altitudesDegrees.map(() => 10), sources: noHorizon.sources.map(() => 'sweep') }

const nights = (site: typeof phoenix | null, horizon: Horizon = noHorizon, meridianLimit: number | undefined = undefined) =>
  makeHorizonNights({ catalog: testCatalog, site: () => site ?? undefined, horizon, horizonFileLoaded: horizon !== noHorizon, meridianLimitDegrees: () => meridianLimit, naming, settings })

const answered = (id: string, at: number, site: typeof phoenix | null = phoenix, horizon: Horizon = noHorizon, meridianLimit?: number) =>
  Effect.runSync(nights(site, horizon, meridianLimit).night(id, at).pipe(Effect.catchTag('HorizonNightRefused', ({ refusal }) => Effect.succeed(refusal))))

describe('the night of a catalog target', () => {
  it('answers with the night it falls in, named for the evening in the night zone', () => {
    const answer = answered('orion', afternoon)

    expect(answer).toMatchObject({ target: { id: 'orion', name: 'M 42', commonName: 'Orion Nebula' }, at: afternoon, night: '2026-11-15', zone: 'America/Phoenix', times: { duskAt: night.duskAt, darkAt: night.darkAt, darkEndsAt: night.darkEndsAt, dawnAt: night.dawnAt } })
  })

  it('is the same night after midnight and in the small hours', () => {
    expect(answered('orion', night.duskAt + 6 * hourMs)).toMatchObject({ night: '2026-11-15', times: { duskAt: night.duskAt } })
  })

  it('rolls to the coming night once dawn has passed, and names that one', () => {
    const morning = answered('orion', night.dawnAt + hourMs)

    expect(morning).toMatchObject({ at: night.dawnAt + hourMs, night: '2026-11-16' })
    expect(morning).toMatchObject({ times: { duskAt: expect.any(Number) } })
    expect((morning as { times: { duskAt: number } }).times.duskAt - night.duskAt).toBeGreaterThan(23 * hourMs)
    expect((morning as { times: { duskAt: number } }).times.duskAt - night.duskAt).toBeLessThan(25 * hourMs)
  })

  it('is the coming night when asked before dusk', () => {
    expect(answered('orion', Date.UTC(2026, 10, 15, 19, 0, 0))).toMatchObject({ night: '2026-11-15', times: { duskAt: night.duskAt } })
  })

  it('says the horizon file was not loaded when there is none, with every bin unknown', () => {
    const answer = answered('orion', afternoon) as HorizonNight

    expect(answer.horizon.fileLoaded).toBe(false)
    expect(answer.horizon.altitudesDegrees).toHaveLength(360)
    expect(answer.horizon.altitudesDegrees.every(altitude => altitude === null)).toBe(true)
    expect(answer.horizon.sources.every(source => source === null)).toBe(true)
    expect(answer.horizon.upLineDegrees).toBe(30)
    expect(answer.path.lines.every(line => line === 30)).toBe(true)
  })

  it('carries the bins and their sources when a file was loaded, and draws the path against them', () => {
    const answer = answered('orion', afternoon, phoenix, mapped) as HorizonNight

    expect(answer.horizon.fileLoaded).toBe(true)
    expect(answer.horizon.altitudesDegrees.every(altitude => altitude === 10)).toBe(true)
    expect(answer.horizon.sources.every(source => source === 'sweep')).toBe(true)
    expect(answer.path.lines.every(line => line === 10)).toBe(true)
  })

  it('answers in a shape that decodes, whole, from its JSON', () => {
    const answer = answered('orion', afternoon, phoenix, mapped, 5)

    expect(Schema.decodeUnknownSync(HorizonNight)(JSON.parse(JSON.stringify(answer)))).toEqual(answer)
  })

  it('predicts the flip from the mount limit when it has one, and from the meridian when it has not', () => {
    expect((answered('orion', afternoon, phoenix, noHorizon, 5) as HorizonNight).facts.flip).toMatchObject({ basis: 'mount-limit', limitDegrees: 5 })
    expect((answered('orion', afternoon) as HorizonNight).facts.flip).toMatchObject({ basis: 'meridian', limitDegrees: null })
  })

  it('refuses a target that is not in the catalog', () => {
    expect(answered('nowhere', afternoon)).toEqual({ code: 'unknown-target', text: 'nowhere' })
  })

  it('refuses when the mount has not reported its site', () => {
    expect(answered('orion', afternoon, null)).toEqual({ code: 'no-site' })
  })

  it('refuses where the Sun never sets or never rises', () => {
    const arctic = { latitudeDegrees: 80, longitudeDegrees: 0, elevationMeters: 0 }

    expect(answered('orion', Date.UTC(2026, 5, 21, 12, 0, 0), arctic)).toEqual({ code: 'no-night' })
  })
})
