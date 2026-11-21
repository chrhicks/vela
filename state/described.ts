import { Effect, Schema } from 'effect'

export function described<S extends Schema.Top>(description: string, schema: S, value: S['Rebuild']['Encoded']) {
  return Schema.withDecodingDefaultKey<S['Rebuild']>(Effect.succeed(value))(schema.annotate({ description }))
}
