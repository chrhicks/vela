import { Effect } from 'effect'
import { SourceUnreadable } from '../sources.ts'
import { namesFile, stellarium } from './source.ts'

export type StellariumName = {
  readonly line: number
  readonly prefix: string
  readonly identifier: string
  readonly name: string
  readonly citations: string | null
}

export const nameColumns: ReadonlyArray<keyof StellariumName> = ['line', 'prefix', 'identifier', 'name', 'citations']

const record = /^_\("(.+)"\)\s*(?:#\s*(.*))?$/

function readLine(content: string, line: number): Effect.Effect<StellariumName, SourceUnreadable> {
  const found = record.exec(content.slice(20).trim())
  const identifier = content.slice(5, 20).trim()

  if (found === null || identifier === '') return Effect.fail(new SourceUnreadable({ source: stellarium.id, file: namesFile.name, line, reason: 'not a name record' }))

  return Effect.succeed({ line, prefix: content.slice(0, 5).trim(), identifier, name: found[1]!, citations: found[2]?.trim() || null })
}

export const readNames = (text: string) =>
  Effect.forEach(
    text.split('\n').flatMap((content, index) => (content.trim() === '' || content.startsWith('#') ? [] : [{ content, line: index + 1 }])),
    ({ content, line }) => readLine(content, line),
  )
