import { Context, Effect, Layer, Schema } from 'effect'
import { HttpRouter } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { HorizonNight, HorizonPaths } from '../../state/horizon-night.ts'
import { HorizonNightRefused, makeHorizonNights } from '../catalog/horizon-night.ts'
import { testCatalog } from '../catalog/testing.ts'
import { noHorizon } from '../horizon/horizon.ts'
import { HorizonNightRoute, HorizonNights, HorizonPathsRoute } from './horizon-night.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }

const nightsFor = (site: typeof phoenix | null) =>
  makeHorizonNights({ catalog: testCatalog, site: () => site ?? undefined, horizon: noHorizon, horizonFileLoaded: false, meridianLimitDegrees: () => undefined, cameraAngleDegrees: () => undefined, naming: { zone: 'America/Phoenix', changesAtHour: 12 }, settings: { stepSeconds: 60, decimals: 2, frameAngleDecimals: 1, frameEdgeSamples: 16, upLineDegrees: 30 } })

async function get(address: string, site: typeof phoenix | null = phoenix) {
  const asked: Array<{ readonly id: string; readonly at: number }> = []
  const nights = nightsFor(site)
  const service = { night: (id: string, at: number) => (asked.push({ id, at }), nights.night(id, at)), paths: (ids: ReadonlyArray<string>, at: number) => nights.paths(ids, at) }
  const { handler, dispose } = HttpRouter.toWebHandler(Layer.mergeAll(HorizonNightRoute, HorizonPathsRoute), { disableLogger: true })
  const response = await handler(new Request(`http://localhost${address}`), Context.make(HorizonNights, service))
  const body = await response.json()

  await dispose()

  return { status: response.status, body, cache: response.headers.get('cache-control'), asked }
}

describe('GET /horizon-night', () => {
  it("answers with a target's night at the instant asked", async () => {
    const afternoon = '2026-11-15T22:00:00Z'
    const answer = await get(`/horizon-night?target=orion&at=${afternoon}`)

    expect(answer.status).toBe(200)
    expect(answer.cache).toBe('no-store')
    expect(answer.asked).toEqual([{ id: 'orion', at: Date.parse(afternoon) }])
    expect(Schema.decodeUnknownSync(HorizonNight)(answer.body)).toMatchObject({ night: '2026-11-15', zone: 'America/Phoenix', at: Date.parse(afternoon) })
    expect(Object.keys(HorizonNight.fields)).toEqual(['target', 'at', 'night', 'zone', 'times', 'horizon', 'path', 'moon', 'frame', 'clear', 'facts'])
    expect(Object.keys(HorizonNight.fields.path.fields)).toEqual(['startAt', 'stepSeconds', 'altitudes', 'azimuths', 'lines'])
    expect(Object.keys(HorizonNight.fields.moon.fields)).toEqual(['litFraction', 'altitudes', 'azimuths', 'upSpans'])
    expect(Object.keys(HorizonNight.fields.frame.fields)).toEqual(['angleDegrees', 'northAngles', 'firstCleanAt'])
    expect(Object.keys(HorizonNight.fields.facts.fields)).toEqual(['clear', 'highest', 'transitAt', 'flip'])
  })

  it('takes an offset time as the instant it names', async () => {
    expect((await get('/horizon-night?target=orion&at=2026-11-15T15:00:00-07:00')).asked).toEqual([{ id: 'orion', at: Date.parse('2026-11-15T22:00:00Z') }])
  })

  it('asks for now when no time is given', async () => {
    const before = Date.now()
    const answer = await get('/horizon-night?target=orion')
    const after = Date.now()

    expect(answer.status).toBe(200)
    expect(answer.asked[0]!.at).toBeGreaterThanOrEqual(before)
    expect(answer.asked[0]!.at).toBeLessThanOrEqual(after)
  })

  it('refuses a request with no target, an empty one, or a time that is not one', async () => {
    expect(await get('/horizon-night')).toMatchObject({ status: 400, body: { code: 'malformed' }, asked: [] })
    expect(await get('/horizon-night?target=')).toMatchObject({ status: 400, body: { code: 'malformed' }, asked: [] })
    expect(await get('/horizon-night?target=orion&at=tonight')).toMatchObject({ status: 400, body: { code: 'malformed' }, asked: [] })
    expect(await get('/horizon-night?target=orion&at=2026-13-45T10:00:00Z')).toMatchObject({ status: 400, body: { code: 'malformed' }, asked: [] })
  })

  it('refuses a target that is not in the catalog', async () => {
    expect(await get('/horizon-night?target=nowhere&at=2026-11-15T22:00:00Z')).toMatchObject({ status: 404, body: { code: 'unknown-target', text: 'nowhere' } })
  })

  it('refuses when the mount has not reported its site', async () => {
    expect(await get('/horizon-night?target=orion&at=2026-11-15T22:00:00Z', null)).toMatchObject({ status: 503, body: { code: 'no-site' } })
  })

  it('refuses where there is no night to sample', async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(Layer.mergeAll(HorizonNightRoute, HorizonPathsRoute), { disableLogger: true })
    const refusal = Effect.fail(new HorizonNightRefused({ refusal: { code: 'no-night' } }))
    const service = { night: () => refusal, paths: () => refusal }
    const response = await handler(new Request('http://localhost/horizon-night?target=orion'), Context.make(HorizonNights, service))

    await dispose()

    expect({ status: response.status, body: await response.json() }).toEqual({ status: 422, body: { code: 'no-night' } })
  })
})

