import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { HorizonBinKind, HorizonStatus, HorizonWindow } from '@vela/model/web'
import { createObservationStore, type Observation, type ObservationStore } from './horizon-observations.js'
import { isMissingFile, writePrivateFile } from './private-file.js'

const sampleMinutes = 15

const rigIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Altitude of the skyline per azimuth bin; `null` is a bin the survey could not trace. */
export const horizonProfileSchema = z
  .strictObject({
    version: z.literal(1),
    approximate: z.literal(true),
    note: z.string(),
    importedAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
    offsets: z.strictObject({ azimuthDegrees: z.number().finite(), altitudeDegrees: z.number().finite() }),
    stepDegrees: z.number().positive().max(360),
    altitudesDegrees: z.array(z.number().min(0).max(90).nullable()).min(1),
  })
  .refine(profile => Math.abs(profile.altitudesDegrees.length * profile.stepDegrees - 360) < 1e-9, {
    message: 'bins must cover exactly 360 degrees',
  })

export type HorizonProfile = z.infer<typeof horizonProfileSchema>

/** `horizon-observations-<rigId>.json` would be this file for the rig named after the rest of that id. */
export function horizonFilePath(directory: string, rigId: string): string | null {
  return rigIdPattern.test(rigId) && !rigId.startsWith('observations-')
    ? join(directory, `horizon-${rigId}.json`)
    : null
}

export function writeHorizonProfile(path: string, profile: HorizonProfile) {
  return writePrivateFile(path, `${JSON.stringify(horizonProfileSchema.parse(profile))}\n`)
}

export interface HorizonStore {
  /** `null` when the rig has no usable profile. */
  forRig(rigId: string): Promise<HorizonProfile | null>
}

/** Reads on every call, so a re-import applies without a restart. An unusable file warns once per process, without values. */
export function createHorizonStore(
  directory: string,
  warn: (message: string) => void = message => console.warn(message),
): HorizonStore {
  const warned = new Set<string>()

  function ignore(rigId: string, reason: string) {
    const message = `Ignoring the horizon profile for rig ${rigId}: ${reason}.`

    if (!warned.has(message)) {
      warned.add(message)
      warn(message)
    }

    return null
  }

  return {
    async forRig(rigId) {
      const path = horizonFilePath(directory, rigId)

      if (!path) return null
      let text: string

      try {
        text = await readFile(path, 'utf8')
      } catch (error) {
        return isMissingFile(error) ? null : ignore(rigId, 'it could not be read')
      }

      try {
        return horizonProfileSchema.parse(JSON.parse(text))
      } catch {
        return ignore(rigId, 'it is not a valid profile')
      }
    },
  }
}

/**
 * The profile with the observed obstructions folded in: per azimuth bin, what the skyline is known
 * to be. Built at read time; the profile file is never rewritten.
 */
export interface Skyline {
  stepDegrees: number
  bins: SkylineBin[]
}

export type SkylineBin = { kind: 'traced' | 'observed'; altitudeDegrees: number } | { kind: 'unknown' }

/**
 * An observation says the skyline is at least that high in its bin. One that is higher than the traced
 * altitude, or lands in an untraced bin, makes the bin `observed` at the highest such altitude. No
 * profile means no skyline, even with observations: they refine a survey and do not replace one.
 */
export function skylineOf(
  profile: HorizonProfile | null,
  observations: ReadonlyArray<Pick<Observation, 'azimuthDegrees' | 'altitudeDegrees'>>,
): Skyline | null {
  if (!profile) return null

  const bins = profile.altitudesDegrees.map(
    (altitude): SkylineBin => (altitude === null ? { kind: 'unknown' } : { kind: 'traced', altitudeDegrees: altitude }),
  )

  for (const observation of observations) {
    const index = binIndex(bins.length, profile.stepDegrees, observation.azimuthDegrees)
    const bin = bins[index]!

    if (bin.kind === 'unknown' || observation.altitudeDegrees > bin.altitudeDegrees)
      bins[index] = { kind: 'observed', altitudeDegrees: observation.altitudeDegrees }
  }

  return { stepDegrees: profile.stepDegrees, bins }
}

function binIndex(bins: number, stepDegrees: number, azimuthDegrees: number) {
  const azimuth = ((azimuthDegrees % 360) + 360) % 360

  return Math.min(bins - 1, Math.floor(azimuth / stepDegrees))
}

function binAt(skyline: Skyline, azimuthDegrees: number) {
  return skyline.bins[binIndex(skyline.bins.length, skyline.stepDegrees, azimuthDegrees)]!
}

export function horizonBin(skyline: Skyline | null, azimuthDegrees: number): HorizonBinKind | null {
  return skyline ? binAt(skyline, azimuthDegrees).kind : null
}

/**
 * `behind` at or below a traced or observed altitude. Above a traced bin is `clear`; above an observed
 * bin the observation only proves the skyline is at least that high, so it is `unknown`, as is an
 * untraced bin. No skyline says nothing, never `clear`.
 */
export function horizonStatus(
  skyline: Skyline | null,
  azimuthDegrees: number,
  altitudeDegrees: number,
): HorizonStatus | null {
  if (!skyline) return null

  const bin = binAt(skyline, azimuthDegrees)

  if (bin.kind === 'unknown') return 'unknown'

  if (altitudeDegrees <= bin.altitudeDegrees) return 'behind'

  return bin.kind === 'observed' ? 'unknown' : 'clear'
}

export interface Horizon {
  /** The rig's skyline as it stands now; null when the rig has no usable profile. */
  skyline(rigId: string): Promise<Skyline | null>
  observations: ObservationStore
}

export function createHorizon(directory: string): Horizon {
  const profiles = createHorizonStore(directory)
  const observations = createObservationStore(directory)

  return {
    observations,
    async skyline(rigId) {
      const profile = await profiles.forRig(rigId)

      return profile && skylineOf(profile, await observations.list(rigId))
    },
  }
}

/** Counts the 15-minute sky samples inside a window; null when none falls in it. */
export function horizonInWindow(
  samples: ReadonlyArray<{ at: string; horizon: HorizonStatus | null }>,
  window: { startsAt: string; endsAt: string },
): HorizonWindow | null {
  const start = Date.parse(window.startsAt)
  const end = Date.parse(window.endsAt)
  const inside = samples.filter(sample => Date.parse(sample.at) >= start && Date.parse(sample.at) <= end)

  if (inside.length === 0 || inside.some(sample => sample.horizon === null)) return null

  const minutes = (status: HorizonStatus) =>
    inside.filter(sample => sample.horizon === status).length * sampleMinutes

  return {
    checkedMinutes: inside.length * sampleMinutes,
    behindMinutes: minutes('behind'),
    unknownMinutes: minutes('unknown'),
  }
}
