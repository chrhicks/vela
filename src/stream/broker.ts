import { Schema } from 'effect'

export const BrokerSettings = Schema.Struct({
  servers: Schema.String.annotate({ description: 'The broker URL as this machine reaches it' }),
})

export type BrokerSettings = typeof BrokerSettings.Type
