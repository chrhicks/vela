import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface ActiveRecord {
  readonly run: string
  readonly startedAt: number
  readonly object: string
  readonly frameType: string
  readonly count: number | undefined
  readonly counted: number
}

export interface RunFile {
  readonly read: () => Partial<ActiveRecord> | undefined
  readonly write: (record: ActiveRecord) => void
  readonly clear: () => void
}

export function makeRunFile(path: string): RunFile {
  return {
    read(): Partial<ActiveRecord> | undefined {
      if (!existsSync(path)) return undefined

      try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))

        return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<ActiveRecord>) : {}
      } catch {
        return {}
      }
    },

    write(record: ActiveRecord) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(`${path}.part`, JSON.stringify(record))
      renameSync(`${path}.part`, path)
    },

    clear() {
      rmSync(path, { force: true })
    },
  }
}
