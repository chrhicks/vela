import { readFileSync } from 'node:fs'
import { Schema } from 'effect'

export { described } from '../state/described.ts'

export function decodeConfig<S extends Schema.ConstraintDecoder<unknown>>(schema: S, json: unknown): S['Type'] {
  return Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(json)
}

export function readConfig<S extends Schema.ConstraintDecoder<unknown>>(schema: S, path: string | undefined): S['Type'] {
  if (!path) throw new Error('usage: <program> <config.json>')

  return decodeConfig(schema, JSON.parse(readFileSync(path, 'utf8')))
}
