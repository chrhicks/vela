import { catalogRows } from './data.js'
import type { CatalogTarget } from './types.js'
export type { CatalogTarget } from './types.js'

// Normalize catalog spacing and zero padding without conflating unrelated names.
export function normalizeCatalogName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/^(ngc|ic|m|b)0+(?=\d)/, '$1')
}

const targets: readonly CatalogTarget[] = Object.freeze(catalogRows.map((row) => {
  const [id, catalogName, commonName, aliases, raDegrees, decDegrees, type,
    majorAxisArcminutes, minorAxisArcminutes] = row
  return Object.freeze({ id, catalogName, commonName, aliases: Object.freeze(aliases),
    raDegrees, decDegrees, type, majorAxisArcminutes, minorAxisArcminutes })
}))
const byId = new Map(targets.map((target) => [target.id, target]))
const searchEntries = targets.map((target) => ({
  target,
  keys: target.aliases.map(normalizeCatalogName),
}))

export function listTargets(): readonly CatalogTarget[] {
  return targets
}

export function getTarget(id: string): CatalogTarget | undefined {
  return byId.get(id.toLowerCase())
}

/** Exact names precede substring matches; ties retain stable catalog ID order. */
export function searchTargets(query: string, limit = 50): readonly CatalogTarget[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new RangeError('Target search limit must be an integer from 1 to 200')
  }
  const key = normalizeCatalogName(query)
  if (!key) return targets.slice(0, limit)
  const exact: CatalogTarget[] = []
  const partial: CatalogTarget[] = []
  for (const entry of searchEntries) {
    if (entry.keys.includes(key)) exact.push(entry.target)
    else if (entry.keys.some((alias) => alias.includes(key))) partial.push(entry.target)
  }
  return [...exact, ...partial].slice(0, limit)
}
