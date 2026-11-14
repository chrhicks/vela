import { Context, Effect } from 'effect'
import { HttpRouter } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { skyPath, type Sky } from '../../state/sky.ts'
import { SkyNow, SkyRoute } from './sky.ts'

async function get(tonight: Sky | null) {
  const { handler, dispose } = HttpRouter.toWebHandler(SkyRoute, { disableLogger: true })
  const response = await handler(new Request(`http://localhost${skyPath}`), Context.make(SkyNow, { tonight: Effect.succeed(tonight) }))
  const body = await response.json()

  await dispose()

  return { status: response.status, body }
}

describe('GET /sky', () => {
  it('answers with the dark hours and the Moon', async () => {
    const tonight: Sky = { dark: { from: 1794700000000, until: 1794740000000 }, moon: { litFraction: 0.29, up: true, changesAt: 1794710000000 } }

    expect(await get(tonight)).toEqual({ status: 200, body: tonight })
  })

  it('answers with nothing while the site is not known', async () => {
    expect(await get(null)).toEqual({ status: 200, body: null })
  })
})
