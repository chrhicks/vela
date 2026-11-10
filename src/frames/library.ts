import { open, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { headerCards, type Card } from './fits.ts'
import { frameNamePattern, previewName, sidecarName, type Sidecar } from './keeper.ts'
import { nightPattern } from './night.ts'
import { makePreview, type PreviewSettings } from './preview.ts'
import { statsName, type FrameStats } from './stats.ts'

export interface FrameRow {
  readonly file: string
  readonly bytes: number
  readonly keptAt: string
  readonly run: string | null
  readonly sequence: string | null
  readonly frame: number | null
  readonly stats: FrameStats | null
}

export interface FrameDetail extends FrameRow {
  readonly night: string
  readonly path: string
  readonly sha256: string
  readonly cards: ReadonlyArray<Card>
}

const blockBytes = 2880

export interface Frames {
  readonly night: string
  readonly frames: ReadonlyArray<FrameRow>
}

function rowOf(sidecar: Sidecar, stats: FrameStats | null) {
  return { bytes: sidecar.bytes, keptAt: sidecar.keptAt, run: sidecar.run ?? null, sequence: sidecar.sequence ?? null, frame: sidecar.frame ?? null, stats }
}

const statsOf = (directory: string, file: string) =>
  readFile(join(directory, statsName(file)), 'utf8').then(
    text => JSON.parse(text) as FrameStats,
    () => null,
  )

export async function readCards(path: string) {
  const file = await open(path)

  try {
    let read = Buffer.alloc(0)

    for (;;) {
      const block = Buffer.alloc(blockBytes)
      const { bytesRead } = await file.read(block, 0, blockBytes, read.length)

      if (bytesRead === 0) throw new Error('FITS header has no END card')

      read = Buffer.concat([read, block.subarray(0, bytesRead)])

      const cards = headerCards(read)

      if (cards !== undefined) return cards
    }
  } finally {
    await file.close()
  }
}

export async function frameDetail(keepDir: string, night: string, file: string): Promise<FrameDetail | undefined> {
  if (!nightPattern.test(night) || !frameNamePattern.test(file)) return undefined

  const directory = join(keepDir, night)
  const sidecar = await readFile(join(directory, sidecarName(file)), 'utf8').then(
    text => JSON.parse(text) as Sidecar,
    () => undefined,
  )

  if (sidecar === undefined) return undefined

  const path = join(directory, file)

  return { night, file, path, sha256: sidecar.sha256, ...rowOf(sidecar, await statsOf(directory, file)), cards: await readCards(path) }
}

export async function listNight(keepDir: string, night: string): Promise<Frames> {
  const names = await readdir(join(keepDir, night)).catch(() => [])
  const rows: FrameRow[] = []

  for (const name of names) {
    if (!name.endsWith('.fits.json')) continue

    const sidecar = JSON.parse(await readFile(join(keepDir, night, name), 'utf8')) as Sidecar
    const file = name.slice(0, -'.json'.length)

    rows.push({ file, ...rowOf(sidecar, await statsOf(join(keepDir, night), file)) })
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
