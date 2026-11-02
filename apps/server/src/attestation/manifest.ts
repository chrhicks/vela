import { z } from 'zod'

/** What a solve and a move depend on, by item. An item that could not be read is absent. */
export type Facts = Readonly<Record<string, string>>

export interface Manifest {
  readonly pinnedAt: string
  readonly items: Facts
}

export const manifestSchema = z.strictObject({ pinnedAt: z.string(), items: z.record(z.string(), z.string()) })

export type ItemStatus = 'match' | 'changed' | 'missing' | 'unpinned'

export interface ItemCheck {
  readonly item: string
  readonly status: ItemStatus
  readonly pinned: string | null
  readonly observed: string | null
}

const labels = new Map([
  ['astap', 'ASTAP binary'],
  ['catalog', 'Star catalog'],
  ['cria', 'Cria'],
  ['optics', 'Optics'],
])

/** Items pinned for one rig end in `/<rig id>`; the rest are shared by every rig. */
export function itemOf(kind: string, rigId?: string) {
  return rigId === undefined ? kind : `${kind}/${rigId}`
}

export function itemsForRig(checks: ReadonlyArray<ItemCheck>, rigId: string) {
  return checks.filter(({ item }) => !item.includes('/') || item.endsWith(`/${rigId}`))
}

/** No manifest means nothing is pinned yet, so every item is `unpinned` and none warns. */
export function compare(manifest: Manifest | undefined, observed: Facts): ItemCheck[] {
  const pinned = manifest?.items ?? {}
  const items = [...new Set([...Object.keys(pinned), ...Object.keys(observed)])].sort()

  return items.map(item => {
    const was = pinned[item] ?? null
    const now = observed[item] ?? null

    if (was === null) return { item, status: 'unpinned', pinned: null, observed: now }

    if (now === null) return { item, status: 'missing', pinned: was, observed: null }

    return { item, status: was === now ? 'match' : 'changed', pinned: was, observed: now }
  })
}

/** A mismatch is a warning and nothing more: `changed` and `missing` are the only statuses that warn. */
export function warningsOf(checks: ReadonlyArray<ItemCheck>, pinnedAt: string): string[] {
  return checks.flatMap(({ item, status }) => {
    const label = labels.get(item.split('/')[0] ?? '') ?? item

    if (status === 'changed') return [`${label} differs from what was pinned on ${pinnedAt.slice(0, 10)}.`]

    if (status === 'missing') return [`${label} was pinned on ${pinnedAt.slice(0, 10)} and could not be read now.`]

    return []
  })
}
