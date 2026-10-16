/**
 * Cria's recorded protocol 5 wire, decoded with @cria/wire.
 *
 * wire.golden.json is a verbatim copy of ts/testing/golden/wire.golden.json in
 * public Cria at 86624908a57573b4953c2f759713b04d606defcd, so `git hash-object`
 * on it prints that file's blob, cd6e94cc204eabb6315c61fed17920801a6a17c3.
 * Cria's golden test recorded it from a running Cria and replaced IDs and times
 * with placeholders; `resolve` puts back values the schemas accept. Replace the
 * copy only together with the Cria pin.
 */
import { readFileSync } from 'node:fs'
import { Schema } from 'effect'
import { Device, ErrorBody, Health, Operation, OperationRequest, RecoveryRequest, State } from '@cria/wire'
import { describe, expect, it } from 'vitest'
import { routeOf, statusOf, type Route } from './fake-cria.js'

const Entry = Schema.Struct({
  scenario: Schema.String,
  step: Schema.Number,
  request: Schema.String,
  sent: Schema.optionalKey(Schema.Unknown),
  status: Schema.Number,
  body: Schema.Unknown,
})

type Entry = typeof Entry.Type

/** What the recorder keeps of an ImageBytes original: its headers, length and digest. */
const Original = Schema.Struct({
  contentType: Schema.Literal('application/imagebytes'),
  contentLength: Schema.String,
  etag: Schema.String,
  bytes: Schema.Number,
  sha256: Schema.String,
})

const replies = {
  health: Health,
  state: State,
  events: State,
  submit: Operation,
  operation: Operation,
  cancel: Operation,
  lookup: Operation,
  recover: Device,
  image: Original,
} satisfies { readonly [R in Route]: Schema.Top }

/** The golden's placeholders, back to values: one UUID per ID placeholder, numbers for times and counters. */
function resolve(text: string): string {
  const ids = new Map<string, string>()

  const uuid = (placeholder: string) => {
    const id = ids.get(placeholder) ?? `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`

    ids.set(placeholder, id)

    return id
  }

  return text
    .replace(/<(?:instance|binding|request|operation|image|id)-\d+>/g, uuid)
    .replaceAll('"<time>"', String(Date.UTC(2026, 9, 15, 21)))
    .replaceAll('"<elapsed>"', '1.5')
    .replaceAll('"<sequence>"', '1')
    .replace(/"<(\d+) characters>"/g, (_, length: string) => JSON.stringify('x'.repeat(Number(length))))
    .replaceAll('<utc>', '2026-10-15T21:00:00')
}

const golden = Schema.decodeUnknownSync(Schema.Array(Entry))(JSON.parse(resolve(readFileSync(new URL('./wire.golden.json', import.meta.url), 'utf8'))))

function routeIn(entry: Entry): Route | undefined {
  const [method = '', path = ''] = entry.request.split(' ')

  return routeOf(method, path)?.route
}

function decode<S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, entry: Entry, part: 'sent' | 'body'): S['Type'] {
  try {
    return Schema.decodeUnknownSync(schema)(entry[part], { onExcessProperty: 'error' })
  } catch (error) {
    throw new Error(`"${entry.scenario}", step ${entry.step} (${entry.request}), ${part}: ${String(error)}`)
  }
}

function step(scenario: string, number: number): Entry {
  const found = golden.find(entry => entry.scenario === scenario && entry.step === number)

  if (!found) throw new Error(`The golden has no step ${number} of "${scenario}"`)

  return found
}

describe('the protocol 5 golden', () => {
  it('decodes every reply and every well-formed request with @cria/wire, and every error to its one status', () => {
    const problems: string[] = []

    for (const entry of golden) {
      const route = routeIn(entry)
      const wellFormed = entry.status !== 400 && entry.status !== 413

      try {
        if (!route) throw new Error(`${entry.request} is not a protocol 5 route`)

        if (entry.status >= 400) {
          const { code } = decode(ErrorBody, entry, 'body').error

          if (statusOf[code] !== entry.status) throw new Error(`${code} answered ${entry.status}, not ${statusOf[code]}`)
        } else decode(replies[route], entry, 'body')

        if (route === 'submit' && wellFormed) decode(OperationRequest, entry, 'sent')

        if (route === 'recover' && wellFormed) decode(RecoveryRequest, entry, 'sent')
      } catch (error) {
        problems.push(String(error))
      }
    }

    expect(problems).toEqual([])
    expect(golden).toHaveLength(127)
  })

  it('serves each original with the length and SHA-256 its Image names', () => {
    const images = golden.flatMap(entry => {
      const { body } = entry
      const settled = Schema.is(Operation)(body) && body.state === 'settled' ? body.outcome : null

      return settled?.kind === 'confirmed' && settled.value.image ? [settled.value.image] : []
    })

    const originals = golden.filter(entry => routeIn(entry) === 'image' && entry.status === 200)

    for (const entry of originals) {
      const image = images.find(candidate => entry.request === `GET ${candidate.original.url}`)

      expect(decode(Original, entry, 'body')).toEqual({
        contentType: 'application/imagebytes',
        contentLength: String(image?.original.bytes),
        etag: `"${image?.sha256}"`,
        bytes: image?.original.bytes,
        sha256: image?.sha256,
      })
    }

    expect(originals).toHaveLength(2)
  })
})

describe('the golden entries the design depends on', () => {
  it('answers cancel of an operation Cria never held 404 not-found (P10)', () => {
    const cancel = step('refused: unknown operation, request and device', 2)

    expect([routeIn(cancel), cancel.status, decode(ErrorBody, cancel, 'body').error.code]).toEqual(['cancel', 404, 'not-found'])
  })

  it('answers recover on a domain that is not held 200 with a new binding (P11)', () => {
    const scenario = 'recover refused while a mount-stop runs'
    const stop = decode(Operation, step(scenario, 3), 'body')
    const recover = step(scenario, 4)
    const sent = decode(RecoveryRequest, recover, 'sent')
    const device = decode(Device, recover, 'body')

    expect(stop).toMatchObject({ kind: 'mount-stop', state: 'settled', outcome: { kind: 'confirmed' }, bindingId: sent.bindingId })
    expect([routeIn(recover), recover.status, device.quarantine, device.bindingId === sent.bindingId]).toEqual(['recover', 200, { held: false }, false])
  })
})
