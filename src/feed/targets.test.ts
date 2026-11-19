import { Context, Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { type BestPlacedAsked, type Placement, type TargetFacts } from '../../state/targets.ts'
import { testCatalog } from '../catalog/testing.ts'
import { BestPlacedRoute, CatalogRoute, TargetRoute, Targets, TargetsRoute } from './targets.ts'

const placement: Placement = { altitudeDegrees: 71.2, lineDegrees: 30, moonDegrees: 112, line: { above: 'until', until: 1794380000000 } }

async function get(address: string) {
  const asked: Array<string | BestPlacedAsked> = []
  const facts: TargetFacts = { ...testCatalog.search('m 42', 1)[0]!, placement, dualBandHint: true, raDegrees: 83.82, decDegrees: -5.39, otherNames: ['NGC 1976'], sizeArcminutes: { long: 90, short: 60 }, lastCentre: null, lastCooler: null }
  const targets = { size: testCatalog.size, facts: (id: string) => Effect.succeed(id === 'orion' ? facts : undefined), bestPlaced: (wanted: BestPlacedAsked) => Effect.sync(() => (asked.push(wanted), [{ ...testCatalog.search('m 42', 1)[0]!, placement, dualBandHint: true, sizeArcminutes: { long: 90, short: null } }])), search: (text: string) => Effect.sync(() => (asked.push(text), testCatalog.search(text, 2).map(found => ({ ...found, placement: found.id === 'andromeda' ? placement : null, dualBandHint: false, sizeArcminutes: null })))) }
  const { handler, dispose } = HttpRouter.toWebHandler(Layer.mergeAll(BestPlacedRoute, CatalogRoute, TargetRoute, TargetsRoute), { disableLogger: true })
  const response = await handler(new Request(`http://localhost${address}`), Context.make(Targets, targets))
  const body = await response.json()

  await dispose()

  return { status: response.status, body, asked }
}

describe('GET /targets', () => {
  it('answers with the catalog targets a text finds and where each is in the sky', async () => {
    expect(await get('/targets?q=m%2031')).toEqual({
      status: 200,
      body: [{ id: 'andromeda', name: 'M 31', commonName: 'Andromeda Galaxy', type: 'Gx', constellation: 'Andromeda', placement, dualBandHint: false, sizeArcminutes: null }],
      asked: ['m 31'],
    })
  })

  it('answers with an empty list when nothing is found', async () => {
    expect(await get('/targets?q=zzzzqqq')).toEqual({ status: 200, body: [], asked: ['zzzzqqq'] })
  })

  it('answers with the best placed targets at their own address, shown and ordered as asked', async () => {
    expect(await get('/targets/best-placed?show=dual-band&order=largest')).toMatchObject({ status: 200, body: [{ id: 'orion', name: 'M 42', placement, sizeArcminutes: { long: 90, short: null } }], asked: [{ show: 'dual-band', order: 'largest' }] })
  })

  it('refuses a best placed request with no way to show or order the list', async () => {
    expect(await get('/targets/best-placed')).toEqual({ status: 400, body: { code: 'malformed' }, asked: [] })
    expect(await get('/targets/best-placed?show=galaxies&order=placed')).toEqual({ status: 400, body: { code: 'malformed' }, asked: [] })
  })

  it('refuses a request with no search text', async () => {
    expect(await get('/targets')).toEqual({ status: 400, body: { code: 'malformed' }, asked: [] })
  })

  it('answers with the facts of one target', async () => {
    expect(await get('/target?id=orion')).toMatchObject({ status: 200, body: { id: 'orion', name: 'M 42', otherNames: ['NGC 1976'], sizeArcminutes: { long: 90, short: 60 }, dualBandHint: true, placement } })
  })

  it('refuses a target that is not in the catalog, and a request with no id', async () => {
    expect(await get('/target?id=nowhere')).toMatchObject({ status: 404, body: { code: 'unknown-target', text: 'nowhere' } })
    expect(await get('/target')).toMatchObject({ status: 400, body: { code: 'malformed' } })
  })

  it('says how many targets the catalog holds', async () => {
    expect(await get('/catalog')).toMatchObject({ status: 200, body: { targets: testCatalog.size } })
  })
})
