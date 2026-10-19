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

export async function loadAlertsConfiguration(path: string | undefined): Promise<AlertsConfiguration> {
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

  const parsed = configurationSchema.safeParse(input)

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
