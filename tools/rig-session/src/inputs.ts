import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

export interface Skipped {
  readonly where: string
  readonly reason: string
}

export interface ReadResult<Item> {
  readonly items: readonly Item[]
  readonly skipped: readonly Skipped[]
}

const jsonText = <Schema extends z.ZodType>(schema: Schema) =>
  z
    .string()
    .transform((text, context) => {
      try {
        return JSON.parse(text)
      } catch {
        context.addIssue('not JSON')

        return z.NEVER
      }
    })
    .pipe(schema)

const timestamp = z
  .string()
  .transform(text => new Date(text))
  .refine(date => !Number.isNaN(date.getTime()), 'not a timestamp')

const savedImageFile = z.object({
  id: z.string(),
  capturedAt: timestamp,
  capturedAtSource: z.enum(['camera', 'server-estimate']).default('camera'),
  receivedAt: timestamp,
  exposureSeconds: z.number(),
  width: z.int(),
  height: z.int(),
  cameraName: z.string(),
  rigId: z.string(),
  subject: z.object({ targetId: z.string(), name: z.string() }).nullish(),
  statistics: z.object({ detectedStars: z.int(), medianHfrPixels: z.number().nullable() }).nullish(),
})

export interface SavedImage {
  readonly id: string
  readonly capturedAt: Date
  readonly capturedAtSource: 'camera' | 'server-estimate'
  readonly receivedAt: Date
  readonly exposureSeconds: number
  readonly width: number
  readonly height: number
  readonly cameraName: string
  readonly rigId: string
  readonly targetId: string | null
  readonly targetName: string | null
  readonly detectedStars: number | null
  readonly medianHfrPixels: number | null
  readonly directory: string
}

/** Reads `<root>/<library>/<frame>/metadata.json`, the layout Vela's saved-images store writes. */
export async function readSavedImages(root: string): Promise<ReadResult<SavedImage>> {
  const items: SavedImage[] = []
  const skipped: Skipped[] = []

  for (const library of await readdir(root)) {
    for (const frame of await readdir(join(root, library))) {
      const directory = join(root, library, frame)
      const text = await readOptionalText(join(directory, 'metadata.json'))
      const parsed = jsonText(savedImageFile).safeParse(text)

      if (!parsed.success) {
        skipped.push({ where: directory, reason: z.prettifyError(parsed.error) })
        continue
      }

      const { subject, statistics, ...file } = parsed.data

      items.push({
        ...file,
        targetId: subject?.targetId ?? null,
        targetName: subject?.name ?? null,
        detectedStars: statistics?.detectedStars ?? null,
        medianHfrPixels: statistics?.medianHfrPixels ?? null,
        directory,
      })
    }
  }

  return { items, skipped }
}

const traceLine = z.object({
  type: z.literal('span'),
  name: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  startTime: timestamp,
  endTime: timestamp,
  durationMs: z.number(),
  status: z.object({ code: z.int() }),
  attributes: z.record(z.string(), z.json()),
})

const captureFrameAttributes = z.object({
  'capture.rig.id': z.string(),
  'capture.frame.index': z.int(),
  'capture.frame.outcome': z.string(),
})

export interface CaptureFrame {
  readonly rigId: string
  readonly index: number
  readonly outcome: string
}

export interface TraceSpan {
  readonly traceId: string
  readonly spanId: string
  readonly name: string
  readonly startedAt: Date
  readonly endedAt: Date
  readonly durationMs: number
  readonly statusCode: number
  readonly attributesJson: string
  /** Set on `capture.frame` spans: one span per exposure Vela attempted. */
  readonly captureFrame: CaptureFrame | null
}

/** Reads Vela's trace journal, one OpenTelemetry-style span per line. */
export async function readTraces(path: string): Promise<ReadResult<TraceSpan>> {
  const items: TraceSpan[] = []
  const skipped: Skipped[] = []
  const lines = (await readFile(path, 'utf8')).split('\n')

  lines.forEach((line, index) => {
    if (line.trim() === '') return

    const parsed = jsonText(traceLine).safeParse(line)

    if (!parsed.success) {
      skipped.push({ where: `${path}:${index + 1}`, reason: z.prettifyError(parsed.error) })

      return
    }

    const { startTime, endTime, status, attributes, ...span } = parsed.data
    const frame = captureFrameAttributes.safeParse(attributes)

    items.push({
      traceId: span.traceId,
      spanId: span.spanId,
      name: span.name,
      startedAt: startTime,
      endedAt: endTime,
      durationMs: span.durationMs,
      statusCode: status.code,
      attributesJson: JSON.stringify(attributes),
      captureFrame:
        span.name === 'capture.frame' && frame.success
          ? {
              rigId: frame.data['capture.rig.id'],
              index: frame.data['capture.frame.index'],
              outcome: frame.data['capture.frame.outcome'],
            }
          : null,
    })
  })

  return { items, skipped }
}

