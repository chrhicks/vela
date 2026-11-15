import { Clock, Effect, Layer } from 'effect'
import { CatalogSettings, writeCatalog } from '../catalog/database.ts'
import { pullFile } from '../catalog/sources.ts'
import { readNames } from '../catalog/stellarium/names.ts'
import { readObjects } from '../catalog/stellarium/objects.ts'
import { namesFile, objectsFile, stellarium } from '../catalog/stellarium/source.ts'
import { namesOf, placeObjects } from '../catalog/openngc/derive.ts'
import { readObjects as readOpenNgcObjects } from '../catalog/openngc/objects.ts'
import { objectsFile as openNgcObjectsFile, openNgc } from '../catalog/openngc/source.ts'
import { readConfig } from '../config.ts'
import { runHandledPromise } from '../edge.ts'
import { VelaSettings } from '../settings.ts'

const settings = readConfig(VelaSettings, process.argv[2])

const setup = Effect.gen(function* () {
  const { sameObjectArcseconds } = yield* CatalogSettings
  const objectsText = yield* pullFile(stellarium, objectsFile)
  const namesText = yield* pullFile(stellarium, namesFile)
  const openNgcText = yield* pullFile(openNgc, openNgcObjectsFile)
  const pulledAt = new Date(yield* Clock.currentTimeMillis).toISOString()
  const objects = yield* readObjects(objectsText.text)
  const names = yield* readNames(namesText.text)
  const openNgcObjects = yield* readOpenNgcObjects(openNgcText.text)
  const placed = yield* placeObjects(openNgcObjects, objects, sameObjectArcseconds)
  const kept = new Set(placed.map(({ name }) => name))
  const added = placed.filter(({ stellariumDso }) => stellariumDso === null).length

  const database = yield* writeCatalog({
    pulled: [
      { source: stellarium, pulledAt, files: [objectsText, namesText] },
      { source: openNgc, pulledAt, files: [openNgcText] },
    ],
    stellarium: { objects, names },
    openNgc: { objects: openNgcObjects, placed, names: openNgcObjects.filter(({ name }) => kept.has(name)).flatMap(namesOf) },
  })

  return `catalog: ${objects.length} objects and ${names.length} names from ${stellarium.name} ${stellarium.version}; ${added} more objects and names for ${placed.length - added} from ${openNgc.name}; written to ${database}`
})

const failed = (reason: string) =>
  Effect.sync(() => {
    console.error(`catalog: ${reason}`)
    process.exitCode = 1
  })

await runHandledPromise(
  setup.pipe(
    Effect.provide(Layer.succeed(CatalogSettings, settings.catalog)),
    Effect.flatMap(done => Effect.sync(() => console.log(done))),
    Effect.catchTags({
      SourceUnreachable: ({ address, reason }) => failed(`could not download ${address}: ${reason}`),
      SourceUnreadable: ({ source, file, line, reason }) => failed(`${source} ${file} line ${line}: ${reason}`),
      CatalogUnwritable: ({ database, reason }) => failed(`could not write ${database}: ${reason}`),
    }),
  ),
)