describe('GET /horizon-paths', () => {
  const afternoon = '2026-11-15T22:00:00Z'

  it('answers with every asked target path in one body, leaving out the Moon, horizon and frame', async () => {
    const answer = await get(`/horizon-paths?targets=orion,triangulum,nowhere,orion&at=${afternoon}`)
    const paths = Schema.decodeUnknownSync(HorizonPaths)(answer.body)

    expect(answer.status).toBe(200)
    expect(answer.cache).toBe('no-store')
    expect(paths.at).toBe(Date.parse(afternoon))
    expect(paths.targets.map(({ target }) => target.id)).toEqual(['orion', 'triangulum'])
    expect(paths.unknown).toEqual(['nowhere'])
    expect(Object.keys(answer.body as object)).toEqual(['at', 'targets', 'unknown'])
    expect(Object.keys(paths.targets[0]!.path)).toEqual(['startAt', 'stepSeconds', 'altitudes', 'azimuths', 'lines'])
  })

  it('draws the same path for a target as the full night does', async () => {
    const one = Schema.decodeUnknownSync(HorizonPaths)((await get(`/horizon-paths?targets=orion&at=${afternoon}`)).body)
    const night = Schema.decodeUnknownSync(HorizonNight)((await get(`/horizon-night?target=orion&at=${afternoon}`)).body)

    expect(one.targets[0]!.path).toEqual(night.path)
  })

  it('answers with an empty list when every target is unknown', async () => {
    expect(await get(`/horizon-paths?targets=nowhere&at=${afternoon}`)).toMatchObject({ status: 200, body: { targets: [], unknown: ['nowhere'] } })
  })

  it('refuses a request with no targets, an empty one, or a time that is not one', async () => {
    expect(await get('/horizon-paths')).toMatchObject({ status: 400, body: { code: 'malformed' } })
    expect(await get('/horizon-paths?targets=')).toMatchObject({ status: 400, body: { code: 'malformed' } })
    expect(await get('/horizon-paths?targets=orion,,m3')).toMatchObject({ status: 400, body: { code: 'malformed' } })
    expect(await get('/horizon-paths?targets=orion&at=tonight')).toMatchObject({ status: 400, body: { code: 'malformed' } })
  })

  it('refuses when the mount has not reported its site', async () => {
    expect(await get(`/horizon-paths?targets=orion&at=${afternoon}`, null)).toMatchObject({ status: 503, body: { code: 'no-site' } })
  })
})