const frameRecordLine = z.object({
  version: z.literal(1),
  rigId: z.string(),
  runId: z.string(),
  attempt: z.int(),
  startedAt: timestamp,
  settledAt: timestamp,
  exposureSeconds: z.number(),
  outcome: z.enum(['saved', 'unsaved', 'save-failed', 'lost', 'failed', 'uncertain', 'stopped']),
  message: z.string().nullable(),
  provenance: z.object({ requestId: z.string(), operationId: z.string().nullable(), imageId: z.string().nullable() }).nullable(),
  image: z.object({ id: z.string() }).nullable(),
  statistics: z.object({ detectedStars: z.int(), medianHfrPixels: z.number().nullable() }).nullable(),
})

/** One settled capture attempt of Vela's, saved or not. The ids are Cria's, null when the adapter carried none. */
export interface FrameRecord {
  readonly rigId: string
  readonly runId: string
  readonly attempt: number
  readonly startedAt: Date
  readonly settledAt: Date
  readonly exposureSeconds: number
  readonly outcome: z.infer<typeof frameRecordLine>['outcome']
  readonly message: string | null
  readonly requestId: string | null
  readonly operationId: string | null
  readonly criaImageId: string | null
  /** The id Vela gave the image; it is the saved image's `id`. */
  readonly imageId: string | null
  readonly detectedStars: number | null
  readonly medianHfrPixels: number | null
}

/** Reads `frames.jsonl`. A record that repeats the run and attempt of an earlier one is skipped. */
export async function readFrameRecords(path: string): Promise<ReadResult<FrameRecord>> {
  const items: FrameRecord[] = []
  const skipped: Skipped[] = []
  const seen = new Set<string>()
  const lines = (await readFile(path, 'utf8')).split('\n')

  lines.forEach((line, index) => {
    if (line.trim() === '') return

    const where = `${path}:${index + 1}`
    const parsed = jsonText(frameRecordLine).safeParse(line)

    if (!parsed.success) return void skipped.push({ where, reason: z.prettifyError(parsed.error) })

    const { provenance, image, statistics, ...record } = parsed.data
    const key = `${record.runId}/${record.attempt}`

    if (seen.has(key)) return void skipped.push({ where, reason: 'repeats the run and attempt of an earlier record' })

    seen.add(key)

    items.push({
      rigId: record.rigId,
      runId: record.runId,
      attempt: record.attempt,
      startedAt: record.startedAt,
      settledAt: record.settledAt,
      exposureSeconds: record.exposureSeconds,
      outcome: record.outcome,
      message: record.message,
      requestId: provenance?.requestId ?? null,
      operationId: provenance?.operationId ?? null,
      criaImageId: provenance?.imageId ?? null,
      imageId: image?.id ?? null,
      detectedStars: statistics?.detectedStars ?? null,
      medianHfrPixels: statistics?.medianHfrPixels ?? null,
    })
  })

  return { items, skipped }
}

const flag = z.enum(['True', 'False']).transform(text => text === 'True')

const mountLine = z.object({
  utc: z.string().transform(text => new Date(`${text}Z`)).refine(date => !Number.isNaN(date.getTime()), 'not a timestamp'),
  ra_h: z.coerce.number(),
  dec_deg: z.coerce.number(),
  tracking: flag,
  slewing: flag,
  parked: flag,
  pier: z.enum(['east', 'west']),
  lst_h: z.coerce.number(),
  track_mode: z.string(),
})

export interface MountSample {
  readonly sampledAt: Date
  readonly raHours: number
  readonly decDegrees: number
  readonly lstHours: number
  readonly tracking: boolean
  readonly slewing: boolean
  readonly parked: boolean
  readonly pierSide: 'east' | 'west'
  readonly trackMode: string
}

/** Reads the observer's mount-watch CSV. Its fields are never quoted, so a comma always separates. */
export async function readMountCsv(path: string): Promise<ReadResult<MountSample>> {
  const items: MountSample[] = []
  const skipped: Skipped[] = []
  const [header = '', ...lines] = (await readFile(path, 'utf8')).split('\n')
  const columns = header.split(',')
  const seen = new Set<number>()

  lines.forEach((line, index) => {
    if (line.trim() === '') return

    const values = line.split(',')
    const parsed = mountLine.safeParse(Object.fromEntries(columns.map((column, at) => [column, values[at]])))

    if (!parsed.success) {
      skipped.push({ where: `${path}:${index + 2}`, reason: z.prettifyError(parsed.error) })

      return
    }

    const row = parsed.data
    const time = row.utc.getTime()

    if (seen.has(time)) {
      skipped.push({ where: `${path}:${index + 2}`, reason: 'repeats the time of an earlier sample' })

      return
    }

    seen.add(time)

    items.push({
      sampledAt: row.utc,
      raHours: row.ra_h,
      decDegrees: row.dec_deg,
      lstHours: row.lst_h,
      tracking: row.tracking,
      slewing: row.slewing,
      parked: row.parked,
      pierSide: row.pier,
      trackMode: row.track_mode,
    })
  })

  return { items, skipped }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}
