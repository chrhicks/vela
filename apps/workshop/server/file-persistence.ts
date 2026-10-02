import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DesignProfile, WorkingSession } from '@vela/ui/themes'

export async function writeJsonAtomic(path: string, value: WorkingSession | DesignProfile): Promise<void> {
  const contents = `${JSON.stringify(value, null, 2)}\n`
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`

  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}
