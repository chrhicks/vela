/**
 * Cria's recorded protocol 5 wire, decoded with @cria/wire.
 *
 * wire.golden.json is a verbatim copy of ts/testing/golden/wire.golden.json in
 * public Cria at f82674d6efbc56c3f71e9533968d1f73590919fa, so `git hash-object`
 * on it prints that file's blob, 0ba9cd294c35a862d5074192ba73fca978450227.
 * Cria's golden test recorded it from a running Cria and replaced IDs and times
 * with placeholders; `resolve` puts back values the schemas accept. Replace the
 * copy only together with the Cria pin.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Option, Schema } from 'effect'
import { Device, ErrorBody, Health, Operation, OperationRequest, RecoveryRequest, State } from '@cria/wire'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCria, routeOf, statusOf, type Route } from './fake-cria.js'

const Entry = Schema.Struct({
  scenario: Schema.String,
  step: Schema.Number,
  request: Schema.String,
  sent: Schema.optionalKey(Schema.Unknown),
  status: Schema.Number,
  body: Schema.Unknown,
})

type Entry = typeof Entry.Type

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

const text = readFileSync(new URL('./wire.golden.json', import.meta.url), 'utf8')

const golden = Schema.decodeUnknownSync(Schema.Array(Entry))(JSON.parse(resolve(text)))

const recorded = Schema.decodeUnknownSync(Schema.Array(Entry))(JSON.parse(text))

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
  it('decodes every reply with @cria/wire, and every error to its one status', () => {
    const problems: string[] = []

    for (const entry of golden) {
      const route = routeIn(entry)

      try {
        if (!route) throw new Error(`${entry.request} is not a protocol 5 route`)

        if (entry.status >= 400) {
          const { code } = decode(ErrorBody, entry, 'body').error

          if (statusOf[code] !== entry.status) throw new Error(`${code} answered ${entry.status}, not ${statusOf[code]}`)
        } else decode(replies[route], entry, 'body')
      } catch (error) {
        problems.push(String(error))
      }
    }

    expect(problems).toEqual([])
    expect(golden).toHaveLength(130)
  })

  it('accepts every request body Cria accepted, and rejects the five Cria refused as malformed', () => {
    const sent = golden.filter(entry => entry.sent !== undefined)
    const strictly = { onExcessProperty: 'error' } as const

    const accepted = (entry: Entry) =>
      routeIn(entry) === 'recover'
        ? Option.isSome(Schema.decodeUnknownOption(RecoveryRequest)(entry.sent, strictly))
        : Option.isSome(Schema.decodeUnknownOption(OperationRequest)(entry.sent, strictly))

    const malformed = sent.filter(entry => !accepted(entry))

    expect(malformed.map(entry => [entry.scenario, entry.step, entry.status])).toEqual([
      ['refused: invalid request', 1, 400],
      ['refused: invalid request', 2, 400],
      ['refused: invalid request', 3, 400],
      ['refused: invalid request', 5, 413],
      ['no acknowledgement: uncertain, held by quarantine, then recovered', 7, 400],
    ])
    expect(sent).toHaveLength(65)
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

  it('shows a skipped bad update as an unavailable focuser temperature on a device that stays ready, then recovered', () => {
    const scenario = 'skipped bad update: the focuser temperature reads unavailable until a good definition comes back'
    const focuser = (number: number) => decode(State, step(scenario, number), 'body').devices.find(device => device.kind === 'focuser')

    expect(focuser(1)?.readings.temperatureC).toMatchObject({ status: 'fresh' })
    expect(focuser(2)?.readings.temperatureC).toEqual({ status: 'unavailable', reason: 'not-read' })
    expect(focuser(2)?.availability).toEqual({ ready: true })
    expect(focuser(3)?.readings.temperatureC).toMatchObject({ status: 'fresh' })
  })

  it('answers recover on a domain that is not held 200 with a new binding (P11)', () => {
    const scenario = 'recover refused while a mount-stop runs'
    const requests = golden.filter(entry => entry.scenario === scenario).map(entry => entry.request)
    const stop = decode(Operation, step(scenario, 3), 'body')
    const recover = step(scenario, 4)
    const sent = decode(RecoveryRequest, recover, 'sent')
    const device = decode(Device, recover, 'body')

    // Each golden scenario runs on a fresh Cria, so this stop is the only operation the mount ever had.
    expect(requests).toEqual(['POST /v2/operations', 'POST /v2/devices/mount/recover', `GET /v2/operations/${stop.id}`, 'POST /v2/devices/mount/recover'])
    expect(stop).toMatchObject({ kind: 'mount-stop', state: 'settled', outcome: { kind: 'confirmed' }, bindingId: sent.bindingId })
    expect([routeIn(recover), recover.status, device.quarantine, device.bindingId === sent.bindingId]).toEqual(['recover', 200, { held: false }, false])
  })
})

const Identified = Schema.Struct({ id: Schema.String })

/** Golden scenarios the fake replays, with the placeholders that stand for its live instance and binding. */
const replayed = [
  { scenario: 'refused: unknown operation, request and device', deviceId: 'camera' },
  { scenario: 'duplicate request ID: same content returns the operation, changed content is refused', deviceId: 'camera' },
  { scenario: 'refused: binding changed', deviceId: 'camera', binding: '<binding-2>' },
  { scenario: 'refused: instance changed', deviceId: 'camera', instance: '<instance-2>' },
  { scenario: 'refused: wrong device kind', deviceId: 'mount' },
  { scenario: 'refused: invalid request', deviceId: 'camera' },
  { scenario: 'refused: device busy', deviceId: 'camera' },
  { scenario: 'refused: commands disabled', deviceId: 'camera' },
  { scenario: 'cancel a running capture, then cancel it again', deviceId: 'camera' },
  { scenario: 'recover refused while a mount-stop runs', deviceId: 'mount' },
]

describe('the fake against the golden', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(replayed)('answers "$scenario" as Cria did', async ({ scenario, deviceId, instance = '<instance-1>', binding = '<binding-1>' }) => {
    const cria = new FakeCria()

    const live = new Map<string, string>([
      [instance, cria.instanceId],
      [binding, cria.bindingOf(deviceId)],
    ])

    const fill = (template: string) =>
      template
        .replace(/<(?:instance|binding|request|operation|id)-\d+>/g, placeholder => live.get(placeholder) ?? live.set(placeholder, randomUUID()).get(placeholder) ?? '')
        .replace(/"<(\d+) characters>"/g, (_, length: string) => JSON.stringify('x'.repeat(Number(length))))

    const answers = []

    cria.commandsEnabled = scenario !== 'refused: commands disabled'
    cria.durationMs['mount-stop'] = 1_500

    for (const entry of recorded.filter(candidate => candidate.scenario === scenario)) {
      await vi.advanceTimersByTimeAsync(1_000)
      const [method = '', path = ''] = fill(entry.request).split(' ')
      const body = entry.sent === undefined ? undefined : fill(JSON.stringify(entry.sent))
      const response = await cria.fetch(`${cria.origin}${path}`, body === undefined ? { method } : { method, body })
      const answer = await response.json()

      if (Schema.is(Identified)(entry.body) && Schema.is(Identified)(answer)) live.set(entry.body.id, answer.id)
      answers.push([response.status, Schema.is(ErrorBody)(answer) ? answer.error.code : null])
    }

    cria.close()
    expect(answers).toEqual(golden.filter(entry => entry.scenario === scenario).map(entry => [entry.status, Schema.is(ErrorBody)(entry.body) ? entry.body.error.code : null]))
  })
})
