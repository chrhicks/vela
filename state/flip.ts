import type { Mount } from './devices.ts'

const j2000 = Date.UTC(2000, 0, 1, 12)

const millisecondsPerDay = 86_400_000

const siderealSecondsPerSecond = 1.0027379093

const wrapHours = (hours: number) => ((hours % 24) + 24) % 24

export const greenwichSiderealHours = (at: number) => wrapHours(18.697374558 + 24.06570982441908 * ((at - j2000) / millisecondsPerDay))

export type Flip =
  | { readonly _tag: 'Unknown' }
  | { readonly _tag: 'NotTracking' }
  | { readonly _tag: 'NoneThisSide' }
  | { readonly _tag: 'In'; readonly seconds: number }
  | { readonly _tag: 'Past'; readonly seconds: number }

const unknown: Flip = { _tag: 'Unknown' }

export function flip(mount: Mount, at: number | undefined): Flip {
  const tracking = mount.TELESCOPE_TRACK_STATE?.values.TRACK_ON
  const ra = mount.EQUATORIAL_EOD_COORD?.values.RA
  const longitude = mount.GEOGRAPHIC_COORD?.values.LONG
  const limit = mount.MERIDIAN_LIMIT?.values.LIMIT

  if (tracking === undefined) return unknown
  if (!tracking) return { _tag: 'NotTracking' }
  if (mount.TELESCOPE_PIER_SIDE?.values.PIER_EAST === true) return { _tag: 'NoneThisSide' }
  if (at === undefined || ra === undefined || longitude === undefined || limit === undefined) return unknown

  const hourAngle = wrapHours(greenwichSiderealHours(at) + longitude / 15 - ra + 12) - 12
  const seconds = ((limit / 15 - hourAngle) * 3600) / siderealSecondsPerSecond

  return seconds >= 0 ? { _tag: 'In', seconds } : { _tag: 'Past', seconds: -seconds }
}
