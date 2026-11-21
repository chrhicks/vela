import { Context, Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { NightName } from '../../state/entries.ts'
import type { HorizonSweep } from '../../state/horizon-sweep.ts'
import { HorizonSweepKept, HorizonSweepRoute } from './horizon-sweep.ts'

const get = async (answer: HorizonSweep) => {
  const { handler, dispose } = HttpRouter.toWebHandler(Layer.mergeAll(HorizonSweepRoute), { disableLogger: true })
  const response = await handler(new Request('http://localhost/horizon-sweep'), Context.make(HorizonSweepKept, { answer }))
  const body = await response.json()

  await dispose()

  return { status: response.status, body, cache: response.headers.get('cache-control') }
}

describe('GET /horizon-sweep', () => {
  it('serves the answer read at start', async () => {
    const answer: HorizonSweep = { status: 'available', nights: [NightName.make('2026-11-08')], frames: [{ altitudeDegrees: 10, azimuthDegrees: 20, source: 'solve', class: 'sky' }], edges: [null, 'edge'] }

    expect(await get(answer)).toEqual({ status: 200, body: answer, cache: 'no-store' })
  })

  it('serves an unavailable map with its reason', async () => {
    const answer: HorizonSweep = { status: 'unavailable', reason: 'missing', night: NightName.make('2026-11-08'), file: 'edges.jsonl' }

    expect(await get(answer)).toEqual({ status: 200, body: answer, cache: 'no-store' })
  })
})
