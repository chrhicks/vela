import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createAstapSolver, solveFile } from '@vela/rig-astap'
import type { SkyPosition, SolveBody } from '@vela/rig-events'
import type { SavedImage } from '@vela/rig-frames'

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')

    createReadStream(path)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

interface Entry {
  readonly sha256: string
  readonly solverVersion: string
  readonly fieldHeightDegrees: number
  readonly body: SolveBody
}

/** Solves are kept one file per pixel digest, so a rerun solves nothing again and `solveMs` keeps the value of the run that solved. */
export function solveCache(directory: string, solverVersion: string, fieldHeightDegrees: number) {
  const pathOf = (sha256: string) => join(directory, `${sha256}.json`)

  return {
    async read(sha256: string, image: SavedImage): Promise<SolveBody | undefined> {
      const entry: Entry | undefined = await readFile(pathOf(sha256), 'utf8').then(
        text => JSON.parse(text),
        () => undefined,
      )

      return entry?.sha256 === sha256 && entry.solverVersion === solverVersion && entry.fieldHeightDegrees === fieldHeightDegrees ? { ...entry.body, imageId: image.id } : undefined
    },
    async write(sha256: string, body: SolveBody): Promise<void> {
      const temporary = `${pathOf(sha256)}.${process.pid}.tmp`

      await mkdir(directory, { recursive: true })
      await writeFile(temporary, JSON.stringify({ sha256, solverVersion, fieldHeightDegrees, body } satisfies Entry))
      await rename(temporary, pathOf(sha256))
    },
  }
}

export interface SolveConfig {
  readonly executable: string
  readonly catalogPath: string
  readonly fieldHeightDegrees: number
  readonly solverVersion: string
  readonly timeoutMs: number
}

export async function solveImage(config: SolveConfig, image: SavedImage, hint: SkyPosition): Promise<SolveBody> {
  const solver = createAstapSolver({ executable: config.executable, catalogPath: config.catalogPath, fieldHeightDegrees: config.fieldHeightDegrees, timeoutMs: config.timeoutMs })

  return solveFile(solver, { imageId: image.id, hint, solverVersion: config.solverVersion }, image.fitsPath, AbortSignal.timeout(config.timeoutMs + 10_000))
}

/** Runs `work` over `items`, `jobs` at a time, and returns the results in the order of `items`. */
export async function inParallel<A, B>(items: readonly A[], jobs: number, work: (item: A, index: number) => Promise<B>): Promise<B[]> {
  const results: B[] = []
  let next = 0

  await Promise.all(
    Array.from({ length: Math.min(jobs, items.length) }, async () => {
      while (next < items.length) {
        const index = next++

        results[index] = await work(items[index]!, index)
      }
    }),
  )

  return results
}
