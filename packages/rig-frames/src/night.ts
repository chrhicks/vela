import type { EpochMs } from '@vela/rig-events'

const halfDayMs = 43_200_000

/**
 * The observing night an instant belongs to, named for the local date on which the night starts. A night
 * runs from local noon to local noon, so an evening session and the small hours after midnight share one name.
 * `utcOffsetMinutes` is the site's offset from UTC; this package never knows the site, so the caller passes it.
 */
export function nightOf(at: EpochMs, utcOffsetMinutes: number): string {
  return new Date(at + utcOffsetMinutes * 60_000 - halfDayMs).toISOString().slice(0, 10)
}
