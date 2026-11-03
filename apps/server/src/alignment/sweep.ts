import type { TelescopeStatus } from '@vela/equipment'

type Rates = Pick<TelescopeStatus, 'primaryAxisRates'>

/** The sweep geometry, not mount facts: six positions, five RA steps of about 22.8° (114° in all) with a 21.6–24° corridor each. */
export const SWEEP_POSITIONS = 6

export const SWEEP_TARGET_DEGREES = 22.8

export const SWEEP_MINIMUM_DEGREES = 21.6

export const SWEEP_MAXIMUM_DEGREES = 24

/** Cria times a rotate out at 120 s; a leg stays under it. Settable per rig. */
export const DEFAULT_MAX_LEG_SECONDS = 100

/** Extra legs allowed after the planned ones, for the remaining distance each. */
export const MAX_CORRECTION_LEGS = 2

/** A correction follows only a leg that moved at least this far west. A mount that did not move, or moved the wrong way, gets no more legs. */
export const MINIMUM_LEG_PROGRESS_DEGREES = 0.1

/** A correction shorter than this is sent at the slowest move rate, so the stop lead at the sweep rate cannot eat it. */
export const SLOW_CORRECTION_BELOW_DEGREES = 3

/** Below this a rate is a creep (sidereal or guide speed), not one to move the axis at. */
const MOVE_RATE_MINIMUM = 0.1

/** Cria and the ASCOM drivers only accept an advertised rate, within this fraction. */
const RATE_MATCH = 0.01

/** The rate the old single-command sweep used, kept as the default where the mount has it. */
const PREFERRED_RATE = 1

function advertised(mount: Rates) {
  return mount.primaryAxisRates
    ?.map(rate => Math.abs(rate.degreesPerSecond))
    .filter(rate => rate > 0)
    .sort((a, b) => a - b)
}

/**
 * The sweep rate in °/s. A configured rate must be one the mount advertises.
 * Without one: the fastest advertised rate at or below 1°/s, else the slowest.
 * A mount that advertises no rates takes the configured rate, else 1°/s.
 */
export function chooseSweepRate(mount: Rates, configured?: number): number {
  const rates = advertised(mount)

  if (!rates) return configured ?? PREFERRED_RATE

  if (!rates.length) throw new Error('The mount reports no supported primary axis rate')

  if (configured !== undefined) {
    const match = rates.find(rate => Math.abs(rate - configured) <= configured * RATE_MATCH)

    if (match === undefined)
      throw new Error(
        `The configured sweep rate ${configured}°/s is not one the mount advertises (${rates.map(rate => `${rate}°/s`).join(', ')}).`,
      )

    return match
  }

  const usable = rates.filter(rate => rate <= PREFERRED_RATE * (1 + RATE_MATCH))

  return usable.at(-1) ?? rates[0]!
}

/** The slowest advertised rate that still moves the axis, never faster than the sweep rate. */
export function slowMoveRate(mount: Rates, sweepRate: number): number {
  const slowest = advertised(mount)?.find(rate => rate >= MOVE_RATE_MINIMUM)

  return slowest === undefined ? sweepRate : Math.min(slowest, sweepRate)
}

/** The rate nearest `preferred` among those the mount advertises, for a short direction probe. */
export function nearestAdvertisedRate(mount: Rates, preferred: number): number {
  const rates = advertised(mount)

  if (!rates) return preferred

  if (!rates.length) throw new Error('The mount reports no supported primary axis rate')

  return rates.reduce((closest, rate) =>
    Math.abs(rate - preferred) < Math.abs(closest - preferred) ? rate : closest,
  )
}

/** How many consecutive rotates cover `distanceDegrees` with none lasting over `maxLegSeconds`. */
export function legCount(distanceDegrees: number, rateDegreesPerSecond: number, maxLegSeconds: number): number {
  return Math.max(1, Math.ceil(distanceDegrees / (rateDegreesPerSecond * maxLegSeconds)))
}
