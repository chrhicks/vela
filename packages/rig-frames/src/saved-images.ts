import { Exit, Schema } from 'effect'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { FrameBody, ImageId, type EpochMs } from '@vela/rig-events'
import { reasonOf, type SourceProblem } from './jsonl.ts'
import { instantOf } from './times.ts'

export type FrameType = typeof FrameBody.Type.frameType

export type CapturedAtSource = 'camera' | 'server-estimate'

/** The part of an image's `metadata.json` that frame work needs. Everything else in the file is dropped on read. */
const Metadata = Schema.Struct({
  id: ImageId,
  rigId: Schema.String,
  frameType: Schema.optionalKey(FrameBody.fields.frameType),
  capturedAt: Schema.String,
  capturedAtSource: Schema.optionalKey(Schema.Literals(['camera', 'server-estimate'])),
  receivedAt: Schema.String,
  savedAt: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
  exposureSeconds: Schema.Number,
  filter: Schema.optionalKey(Schema.NullOr(Schema.String)),
})

const decodeMetadata = Schema.decodeUnknownExit(Metadata)

export interface SavedImage {
  readonly id: typeof ImageId.Type
  readonly rigId: string
  readonly frameType: FrameType
  readonly capturedAt: EpochMs
  readonly capturedAtSource: CapturedAtSource | null
  readonly receivedAt: EpochMs
  readonly savedAt: EpochMs
  readonly exposureSeconds: number
  readonly width: number
  readonly height: number
  readonly filter: string | null
  readonly fitsPath: string
  readonly fitsBytes: number
}

export interface SavedImages {
  readonly images: readonly SavedImage[]
  readonly problems: readonly SourceProblem[]
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

const digestName = /^[a-f0-9]{64}$/

async function directories(path: string, problems: SourceProblem[]): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })

    return entries.filter(entry => entry.isDirectory() && digestName.test(entry.name)).map(entry => entry.name).sort()
  } catch (error) {
    problems.push({ path, line: null, reason: reasonOf(error) })

    return []
  }
}

/**
 * Lists the images in Vela's saved-image store (`<root>/<sha256 of rig id>/<sha256 of image id>/`). It reads
 * `metadata.json` and the size of `original.fits` and nothing else, and it writes nothing. A directory that is not
 * a finished image (Vela's `.pending-*` while it saves) is not listed; a finished one that is damaged is a problem.
 */
export async function readSavedImages(root: string): Promise<SavedImages> {
  const images: SavedImage[] = []
  const problems: SourceProblem[] = []

  for (const rigDirectory of await directories(root, problems)) {
    for (const imageDirectory of await directories(join(root, rigDirectory), problems)) {
      const directory = join(root, rigDirectory, imageDirectory)
      const metadataPath = join(directory, 'metadata.json')
      const fitsPath = join(directory, 'original.fits')

      try {
        const metadata = decodeMetadata(JSON.parse(await readFile(metadataPath, 'utf8')))

        if (!Exit.isSuccess(metadata)) {
          problems.push({ path: metadataPath, line: null, reason: 'does not match the schema' })
          continue
        }

        const { id, rigId, capturedAt, receivedAt, savedAt } = metadata.value
        const instants = [capturedAt, receivedAt, savedAt].map(instantOf)

        if (sha256(id) !== imageDirectory || sha256(rigId) !== rigDirectory) {
          problems.push({ path: directory, line: null, reason: 'directory name does not match the metadata' })
          continue
        }

        const [capturedMs, receivedMs, savedMs] = instants

        if (capturedMs === undefined || receivedMs === undefined || savedMs === undefined) {
          problems.push({ path: metadataPath, line: null, reason: 'a timestamp is not an instant' })
          continue
        }

        images.push({
          id,
          rigId,
          frameType: metadata.value.frameType ?? 'light',
          capturedAt: capturedMs,
          capturedAtSource: metadata.value.capturedAtSource ?? null,
          receivedAt: receivedMs,
          savedAt: savedMs,
          exposureSeconds: metadata.value.exposureSeconds,
          width: metadata.value.width,
          height: metadata.value.height,
          filter: metadata.value.filter ?? null,
          fitsPath,
          fitsBytes: (await stat(fitsPath)).size,
        })
      } catch (error) {
        problems.push({ path: directory, line: null, reason: error instanceof SyntaxError ? 'not JSON' : reasonOf(error) })
      }
    }
  }

  return { images, problems }
}
