import { catalogRows } from './data.ts'
import { positionRow } from './position.ts'
import type { CatalogRow } from './types.ts'

export interface TargetSummary {
  readonly id: string
  readonly name: string
  readonly commonName: string | null
  readonly type: string
  readonly constellation: string | null
}

interface Entry {
  readonly row: CatalogRow
  readonly keys: ReadonlyArray<string>
}

export const normalised = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/([a-z])0+(?=\d)/g, '$1')

let entries: ReadonlyArray<Entry> | undefined

function index() {
  entries ??= catalogRows.map(row => ({ row, keys: [...new Set(row[3].map(normalised))] }))

  return entries
}

function rankOf(keys: ReadonlyArray<string>, query: string) {
  let best: { readonly rank: number; readonly length: number } | undefined

  for (const key of keys) {
    const rank = key === query ? 0 : key.startsWith(query) ? 1 : key.includes(query) ? 2 : undefined

    if (rank !== undefined && (best === undefined || rank < best.rank || (rank === best.rank && key.length < best.length))) best = { rank, length: key.length }
  }

  return best
}

export function summaryOf(row: CatalogRow): TargetSummary {
  return { id: row[0], name: row[1], commonName: row[2], type: row[6], constellation: row[9] }
}

export function findRow(id: string) {
  return catalogRows.find(row => row[0] === id) ?? positionRow(id)
}

export function searchCatalog(text: string, limit: number): ReadonlyArray<TargetSummary> {
  const position = positionRow(text)

  if (position !== undefined) return [summaryOf(position)]

  const query = normalised(text)

  if (query === '') return []

  return index()
    .flatMap(({ row, keys }) => {
      const best = rankOf(keys, query)

      return best === undefined ? [] : [{ row, ...best }]
    })
    .sort((a, b) => a.rank - b.rank || a.length - b.length || a.row[0].localeCompare(b.row[0]))
    .slice(0, limit)
    .map(({ row }) => summaryOf(row))
}
