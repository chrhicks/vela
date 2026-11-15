import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { readObjects as readStellarium } from '../stellarium/objects.ts'
import { objectLine as stellariumLine } from '../stellarium/testing.ts'
import { designationOf, namesOf, placeObjects } from './derive.ts'
import { readObjects } from './objects.ts'
import { heading, objectLine } from './testing.ts'

const stellariumText = [
  stellariumLine({ dso: '1', ra: '83.8221', dec: '-5.3911', type: 'HII', ngc: '1976', m: '42' }),
  stellariumLine({ dso: '2', ra: '228.9740', dec: '56.3288', type: 'Gx', ngc: '5906' }),
  stellariumLine({ dso: '3', ra: '10.0', dec: '10.0', type: 'Gx', ic: '298' }),
].join('\n')

const openNgcText = [
  heading,
  objectLine({ name: 'NGC1976', type: 'Cl+N', ra: '05:35:16.48', dec: '-05:23:22.8', m: '042', commonNames: 'Great Orion Nebula,Orion Nebula' }),
  objectLine({ name: 'NGC5907', type: 'G', ra: '15:15:53.77', dec: '+56:19:43.6', ngc: '5906' }),
  objectLine({ name: 'IC0298A', type: 'G', ra: '00:40:00.40', dec: '+10:00:00.0' }),
  objectLine({ name: 'NGC6727', type: 'RfN', ra: '19:01:42.00', dec: '-36:53:00.0' }),
  objectLine({ name: 'NGC0005', type: 'Dup', ra: '00:07:48.87', dec: '+35:21:44.2' }),
  objectLine({ name: 'IC3322A', type: 'G', ra: '12:25:42.56', dec: '+07:12:60.0' }),
].join('\n')

const placedWith = (text: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stellarium = yield* readStellarium(stellariumText)
      const objects = yield* readObjects(text)

      return yield* placeObjects(objects, stellarium, 5)
    }).pipe(Effect.result),
  )

describe('OpenNGC objects against the catalog', () => {
  it('writes a designation the usual way', () => {
    expect(['NGC0224', 'IC3322A', 'IC0080 NED01', 'Mel022', 'B033', 'ESO056-115'].map(designationOf)).toEqual(['NGC 224', 'IC 3322A', 'IC 80 NED01', 'Mel 22', 'B 33', 'ESO 56-115'])
  })

  it('takes an object with the same NGC or IC number as the same object', async () => {
    expect(await placedWith(openNgcText)).toMatchObject({ success: expect.arrayContaining([expect.objectContaining({ name: 'NGC1976', stellariumDso: 1 })]) })
  })

  it('takes an object within the set distance of one in the catalog as the same object under another number', async () => {
    expect(await placedWith(openNgcText)).toMatchObject({ success: expect.arrayContaining([expect.objectContaining({ name: 'NGC5907', stellariumDso: 2 })]) })
  })

  it('keeps a lettered part and an object nowhere near as objects of their own, and leaves out duplicates', async () => {
    const placed = await placedWith(openNgcText)

    expect(placed).toMatchObject({
      success: expect.arrayContaining([expect.objectContaining({ name: 'IC0298A', stellariumDso: null }), expect.objectContaining({ name: 'NGC6727', stellariumDso: null, raDegrees: 285.425, decDegrees: expect.closeTo(-36.8833, 4) })]),
    })
    expect(placed._tag === 'Success' && placed.success.map(object => object.name)).toEqual(['NGC1976', 'NGC5907', 'IC0298A', 'NGC6727', 'IC3322A'])
  })

  it('reads sixty seconds of arc as the next minute', async () => {
    expect(await placedWith(openNgcText)).toMatchObject({ success: expect.arrayContaining([expect.objectContaining({ name: 'IC3322A', decDegrees: expect.closeTo(7 + 13 / 60, 6) })]) })
  })

  it('reports a position it cannot read', async () => {
    expect(await placedWith([heading, objectLine({ name: 'NGC0001', type: 'G', ra: '25h', dec: '+10' })].join('\n'))).toMatchObject({ _tag: 'Failure', failure: { _tag: 'SourceUnreadable', source: 'openngc', line: 2 } })
  })

  it("lists an object's names: Messier, its own, cross numbers, then common names", async () => {
    const [orion, splinter] = await Effect.runPromise(readObjects(openNgcText))

    expect(namesOf(orion!).map(({ alias, common }) => [alias, common])).toEqual([['M 42', 0], ['NGC 1976', 0], ['Great Orion Nebula', 1], ['Orion Nebula', 1]])
    expect(namesOf(splinter!).map(({ alias }) => alias)).toEqual(['NGC 5907', 'NGC 5906'])
  })
})
