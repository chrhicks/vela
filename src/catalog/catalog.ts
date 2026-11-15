import { DatabaseSync } from 'node:sqlite'
import { Constellation } from 'astronomy-engine'
import { Data, Effect, Schema } from 'effect'
import { CatalogSettings } from './database.ts'
import { positionTarget } from './position.ts'
import type { TargetSummary } from '../../state/targets.ts'
import { CatalogTarget, TargetName } from './types.ts'

export interface Catalog {
  readonly search: (text: string, limit: number) => ReadonlyArray<TargetSummary>
  readonly find: (id: string) => CatalogTarget | undefined
  readonly mostCited: ReadonlyArray<CatalogTarget>
  readonly size: number
  readonly namesOf: (target: CatalogTarget) => ReadonlyArray<string>
}

export class CatalogUnreadable extends Data.TaggedError('CatalogUnreadable')<{ readonly database: string; readonly reason: string }> {}

interface Entry {
  readonly target: CatalogTarget
  readonly ownKeys: ReadonlyArray<string>
  readonly otherKeys: ReadonlyArray<string>
}

interface Match {
  readonly rank: number
  readonly own: boolean
  readonly length: number
}

export const normalised = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/([a-z])0+(?=\d)/g, '$1')

const rankOf = (key: string, query: string) => (key === query ? 0 : key.startsWith(query) ? 1 : key.includes(query) ? 2 : undefined)

const better = (a: Match, b: Match) => a.rank - b.rank || Number(b.own) - Number(a.own) || a.length - b.length

function matchesOf(keys: ReadonlyArray<string>, own: boolean, query: string): ReadonlyArray<Match> {
  return keys.flatMap(key => {
    const rank = rankOf(key, query)

    return rank === undefined ? [] : [{ rank, own, length: key.length }]
  })
}

function bestMatch({ ownKeys, otherKeys }: Entry, query: string): Match | undefined {
  return [...matchesOf(ownKeys, true, query), ...matchesOf(otherKeys, false, query)].sort(better)[0]
}

const constellationSpellings: Readonly<Record<string, string>> = {
  Antila: 'Antlia',
  Bootes: 'Boötes',
  Camelopardis: 'Camelopardalis',
  'Pisces Austrinus': 'Piscis Austrinus',
}

function constellationOf({ raDegrees, decDegrees }: CatalogTarget) {
  const { name } = Constellation(raDegrees / 15, decDegrees)

  return constellationSpellings[name] ?? name
}

export const summaryOf = (target: CatalogTarget, constellation: string | null): TargetSummary => ({ id: target.id, name: target.name, commonName: target.commonName, type: target.type, constellation })

export const summarised = (target: CatalogTarget): TargetSummary => summaryOf(target, constellationOf(target))

export function catalogOf(targets: ReadonlyArray<CatalogTarget>, names: ReadonlyArray<TargetName>): Catalog {
  const byId = new Map<string, CatalogTarget>(targets.map(target => [target.id, target]))
  const namesOf = new Map<string, Array<string>>()

  for (const { target, name } of names) namesOf.set(target, [...(namesOf.get(target) ?? []), name])

  const entries = targets.map((target): Entry => {
    const ownKeys = [target.name, ...(target.commonName === null ? [] : [target.commonName])].map(normalised)
    const otherKeys = (namesOf.get(target.id) ?? []).map(normalised).filter(key => !ownKeys.includes(key))

    return { target, ownKeys, otherKeys: [...new Set(otherKeys)] }
  })

  return {
    mostCited: targets.filter(target => target.nameCitations > 0).sort((a, b) => b.nameCitations - a.nameCitations || a.id.localeCompare(b.id)),

    size: targets.length,

    find: id => byId.get(id) ?? positionTarget(id),

    namesOf: target => namesOf.get(target.id) ?? [],

    search: (text, limit) => {
      const position = positionTarget(text)

      if (position !== undefined) return [summaryOf(position, null)]

      const query = normalised(text)

      if (query === '') return []

      return entries
        .flatMap(entry => {
          const match = bestMatch(entry, query)

          return match === undefined ? [] : [{ target: entry.target, match }]
        })
        .sort((a, b) => better(a.match, b.match) || a.target.id.localeCompare(b.target.id))
        .slice(0, limit)
        .map(({ target }) => summarised(target))
    },
  }
}

const decodeTargets = Schema.decodeUnknownEffect(Schema.Array(CatalogTarget))
const decodeNames = Schema.decodeUnknownEffect(Schema.Array(TargetName))

export const readCatalog = Effect.gen(function* () {
  const { database } = yield* CatalogSettings
  const unreadable = (reason: string) => new CatalogUnreadable({ database, reason })

  const rows = yield* Effect.try({
    try: () => {
      const opened = new DatabaseSync(database, { readOnly: true })

      try {
        return {
          targets: opened.prepare('SELECT id, name, commonName, type, raDegrees, decDegrees, majorAxisArcminutes, minorAxisArcminutes, nameCitations, inHydrogenRegionCatalog FROM targets WHERE name IS NOT NULL').all(),
          names: opened.prepare('SELECT target, name FROM target_names ORDER BY target, common, place').all(),
        }
      } finally {
        opened.close()
      }
    },
    catch: cause => unreadable(cause instanceof Error ? cause.message : String(cause)),
  })

  const targets = yield* decodeTargets(rows.targets).pipe(Effect.mapError(error => unreadable(error.message)))
  const names = yield* decodeNames(rows.names).pipe(Effect.mapError(error => unreadable(error.message)))

  return catalogOf(targets, names)
})
