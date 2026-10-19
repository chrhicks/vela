import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

const lineSchema = z.object({ blobs: z.array(z.string()).optional() })

/** The FITS file of each frame of a recording, in the order the camera sent them. */
export async function tapeFrames(recording: string): Promise<Buffer[]> {
  const lines = (await readFile(join(recording, 'traffic.jsonl'), 'utf8')).split('\n').filter(Boolean)
  const paths = lines.flatMap(line => lineSchema.parse(JSON.parse(line)).blobs ?? [])

  return Promise.all(paths.map(path => readFile(join(recording, path))))
}
