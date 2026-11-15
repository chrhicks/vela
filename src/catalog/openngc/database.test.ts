import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Effect, Layer } from 'effect'
import { expect, test } from 'vitest'
import { readCatalog } from '../catalog.ts'
import { CatalogSettings, writeCatalog } from '../database.ts'
import { readObjects as readStellarium } from '../stellarium/objects.ts'
import { objectLine as stellariumLine } from '../stellarium/testing.ts'
import { namesOf, placeObjects } from './derive.ts'
import { readObjects } from './objects.ts'
import { heading, objectLine } from './testing.ts'

const stellariumText = stellariumLine({ dso: '2', ra: '228.9740', dec: '56.3288', type: 'Gx', majorAxis: '8.5', ngc: '5906' })

const openNgcText = [
  heading,
  objectLine({ name: 'NGC5907', type: 'G', ra: '15:15:53.77', dec: '+56:19:43.6', ngc: '5906', commonNames: 'Splinter Galaxy' }),
  objectLine({ name: 'NGC6727', type: 'RfN', ra: '19:01:42.00', dec: '-36:53:00.0', majAx: '80.00', vMag: '9.5' }),
].join('\n')

async function written() {
  const settings = Layer.succeed(CatalogSettings, { database: join(mkdtempSync(join(tmpdir(), 'vela-catalog-')), 'catalog.sqlite'), sameObjectArcseconds: 5 })

  return Effect.runPromise(
    Effect.gen(function* () {
      const stellarium = yield* readStellarium(stellariumText)
      const objects = yield* readObjects(openNgcText)
      const placed = yield* placeObjects(objects, stellarium, 5)
      const database = yield* writeCatalog({ pulled: [], stellarium: { objects: stellarium, names: [] }, openNgc: { objects, placed, names: objects.flatMap(namesOf) } })

      return { database: new DatabaseSync(database, { readOnly: true }), catalog: yield* readCatalog }
    }).pipe(Effect.provide(settings)),
  )
}

test('an OpenNGC object the catalog lacks is a target of its own', async () => {
  const { database } = await written()

  expect(database.prepare('SELECT id, source, name, commonName, type, raDegrees, majorAxisArcminutes, minorAxisArcminutes, vMagnitude FROM targets ORDER BY id').all()).toEqual([
    { id: 'openngc-ngc6727', source: 'openngc', name: 'NGC 6727', commonName: null, type: 'RfN', raDegrees: 285.425, majorAxisArcminutes: 80, minorAxisArcminutes: null, vMagnitude: 9.5 },
    { id: 'stellarium-2', source: 'stellarium', name: 'NGC 5906', commonName: null, type: 'Gx', raDegrees: 228.974, majorAxisArcminutes: 8.5, minorAxisArcminutes: null, vMagnitude: null },
  ])
})

test('an OpenNGC object the catalog has under another number adds its names to that target', async () => {
  const { database, catalog } = await written()

  expect(database.prepare("SELECT name, common FROM target_names WHERE target = 'stellarium-2' ORDER BY place").all()).toEqual([
    { name: 'NGC 5906', common: 0 },
    { name: 'NGC 5907', common: 0 },
    { name: 'NGC 5906', common: 0 },
    { name: 'Splinter Galaxy', common: 1 },
  ])
  expect(catalog.search('ngc 5907', 5).map(found => found.id)).toEqual(['stellarium-2'])
  expect(catalog.search('splinter', 5).map(found => found.id)).toEqual(['stellarium-2'])
  expect(catalog.search('ngc 6727', 5).map(found => found.id)).toEqual(['openngc-ngc6727'])
})
