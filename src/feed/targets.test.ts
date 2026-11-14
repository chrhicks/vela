import { Context, Effect } from 'effect'
import { HttpRouter } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { targetsPath, type Placement } from '../../state/targets.ts'
import { testCatalog } from '../catalog/testing.ts'
import { Targets, TargetsRoute } from './targets.ts'

const placement: Placement = { altitudeDegrees: 71.2, moonDegrees: 112, line: { above: 'until', until: 1794380000000 } }

async function get(query: string) {
  const asked: Array<string> = []
  const targets = { search: (text: string) => Effect.sync(() => (asked.push(text), testCatalog.search(text, 2).map(found => ({ ...found, placement: found.id === 'andromeda' ? placement : null })))) }
  const { handler, dispose } = HttpRouter.toWebHandler(TargetsRoute, { disableLogger: true })
  const response = await handler(new Request(`http://localhost${targetsPath}${query}`), Context.make(Targets, targets))
  const body = await response.json()

  await dispose()

  return { status: response.status, body, asked }
}

describe('GET /targets', () => {
  it('answers with the catalog targets a text finds and where each is in the sky', async () => {
    expect(await get('?q=m%2031')).toEqual({
      status: 200,
      body: [{ id: 'andromeda', name: 'M 31', commonName: 'Andromeda Galaxy', type: 'Gx', constellation: 'Andromeda', placement }],
      asked: ['m 31'],
    })
  })

  it('answers with an empty list when nothing is found', async () => {
    expect(await get('?q=zzzzqqq')).toEqual({ status: 200, body: [], asked: ['zzzzqqq'] })
  })

  it('refuses a request with no search text', async () => {
    expect(await get('')).toEqual({ status: 400, body: { code: 'malformed' }, asked: [] })
  })
})
