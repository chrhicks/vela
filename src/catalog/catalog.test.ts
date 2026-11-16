import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { normalised, readCatalog } from './catalog.ts'
import { CatalogSettings, writeCatalog } from './database.ts'
import { readNames } from './stellarium/names.ts'
import { readObjects } from './stellarium/objects.ts'
import { stellarium } from './stellarium/source.ts'
import { nameLine, objectLine } from './stellarium/testing.ts'
import { testCatalog } from './testing.ts'

describe('catalog search', () => {
  it('ignores case, spaces and the zero padding of catalog numbers', () => {
    expect(normalised('NGC0224')).toBe('ngc224')
    expect(normalised('NGC 224')).toBe('ngc224')
    expect(normalised('M 31')).toBe('m31')
    expect(normalised('B033')).toBe('b33')
    expect(normalised('Sh2-132')).toBe('sh2132')
    expect(normalised('NGC 1000')).toBe('ngc1000')
  })

  it.each(['M31', 'm 31', 'NGC 224', 'ngc0224', 'andromeda galaxy'])('finds the Andromeda Galaxy first for %s', query => {
    expect(testCatalog.search(query, 10)[0]).toEqual({ id: 'andromeda', name: 'M 31', commonName: 'Andromeda Galaxy', type: 'Gx', constellation: 'Andromeda' })
  })

  it("finds a target by part of any of its names, or by a catalog's full name before its number", () => {
    expect(testCatalog.search('horsehead', 10).map(found => found.id)).toEqual(['horsehead'])
    expect(testCatalog.search('barnard 33', 10).map(found => found.id)).toEqual(['horsehead'])
    expect(testCatalog.search('Messier 33', 10).map(found => found.id)).toEqual(['triangulum'])
    expect(testCatalog.search('messier', 10)).toEqual([])
    expect(testCatalog.search('great orion', 10).map(found => found.id)).toEqual(['orion'])
  })

  it('lists an exact match before names that only start with the text', () => {
    expect(testCatalog.search('m3', 10).map(found => found.id)).toEqual(['m3', 'andromeda', 'triangulum'])
  })

  it('lists the target that goes by a name before one that only also has it', () => {
    expect(testCatalog.search('pinwheel galaxy', 10).map(found => found.id)).toEqual(['pinwheel', 'triangulum'])
  })

  it('stops at the number of results asked for', () => {
    expect(testCatalog.search('ngc', 7)).toHaveLength(7)
    expect(testCatalog.search('ngc', 3)).toHaveLength(3)
  })

  it('finds nothing for text that is empty or matches no name', () => {
    expect(testCatalog.search('', 10)).toEqual([])
    expect(testCatalog.search('  - ', 10)).toEqual([])
    expect(testCatalog.search('zzzzqqq', 10)).toEqual([])
  })

  it('finds a target by id', () => {
    expect(testCatalog.find('andromeda')?.name).toBe('M 31')
    expect(testCatalog.find('nope')).toBeUndefined()
  })
})

describe('the catalog database', () => {
  const settingsOf = (database: string) => Layer.succeed(CatalogSettings, { database, sameObjectArcseconds: 5 })
  const folder = () => mkdtempSync(join(tmpdir(), 'vela-catalog-'))

  it('is read into a catalog of its named targets', async () => {
    const objectsText = [objectLine({ dso: '1', ra: '314.75', dec: '44.33', type: 'HII', majorAxis: '120', ngc: '7000', c: '20' }), objectLine({ dso: '2', ra: '1', dec: '2', type: 'G' })].join('\n')
    const settings = settingsOf(join(folder(), 'catalog.sqlite'))

    const catalog = await Effect.runPromise(
      Effect.gen(function* () {
        const objects = yield* readObjects(objectsText)
        const names = yield* readNames(nameLine('NGC', '7000', 'North America Nebula', 'WK'))

        yield* writeCatalog({ pulled: [{ source: stellarium, pulledAt: '2026-01-01T00:00:00.000Z', files: [] }], stellarium: { objects, names }, openNgc: { objects: [], placed: [], names: [] } })

        return yield* readCatalog
      }).pipe(Effect.provide(settings)),
    )

    expect(catalog.search('north america', 5)).toEqual([{ id: 'stellarium-1', name: 'NGC 7000', commonName: 'North America Nebula', type: 'HII', constellation: 'Cygnus' }])
    expect(catalog.search('c 20', 5).map(found => found.id)).toEqual(['stellarium-1'])
    expect(catalog.find('stellarium-1')).toMatchObject({ raDegrees: 314.75, decDegrees: 44.33, majorAxisArcminutes: 120, minorAxisArcminutes: null })
    expect(catalog.find('stellarium-2')).toBeUndefined()
  })

  it('that is missing is reported with its path', async () => {
    const database = join(folder(), 'absent.sqlite')
    const result = await Effect.runPromise(Effect.result(readCatalog).pipe(Effect.provide(settingsOf(database))))

    expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'CatalogUnreadable', database } })
  })
})
