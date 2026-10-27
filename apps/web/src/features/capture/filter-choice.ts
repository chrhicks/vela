import type { RigFilter } from '@vela/model/web'

const key = (rigId: string) => `vela:capture-filter:v1:${rigId}`

/** The filter Chris last started a run with on this rig, as a name; null for None or nothing remembered. */
export function rememberedFilter(rigId: string): string | null {
  try {
    return localStorage.getItem(key(rigId))
  } catch {
    return null
  }
}

export function rememberFilter(rigId: string, name: string | null) {
  try {
    if (name === null) localStorage.removeItem(key(rigId))
    else localStorage.setItem(key(rigId), name)
  } catch {
    /* The choice is only a convenience; capture works when storage is full or disabled. */
  }
}

/** A remembered name the rig no longer lists is None: a filter Chris removed is not silently still in. */
export function listedFilter(name: string | null, filters: ReadonlyArray<RigFilter>): string | null {
  return filters.some(filter => filter.name === name) ? name : null
}

/** The dropdown's text for a filter: the name, then its description when it has one. */
export function filterLabel({ name, description }: RigFilter) {
  return description ? `${name} · ${description}` : name
}
