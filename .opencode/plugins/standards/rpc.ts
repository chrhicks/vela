import { Rpc } from '@opencode/plugin/rpc'
import { Schema } from 'effect'

const finding = Schema.Struct({
  id: Schema.String,
  verdict: Schema.String,
  probability: Schema.Number,
  confidence: Schema.optional(Schema.Number),
  question: Schema.String,
  probabilities: Schema.Record(Schema.String, Schema.Number),
})
const file = Schema.Struct({
  path: Schema.String,
  failed: Schema.Array(Schema.String),
  inconclusive: Schema.Array(Schema.String),
  skipped: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  applicability: Schema.Record(Schema.String, Schema.Number),
  checks: Schema.Array(finding),
})
export const reportSchema = Schema.Struct({
  artifact: Schema.String,
  time: Schema.String,
  mode: Schema.String,
  threshold: Schema.Number,
  files: Schema.Array(file),
})
export type Report = typeof reportSchema.Type
export type ReportFile = typeof file.Type

export const StandardsResults = Rpc.define({
  id: 'vela.standards.results',
  methods: {
    latest: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })),
      output: Schema.toStandardSchemaV1(Schema.NullOr(reportSchema)),
    },
  },
  events: {
    updated: { schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })) },
  },
})
