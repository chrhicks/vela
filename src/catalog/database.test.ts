import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Effect, Layer } from 'effect'
import { expect, test } from 'vitest'
import { CatalogSettings, writeCatalog } from './database.ts'
import { readNames } from './stellarium/names.ts'
import { readObjects } from './stellarium/objects.ts'
import { stellarium } from './stellarium/source.ts'
import { nameLine, objectLine } from './stellarium/testing.ts'

const objectsText = [
  objectLine({ dso: '1', ra: '83.82', dec: '-5.39', vMag: '4', type: 'HII', majorAxis: '90', minorAxis: '60', ngc: '1976', m: '42' }),
  objectLine({ dso: '2', ra: '334.75', dec: '55.98', type: 'HII', majorAxis: '80', sh2: '132', lbn: '473' }),
  objectLine({ dso: '3', ra: '305', dec: '40', type: 'SC' }),
  objectLine({ dso: '4', ra: '10', dec: '20', type: 'PN', pk: '64+5.1', ngc: '6000' }),
].join('\n')

const namesText = [
  nameLine('NGC', '1976', 'Great Orion Nebula', 'WK'),
  nameLine('NGC', '1976', 'Orion Nebula', 'WK, DSW, BCH'),
  nameLine('SH2', '132', 'Cepheus Cloud'),
  nameLine('SH2', '132', 'Lion Nebula'),
  nameLine('', '3', 'Cygnus Star Cloud', 'S&T'),
].join('\n')

async function written() {
  const database = join(mkdtempSync(join(tmpdir(), 'vela-catalog-')), 'nested', 'catalog.sqlite')
  const file = { name: 'catalog.txt', address: 'https://example.test/catalog.txt', text: objectsText, bytes: objectsText.length, sha256: 'abc' }
  const write = Effect.gen(function* () {
    const objects = yield* readObjects(objectsText)
    const names = yield* readNames(namesText)

    return yield* writeCatalog({ pulled: [{ source: stellarium, pulledAt: '2026-01-01T00:00:00.000Z', files: [file] }], stellarium: { objects, names }, openNgc: { objects: [], placed: [], names: [] } })
  })

  return new DatabaseSync(await Effect.runPromise(write.pipe(Effect.provide(Layer.succeed(CatalogSettings, { database, sameObjectArcseconds: 5 })))), { readOnly: true })
}

test('each object is one target, named by its first designation and its most cited common name, the later one on a tie', async () => {
  const targets = (await written()).prepare('SELECT id, source, name, commonName, type, raDegrees, decDegrees, majorAxisArcminutes, minorAxisArcminutes, vMagnitude, bMagnitude FROM targets ORDER BY id').all()

  expect(targets).toEqual([
    { id: 'stellarium-1', source: 'stellarium', name: 'M 42', commonName: 'Orion Nebula', type: 'HII', raDegrees: 83.82, decDegrees: -5.39, majorAxisArcminutes: 90, minorAxisArcminutes: 60, vMagnitude: 4, bMagnitude: null },
    { id: 'stellarium-2', source: 'stellarium', name: 'Sh2-132', commonName: 'Lion Nebula', type: 'HII', raDegrees: 334.75, decDegrees: 55.98, majorAxisArcminutes: 80, minorAxisArcminutes: null, vMagnitude: null, bMagnitude: null },
    { id: 'stellarium-3', source: 'stellarium', name: 'Cygnus Star Cloud', commonName: 'Cygnus Star Cloud', type: 'SC', raDegrees: 305, decDegrees: 40, majorAxisArcminutes: null, minorAxisArcminutes: null, vMagnitude: null, bMagnitude: null },
    { id: 'stellarium-4', source: 'stellarium', name: 'NGC 6000', commonName: null, type: 'PN', raDegrees: 10, decDegrees: 20, majorAxisArcminutes: null, minorAxisArcminutes: null, vMagnitude: null, bMagnitude: null },
  ])
})

test('a target is listed under every designation, in naming order, then every common name, in file order', async () => {
  const names = (await written()).prepare('SELECT target, name, common FROM target_names ORDER BY target, common, place').all()

  expect(names).toEqual([
    { target: 'stellarium-1', name: 'M 42', common: 0 },
    { target: 'stellarium-1', name: 'NGC 1976', common: 0 },
    { target: 'stellarium-1', name: 'Great Orion Nebula', common: 1 },
    { target: 'stellarium-1', name: 'Orion Nebula', common: 1 },
    { target: 'stellarium-2', name: 'Sh2-132', common: 0 },
    { target: 'stellarium-2', name: 'LBN 473', common: 0 },
    { target: 'stellarium-2', name: 'Cepheus Cloud', common: 1 },
    { target: 'stellarium-2', name: 'Lion Nebula', common: 1 },
    { target: 'stellarium-3', name: 'Cygnus Star Cloud', common: 1 },
    { target: 'stellarium-4', name: 'NGC 6000', common: 0 },
    { target: 'stellarium-4', name: 'PK 64+5.1', common: 0 },
  ])
})

test('the database records each source and each file it was built from', async () => {
  const database = await written()

  expect(database.prepare('SELECT id, name, license, pulledAt FROM sources').all()).toEqual([{ id: 'stellarium', name: stellarium.name, license: 'GPL-2.0-or-later', pulledAt: '2026-01-01T00:00:00.000Z' }])
  expect(database.prepare('SELECT source, name, address, sha256 FROM source_files').all()).toEqual([{ source: 'stellarium', name: 'catalog.txt', address: 'https://example.test/catalog.txt', sha256: 'abc' }])
})

test('a target counts the references cited across its names', async () => {
  const cited = (await written()).prepare('SELECT name, nameCitations FROM targets ORDER BY id').all()

  expect(cited).toEqual([
    { name: 'M 42', nameCitations: 4 },
    { name: 'Sh2-132', nameCitations: 0 },
    { name: 'Cygnus Star Cloud', nameCitations: 1 },
    { name: 'NGC 6000', nameCitations: 0 },
  ])
})

test('a target says whether it is in a catalogue of hydrogen regions', async () => {
  const listed = (await written()).prepare('SELECT name, inHydrogenRegionCatalog FROM targets ORDER BY id').all()

  expect(listed).toEqual([
    { name: 'M 42', inHydrogenRegionCatalog: 0 },
    { name: 'Sh2-132', inHydrogenRegionCatalog: 1 },
    { name: 'Cygnus Star Cloud', inHydrogenRegionCatalog: 0 },
    { name: 'NGC 6000', inHydrogenRegionCatalog: 0 },
  ])
})
