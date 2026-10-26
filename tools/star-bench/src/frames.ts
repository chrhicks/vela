import { readdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'

const frameTypes = ['light', 'dark', 'flat', 'dark-flat', 'bias'] as const

/** What Vela recorded when it first measured the frame. */
export interface RecordedStatistics {
  detectedStars: number
  medianHfrPixels: number | null
}

/** One saved frame, read from its `metadata.json`. The pixels stay on disk until measured. */
export interface SavedFrame {
  id: string
  directory: string
  capturedAt: number
  frameType: (typeof frameTypes)[number]
  target: string | null
  exposureSeconds: number
  recorded: RecordedStatistics | null
}

/** A directory the bench could not use. It is reported, never counted as a frame. */
export interface SkippedDirectory {
  directory: string
  reason: string
}

export interface FrameCatalog {
  frames: SavedFrame[]
  skipped: SkippedDirectory[]
}

const metadataSchema = z.object({
  id: z.string(),
  capturedAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
  frameType: z.enum(frameTypes).default('light'),
  subject: z.object({ name: z.string() }).nullable().optional(),
  exposureSeconds: z.number().nonnegative(),
  statistics: z
    .object({
      detectedStars: z.number().int().nonnegative(),
      medianHfrPixels: z.number().nonnegative().nullable(),
    })
    .nullable(),
})

/** Reads `<root>/<rig>/<frame>/metadata.json`, the layout of Vela's saved-images store. */
export async function readCatalog(root: string): Promise<FrameCatalog> {
  const frames: SavedFrame[] = []
  const skipped: SkippedDirectory[] = []

  for (const rig of await subdirectories(await realpath(root))) {
    for (const directory of await subdirectories(rig)) {
      const frame = await readFrame(directory)

      if (frame.status === 'read') frames.push(frame.frame)
      else skipped.push({ directory, reason: frame.reason })
    }
  }

  frames.sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id))

  return { frames, skipped }
}

/**
 * The frames named in a list file, one path per line (the first tab-separated field), each a frame
 * directory or its `original.fits`. A listed frame the catalog lacks is an error, so a pinned set
 * cannot shrink unnoticed.
 */
export async function selectListedFrames(catalog: FrameCatalog, listFile: string) {
  const byDirectory = new Map(catalog.frames.map(frame => [frame.directory, frame]))
  const frames: SavedFrame[] = []
  const missing: string[] = []

  for (const line of (await readFile(listFile, 'utf8')).split('\n')) {
    const path = line.split('\t')[0]!.trim()

    if (!path) continue
    const directory = basename(path) === 'original.fits' ? dirname(path) : path
    const frame = byDirectory.get(await realpath(directory).catch(() => resolve(directory)))

    if (frame) frames.push(frame)
    else missing.push(path)
  }

  if (missing.length)
    throw new Error(`${missing.length} listed frames are not in the saved images, first: ${missing[0]}`)

  return frames
}

async function readFrame(directory: string) {
  let document: unknown

  try {
    document = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'))
  } catch {
    return { status: 'skipped', reason: 'no readable metadata.json' } as const
  }

  const parsed = metadataSchema.safeParse(document)

  if (!parsed.success) return { status: 'skipped', reason: 'metadata.json is not a saved image' } as const
  const metadata = parsed.data

  const frame: SavedFrame = {
    id: metadata.id,
    directory,
    capturedAt: Date.parse(metadata.capturedAt),
    frameType: metadata.frameType,
    target: metadata.subject?.name ?? null,
    exposureSeconds: metadata.exposureSeconds,
    recorded: metadata.statistics,
  }

  return { status: 'read', frame } as const
}

async function subdirectories(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true })

  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => join(directory, entry.name))
    .sort()
}
