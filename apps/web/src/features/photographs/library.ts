import type { SavedImage } from '@vela/model/web'
import { photographDate } from './format'

export type PhotographBrowse = 'nights' | 'targets'

export interface PhotographGroup {
  id: string
  title: string
  images: SavedImage[]
}

/** A night begins at local noon; use calendar arithmetic, not elapsed hours across DST. */
export function photographNight(timestamp: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))

  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)!.value)

  const date = new Date(Date.UTC(value('year'), value('month') - 1, value('day')))

  if (value('hour') < 12) date.setUTCDate(date.getUTCDate() - 1)

  return date.toISOString().slice(0, 10)
}

export function photographNightTitle(key: string) {
  return photographDate(`${key}T12:00:00Z`, true, 'UTC')
}

export function photographTarget(image: SavedImage) {
  return image.subject
    ? { id: `target:${image.subject.targetId}`, title: image.subject.name }
    : { id: 'unrecorded', title: 'No recorded target' }
}

/** Preserve the collection's server order within groups and for their first appearance. */
export function groupPhotographs(images: readonly SavedImage[], browse: PhotographBrowse, timeZone: string) {
  const groups = new Map<string, PhotographGroup>()

  for (const image of images) {
    const night = browse === 'nights' ? photographNight(image.capturedAt, timeZone) : null

    const { id, title } = night
      ? { id: night, title: photographNightTitle(night) }
      : photographTarget(image)

    let group = groups.get(id)

    if (!group) {
      group = { id, title, images: [] }
      groups.set(id, group)
    }

    group.images.push(image)
  }

  return [...groups.values()]
}
