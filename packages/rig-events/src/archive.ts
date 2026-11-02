import { decodeLine } from './codec.ts'
import type { RigEvent } from './event.ts'
import type { Kind } from './registry.ts'

export interface ArchiveRange {
  readonly from: number
  readonly to: number
  readonly kinds?: readonly Kind[]
}

/** Inclusive event-time range. Keep one reader for the entire replay to deduplicate redeliveries. */
export function createArchiveReader(range: ArchiveRange) {
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from > range.to)
    throw new Error('Invalid archive time range')

  const seen = new Set<RigEvent['id']>()

  return {
    read(line: string): RigEvent | null {
      const decoded = decodeLine(line)

      if (!decoded.ok) throw new Error('Invalid archive envelope')
      const event = decoded.event

      if (event.at < range.from || event.at > range.to || (range.kinds && !range.kinds.includes(event.kind))) return null

      if (seen.has(event.id)) return null
      seen.add(event.id)

      return event
    },
  }
}
