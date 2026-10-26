import type { InjectOptions } from 'fastify'

const json = { 'content-type': 'application/json' }

const text = { 'content-type': 'text/plain' }

const binary = { 'content-type': 'application/octet-stream' }

export const emptyHaltRequests: ReadonlyArray<readonly [string, InjectOptions]> = [
  ['a bare POST', {}],
  ['an empty JSON object', { headers: json, payload: '{}' }],
  ['a JSON content type with no body', { headers: json }],
  ['an empty object with no content type', { payload: '{}' }],
  ['an empty body under a non-JSON content type', { headers: binary }],
  ['an empty object under a non-JSON content type', { headers: binary, payload: '{}' }],
]

export const refusedHaltRequests: ReadonlyArray<readonly [string, InjectOptions]> = [
  ['an unknown field', { headers: json, payload: '{"extra":true}' }],
  ['a null body', { headers: json, payload: 'null' }],
  ['an array', { headers: json, payload: '[]' }],
  ['malformed JSON', { headers: json, payload: '{' }],
  ['an empty body under text/plain', { headers: text }],
  ['an empty object under text/plain', { headers: text, payload: '{}' }],
]
