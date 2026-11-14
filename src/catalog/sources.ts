import { Data, Effect } from 'effect'
import { createHash } from 'node:crypto'

export interface SourceFile {
  readonly name: string
  readonly address: string
}

export interface Source {
  readonly id: string
  readonly name: string
  readonly authors: string
  readonly version: string
  readonly homepage: string
  readonly license: string
  readonly files: ReadonlyArray<SourceFile>
}

export interface PulledFile extends SourceFile {
  readonly text: string
  readonly bytes: number
  readonly sha256: string
}

export class SourceUnreachable extends Data.TaggedError('SourceUnreachable')<{ readonly source: string; readonly address: string; readonly reason: string }> {}

export class SourceUnreadable extends Data.TaggedError('SourceUnreadable')<{ readonly source: string; readonly file: string; readonly line: number; readonly reason: string }> {}

export const pullFile = (source: Source, file: SourceFile) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(file.address)

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      return Buffer.from(await response.arrayBuffer())
    },
    catch: cause => new SourceUnreachable({ source: source.id, address: file.address, reason: cause instanceof Error ? cause.message : String(cause) }),
  }).pipe(
    Effect.map((body): PulledFile => ({ ...file, text: body.toString('utf8'), bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex') })),
  )
