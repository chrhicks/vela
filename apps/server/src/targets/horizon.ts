import { chmod, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { HorizonStatus, HorizonWindow } from '@vela/model/web'

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

const isMissingFile = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

export function horizonFilePath(directory: string, rigId: string): string | null {
  return rigIdPattern.test(rigId) ? join(directory, `horizon-${rigId}.json`) : null
}

/** Atomic and private: the skyline is site data. */
export async function writeHorizonProfile(path: string, profile: HorizonProfile) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`

  await writeFile(temporary, `${JSON.stringify(horizonProfileSchema.parse(profile))}\n`, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
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

/** A profile never says `clear` for an untraced bin, and its absence says nothing. */
export function horizonStatus(
  profile: HorizonProfile | null,
  azimuthDegrees: number,
  altitudeDegrees: number,
): HorizonStatus | null {
  if (!profile) return null
  const bins = profile.altitudesDegrees.length
  const azimuth = ((azimuthDegrees % 360) + 360) % 360
  const skyline = profile.altitudesDegrees[Math.min(bins - 1, Math.floor(azimuth / profile.stepDegrees))]!

  if (skyline === null) return 'unknown'

  return altitudeDegrees <= skyline ? 'behind' : 'clear'
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
