import type { InjectOptions } from 'fastify'

const contentTypes = [
  undefined,
  'application/json',
  'text/plain',
  'application/x-www-form-urlencoded',
  'application/octet-stream',
]

const bodies = ['{}', 'null', '[]', '{"a":1}', 'not json']

function request(contentType: string | undefined, payload?: string): InjectOptions {
  return {
    ...(contentType && { headers: { 'content-type': contentType } }),
    ...(payload !== undefined && { payload }),
  }
}

export const emptyHaltRequests: ReadonlyArray<readonly [string, InjectOptions]> = contentTypes.map(contentType => [
  `an empty body under ${contentType ?? 'no content type'}`,
  request(contentType),
])

export const refusedHaltRequests: ReadonlyArray<readonly [string, InjectOptions]> = contentTypes.flatMap(contentType =>
  bodies.map((body): readonly [string, InjectOptions] => [
    `${body} under ${contentType ?? 'no content type'}`,
    request(contentType, body),
  ]),
)
