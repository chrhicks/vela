import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { epochMs, imageId, rigId, seal, sourceId } from '@vela/rig-events'
import { encodeCaptureFits } from '../imaging/fits.js'
import type { RunLog } from '../run-log/run-log.js'
import type { MonoFrame, SkyPosition, SolveResult } from './judged-solver.js'

// Rejected solves are rare; 5 GiB of 169 GB free on thuban's /home.
export const rejectedFrameLimit = 200

export const rejectedByteLimit = 5 * 1024 ** 3

export type RejectedSolve = Extract<SolveResult, { status: 'no-solution' }>

type FitsMetadata = Parameters<typeof encodeCaptureFits>[1]

export function createRejectedStore(directory: string) {
  let pending = Promise.resolve()

  return {
    write(frame: MonoFrame, metadata: FitsMetadata) {
      const work = pending.then(async () => {
        const fits = await encodeCaptureFits(frame, metadata)

        if (fits.length > rejectedByteLimit) throw new Error('Rejected FITS exceeds retention byte limit')
        await mkdir(directory, { recursive: true })
        const path = join(directory, `${Date.now()}-${randomUUID()}.fits`)
        await writeFile(path, fits, { flag: 'wx' })

        const files = await Promise.all((await readdir(directory, { withFileTypes: true }))
          .filter(entry => entry.isFile() && /^\d+-[0-9a-f-]+\.fits$/.test(entry.name))
          .map(async entry => ({ path: join(directory, entry.name), ...await stat(join(directory, entry.name)) })))

        files.sort((a, b) => a.mtimeMs - b.mtimeMs || Number(a.path === path) - Number(b.path === path) || a.path.localeCompare(b.path))
        let bytes = files.reduce((total, file) => total + file.size, 0)
        let count = files.length

        for (const file of files) {
          if (count <= rejectedFrameLimit && bytes <= rejectedByteLimit) break
          await unlink(file.path)
          bytes -= file.size
          count--
        }

        return { path, bytes: fits.length, sha256: createHash('sha256').update(fits).digest('hex') }
      })

      pending = work.then(() => {}, () => {})

      return work
    },
  }
}

export function createFramingRejections(store: ReturnType<typeof createRejectedStore>, log: Pick<RunLog, 'append'>) {
  return async (input: {
    frame: MonoFrame
    metadata: FitsMetadata
    verdict: RejectedSolve
    claimed: SkyPosition
    rigId: string
    requestId: string
  }) => {
    let original = null

    try {
      original = await store.write(input.frame, input.metadata)
    } catch {}

    const at = epochMs(Date.now())
    log.append(seal({ rig: rigId(input.rigId), source: sourceId('vela:framing'), kind: 'frame', at, seenAt: at, body: {
      runId: input.requestId, attempt: 1, startedAt: input.frame.capturedAt, settledAt: new Date(at).toISOString(),
      exposureSeconds: input.metadata.exposureSeconds, frameType: 'light', subject: null,
      outcome: original ? 'saved' : 'save-failed',
      message: JSON.stringify({ ...input.verdict, claimed: input.claimed, pixels: original ? 'kept' : 'missing' }),
      provenance: { requestId: input.requestId, operationId: null, imageId: null },
      image: { id: imageId(randomUUID()), capturedAt: input.frame.capturedAt, capturedAtSource: input.frame.capturedAtSource ?? 'camera',
        receivedAt: new Date(at).toISOString(), width: input.frame.width, height: input.frame.height,
        ref: original && { uri: pathToFileURL(original.path).href, bytes: original.bytes, sha256: original.sha256 } },
      statistics: null, origin: 'framing',
    } }))
  }
}
