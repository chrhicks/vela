import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { defaultThresholds, thresholdsSchema } from './thresholds.js'
import type { AlertThresholds } from './thresholds.js'

export interface AlertsConfiguration {
  pushover: { token: string; user: string } | null
  thresholds: AlertThresholds
}

const configurationSchema = z.strictObject({
  pushover: z.strictObject({
    token: z.string().min(1),
    user: z.string().min(1)
  }).optional(),
  thresholds: thresholdsSchema.optional()
})

/**
 * `starsLowRatio` set the single-frame `stars-low` warning, which is gone. Files written while it
 * existed still carry it, and an unknown key would stop the server starting.
 */
const fileWithRemovedThresholds = z.looseObject({
  thresholds: z.looseObject({ starsLowRatio: z.unknown().optional() }).optional()
})

function withoutStarsLowRatio(file: z.infer<typeof fileWithRemovedThresholds>) {
  const { starsLowRatio: _removed, ...thresholds } = file.thresholds ?? {}

  return { ...file, thresholds }
}

export async function loadAlertsConfiguration(
  path: string | undefined,
  warn: (message: string) => void = console.warn
): Promise<AlertsConfiguration> {
  const defaults = { pushover: null, thresholds: defaultThresholds }

  if (path === undefined) return defaults

  let contents: string

  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return defaults
    throw error
  }

  let input: unknown

  try {
    input = JSON.parse(contents)
  } catch {
    throw new Error(`Invalid alerts configuration in ${path}: (root): Invalid JSON`)
  }

  const older = fileWithRemovedThresholds.safeParse(input)
  const removed = older.success && older.data.thresholds !== undefined && 'starsLowRatio' in older.data.thresholds

  if (removed) warn(`Ignoring thresholds.starsLowRatio in ${path}: the single-frame stars-low alert was replaced by stars-dropping (starsDropFraction, starsDropWindowMinutes). Delete the key.`)

  const parsed = configurationSchema.safeParse(removed ? withoutStarsLowRatio(older.data!) : input)

  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => {
      const message = issue.code === 'unrecognized_keys' ? 'Unrecognized keys' : issue.message

      return `${issue.path.join('.') || '(root)'}: ${message}`
    }).join('; ')

    throw new Error(`Invalid alerts configuration in ${path}: ${issues}`)
  }

  return {
    pushover: parsed.data.pushover ?? null,
    thresholds: parsed.data.thresholds ?? defaultThresholds
  }
}
