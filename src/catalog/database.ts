import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Context, Data, Effect, Schema } from 'effect'
import { described } from '../config.ts'
import type { PulledFile, Source } from './sources.ts'
import { nameColumns, type StellariumName } from './stellarium/names.ts'
import { objectColumns, type StellariumObject } from './stellarium/objects.ts'
import { stellariumTables } from './stellarium/tables.ts'
import type { OtherName, Placed } from './openngc/derive.ts'
import { objectColumns as openNgcColumns, type OpenNgcObject } from './openngc/objects.ts'
import { openNgcTables, otherNameColumns, placedColumns } from './openngc/tables.ts'

export const CatalogConfig = Schema.Struct({
  database: described('The SQLite file the catalog setup writes and Vela reads targets from', Schema.String, '/mnt/storage/vela/catalog.sqlite'),
  sameObjectArcseconds: described('How near, in arcseconds, an object of a second source must lie to one already in the catalog to be taken as the same object under another name', Schema.Number, 5),
})

export class CatalogSettings extends Context.Service<CatalogSettings, typeof CatalogConfig.Type>()('vela/CatalogSettings') {}

export class CatalogUnwritable extends Data.TaggedError('CatalogUnwritable')<{ readonly database: string; readonly reason: string }> {}

export interface Pulled {
  readonly source: Source
  readonly pulledAt: string
  readonly files: ReadonlyArray<PulledFile>
}

export interface CatalogContents {
  readonly pulled: ReadonlyArray<Pulled>
  readonly stellarium: { readonly objects: ReadonlyArray<StellariumObject>; readonly names: ReadonlyArray<StellariumName> }
  readonly openNgc: { readonly objects: ReadonlyArray<OpenNgcObject>; readonly placed: ReadonlyArray<Placed>; readonly names: ReadonlyArray<OtherName> }
}

const catalogTables = `
CREATE TABLE sources (id TEXT PRIMARY KEY, name, authors, version, homepage, license, pulledAt);

CREATE TABLE source_files (source REFERENCES sources (id), name, address, bytes, sha256);

CREATE VIEW targets AS
SELECT id, source, name, commonName, nameCitations, inHydrogenRegionCatalog, type, raDegrees, decDegrees, majorAxisArcminutes, minorAxisArcminutes, vMagnitude, bMagnitude FROM stellarium_targets
UNION ALL
SELECT id, source, name, commonName, nameCitations, inHydrogenRegionCatalog, type, raDegrees, decDegrees, majorAxisArcminutes, minorAxisArcminutes, vMagnitude, bMagnitude FROM openngc_targets;

CREATE VIEW target_names AS
SELECT target, name, common, place FROM stellarium_target_names
UNION ALL
SELECT target, name, common, place FROM openngc_target_names;
`

function insertAll(database: DatabaseSync, table: string, columns: ReadonlyArray<string>, rows: ReadonlyArray<Readonly<Record<string, SQLInputValue>>>) {
  const insert = database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)

  for (const row of rows) insert.run(...columns.map(column => row[column] ?? null))
}

function write(path: string, contents: CatalogContents) {
  const database = new DatabaseSync(path)

  try {
    database.exec('BEGIN')
    database.exec(stellariumTables)
    database.exec(openNgcTables)
    database.exec(catalogTables)
    insertAll(database, 'sources', ['id', 'name', 'authors', 'version', 'homepage', 'license', 'pulledAt'], contents.pulled.map(({ source, pulledAt }) => ({ id: source.id, name: source.name, authors: source.authors, version: source.version, homepage: source.homepage, license: source.license, pulledAt })))
    insertAll(database, 'source_files', ['source', 'name', 'address', 'bytes', 'sha256'], contents.pulled.flatMap(({ source, files }) => files.map(file => ({ source: source.id, name: file.name, address: file.address, bytes: file.bytes, sha256: file.sha256 }))))
    insertAll(database, 'stellarium_objects', objectColumns, contents.stellarium.objects)
    insertAll(database, 'stellarium_names', nameColumns, contents.stellarium.names)
    insertAll(database, 'openngc_objects', openNgcColumns, contents.openNgc.objects)
    insertAll(database, 'openngc_placed', placedColumns, contents.openNgc.placed)
    insertAll(database, 'openngc_names', otherNameColumns, contents.openNgc.names)
    database.exec('COMMIT')
  } finally {
    database.close()
  }
}

export const writeCatalog = (contents: CatalogContents) =>
  Effect.gen(function* () {
    const { database } = yield* CatalogSettings
    const unfinished = `${database}.part`

    yield* Effect.try({
      try: () => {
        mkdirSync(dirname(database), { recursive: true })
        rmSync(unfinished, { force: true })
        write(unfinished, contents)
        renameSync(unfinished, database)
      },
      catch: cause => new CatalogUnwritable({ database, reason: cause instanceof Error ? cause.message : String(cause) }),
    })

    return database
  })
