import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { frameNamePattern, previewName, sidecarName, type Sidecar } from './keeper.ts'
import { nightPattern } from './night.ts'
import { makePreview, type PreviewSettings } from './preview.ts'

export interface FrameRow {
  readonly file: string
  readonly bytes: number
  readonly keptAt: string
}

export interface Frames {
  readonly night: string
  readonly frames: ReadonlyArray<FrameRow>
}

export async function listNight(keepDir: string, night: string): Promise<Frames> {
  const names = await readdir(join(keepDir, night)).catch(() => [])
  const rows: FrameRow[] = []

  for (const name of names) {
    if (!name.endsWith('.fits.json')) continue

    const sidecar = JSON.parse(await readFile(join(keepDir, night, name), 'utf8')) as Sidecar

    rows.push({ file: name.slice(0, -'.json'.length), bytes: sidecar.bytes, keptAt: sidecar.keptAt })
  }

  return { night, frames: rows.sort((a, b) => b.keptAt.localeCompare(a.keptAt) || b.file.localeCompare(a.file)) }
}

export function makePreviews(keepDir: string, settings: PreviewSettings) {
  const inFlight = new Map<string, Promise<Buffer>>()

  async function build(directory: string, file: string) {
    const cached = join(directory, previewName(file))

    try {
      return await readFile(cached)
    } catch {
      const png = makePreview(await readFile(join(directory, file)), settings)

      await writeFile(`${cached}.part`, png)
      await rename(`${cached}.part`, cached)

      return png
    }
  }

  return {
    async get(night: string, file: string): Promise<Buffer | undefined> {
      if (!nightPattern.test(night) || !frameNamePattern.test(file)) return undefined

      const directory = join(keepDir, night)
      const kept = await readFile(join(directory, sidecarName(file))).then(
        () => true,
        () => false,
      )

      if (!kept) return undefined

      const key = join(night, file)
      const pending = inFlight.get(key) ?? build(directory, file).finally(() => inFlight.delete(key))

      inFlight.set(key, pending)

      return pending
    },
  }
}
