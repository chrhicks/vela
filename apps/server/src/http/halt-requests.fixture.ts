import type { InjectOptions } from 'fastify'

const json = { 'content-type': 'application/json' }

export const emptyHaltRequests: ReadonlyArray<readonly [string, InjectOptions]> = [
  ['a bare POST', {}],
  ['an empty JSON object', { headers: json, payload: '{}' }],
  ['a JSON content type with no body', { headers: json }],
  ['an empty object with no content type', { payload: '{}' }],
]

export const refusedHaltRequests: ReadonlyArray<readonly [string, InjectOptions]> = [
  ['an unknown field', { headers: json, payload: '{"extra":true}' }],
  ['a null body', { headers: json, payload: 'null' }],
  ['an array', { headers: json, payload: '[]' }],
  ['malformed JSON', { headers: json, payload: '{' }],
]
