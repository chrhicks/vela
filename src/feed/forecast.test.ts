import { Context, Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { ForecastRefused } from '../forecast/night.ts'
import { ForecastNights, ForecastRoute } from './forecast.ts'

const forecast = { at: 0, cloudyPercent: 50, hours: [], nws: { ageSeconds: null, failing: false }, openMeteo: { ageSeconds: null, failing: false } }

async function get(address: string, night: (at: number) => Effect.Effect<typeof forecast, ForecastRefused>) {
  const asked: Array<number> = []
  const { handler, dispose } = HttpRouter.toWebHandler(Layer.mergeAll(ForecastRoute), { disableLogger: true })
  const response = await handler(new Request(`http://localhost${address}`), Context.make(ForecastNights, { night: at => (asked.push(at), night(at)) }))
  const body = await response.json()

  await dispose()

  return { status: response.status, body, cache: response.headers.get('cache-control'), asked }
}

describe('GET /forecast', () => {
  it('answers for the instant asked, with the same time rule as the night', async () => {
    const answer = await get('/forecast?at=2026-11-15T15:00:00-07:00', () => Effect.succeed(forecast))

    expect(answer).toMatchObject({ status: 200, cache: 'no-store', body: forecast, asked: [Date.parse('2026-11-15T22:00:00Z')] })
  })

  it('asks for now when no time is given', async () => {
    const before = Date.now()
    const answer = await get('/forecast', () => Effect.succeed(forecast))

    expect(answer.asked[0]!).toBeGreaterThanOrEqual(before)
    expect(answer.asked[0]!).toBeLessThanOrEqual(Date.now())
  })

  it('refuses a time that is not one', async () => {
    expect(await get('/forecast?at=soon', () => Effect.succeed(forecast))).toMatchObject({ status: 400, body: { code: 'malformed' }, asked: [] })
  })

  it('refuses with no-site (503) and no-night (422)', async () => {
    expect(await get('/forecast', () => Effect.fail(new ForecastRefused({ refusal: { code: 'no-site' } })))).toMatchObject({ status: 503, body: { code: 'no-site' } })
    expect(await get('/forecast', () => Effect.fail(new ForecastRefused({ refusal: { code: 'no-night' } })))).toMatchObject({ status: 422, body: { code: 'no-night' } })
  })
})
