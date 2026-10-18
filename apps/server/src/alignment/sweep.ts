import type { TelescopeStatus } from '@vela/equipment'

type Rates = Pick<TelescopeStatus, 'primaryAxisRates'>

/** The baseline geometry, not mount facts: one RA step of about 57° with a 54–60° corridor. */
export const SWEEP_TARGET_DEGREES = 57

export const SWEEP_MINIMUM_DEGREES = 54

export const SWEEP_MAXIMUM_DEGREES = 60

/** Cria times a rotate out at 120 s; a leg stays under it. Settable per rig. */
export const DEFAULT_MAX_LEG_SECONDS = 100

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
