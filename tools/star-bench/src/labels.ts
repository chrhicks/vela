import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { frameAlertIds } from './alerts.ts'

const alertId = z.enum(frameAlertIds)

const time = z
  .string()
  .refine(value => Number.isFinite(Date.parse(value)), 'not a date')
  .transform(value => Date.parse(value))

const range = { from: time, to: time, note: z.string().min(1) }

const windowSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('healthy'), ...range }),
  z.strictObject({ kind: z.literal('event'), name: z.string().min(1), expect: z.array(alertId).min(1), ...range }),
  z.strictObject({ kind: z.literal('transition'), allow: z.array(alertId), ...range }),
])

const nightSchema = z
  .strictObject({
    night: z.string().min(1),
    target: z.string().min(1),
    exposureSeconds: z.number().positive(),
    /** Calibration nights pick a threshold. Held-out nights only check it. */
    use: z.enum(['calibration', 'holdout']),
    windows: z.array(windowSchema).min(1),
  })
  .superRefine((night, context) => {
    const ordered = night.windows.every((window, index) => window.from < window.to && (index === 0 || night.windows[index - 1]!.to <= window.from))

    if (!ordered) context.addIssue({ code: 'custom', message: 'windows must each start before they end and follow one another without overlap' })
  })

/**
 * What a person knows about a night, independent of the star counter. A `healthy` window must raise
 * nothing. An `event` window must raise every alert it expects, starting inside the window. A
 * `transition` window is neither: it permits the alerts it names and any other alert is a failure.
 */
export type NightLabels = z.infer<typeof nightSchema> & { file: string }

export type LabelWindow = NightLabels['windows'][number]

/** Reads every `*.json` in `directory`, oldest name first. A file that is not a valid label stops the run. */
export async function readLabels(directory: string): Promise<NightLabels[]> {
  const files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort()
  const nights: NightLabels[] = []

  for (const file of files) {
    const parsed = nightSchema.safeParse(JSON.parse(await readFile(join(directory, file), 'utf8')))

    if (!parsed.success) throw new Error(`${file}: ${parsed.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('; ')}`)
    nights.push({ ...parsed.data, file })
  }

  if (nights.length === 0) throw new Error(`no label files in ${directory}`)

  return nights
}
