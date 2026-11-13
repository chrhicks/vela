import { Data, Effect, Option, Result, Schema } from 'effect'
import type { Stream } from './stream.ts'

export const StreamPosition = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('StreamPosition'))

export type StreamPosition = typeof StreamPosition.Type

export const Value = Schema.Union([Schema.Number, Schema.Boolean, Schema.String])

export type Value = typeof Value.Type

export interface Entry {
  readonly seq: StreamPosition
  readonly kind: string
  readonly at: number
  readonly body: unknown
}

export interface Message {
  readonly seq: number
  readonly subject: string
  readonly time: number
  readonly text: string
}

export class UnreadableMessage extends Data.TaggedError('UnreadableMessage')<{
  readonly seq: number
  readonly subject: string
  readonly issue: string
}> {}

const Envelope = Schema.fromJsonString(
  Schema.Struct({
    kind: Schema.String,
    at: Schema.Number,
    body: Schema.optionalKey(Schema.Unknown),
  }),
)

const Request = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))

export function makeReader(stream: Stream) {
  const decodeEnvelope = Schema.decodeUnknownResult(Envelope)
  const decodeRequest = Schema.decodeUnknownResult(Request)

  return function readMessage({ seq, subject, time, text }: Message): Result.Result<Entry, UnreadableMessage> {
    const position = StreamPosition.makeOption(seq)
    const unreadable = (issue: string) => new UnreadableMessage({ seq, subject, issue })

    if (Option.isNone(position)) return Result.fail(unreadable('not a stream position'))

    const device = stream.commandDevice(subject)

    if (device === undefined) {
      return decodeEnvelope(text).pipe(
        Result.map(({ kind, at, body }) => ({ seq: position.value, kind, at, body })),
        Result.mapError(error => unreadable(error.message)),
      )
    }

    return decodeRequest(text).pipe(
      Result.map(request => ({ seq: position.value, kind: 'command', at: time, body: { ...request, device } })),
      Result.mapError(error => unreadable(error.message)),
    )
  }
}

export const Limits = Schema.Struct({ min: Schema.Number, max: Schema.Number })

const Elements = Schema.Record(Schema.String, Value)

const withEmpty = <S extends Schema.Top>(schema: S) => Schema.withDecodingDefaultKey<S['Rebuild']>(Effect.succeed({}))(schema)

export const WireType = Schema.Literals(['def', 'set', 'new', 'del', 'message', 'other', 'unreadable'])

export const PropertyState = Schema.Literals(['Idle', 'Ok', 'Busy', 'Alert'])

export type PropertyState = typeof PropertyState.Type

export const WireBody = Schema.Struct({
  dir: Schema.Literals(['in', 'out']),
  device: Schema.String,
  type: WireType,
  property: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(PropertyState),
  elements: withEmpty(Elements),
  numbers: withEmpty(Schema.Record(Schema.String, Limits)),
})

export type WireBody = typeof WireBody.Type

export type Limits = typeof Limits.Type

export class MalformedReading extends Data.TaggedError('MalformedReading')<{
  readonly seq: StreamPosition
  readonly issue: string
}> {}

const decodeWireBody = Schema.decodeUnknownResult(WireBody)

export function readWire(entry: Entry): Result.Result<WireBody, MalformedReading> {
  return decodeWireBody(entry.body).pipe(Result.mapError(error => new MalformedReading({ seq: entry.seq, issue: error.message })))
}
