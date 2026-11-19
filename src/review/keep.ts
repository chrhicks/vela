import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Effect } from 'effect'
import { NotKept } from './review.ts'

export const keepLine = (path: string) => (line: string) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true })
      await appendFile(path, `${line}\n`)
    },
    catch: cause => new NotKept({ path, cause }),
  })
