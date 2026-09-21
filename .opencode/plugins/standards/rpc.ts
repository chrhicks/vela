import { Rpc } from '@opencode/plugin/rpc'
import { Schema } from 'effect'

export const citationSchema = Schema.Struct({
  path: Schema.String,
  startLine: Schema.Int,
  endLine: Schema.Int,
  quote: Schema.String,
  sha256: Schema.String,
})
export const diagnosticSchema = Schema.Struct({
  rule: Schema.String,
  severity: Schema.Literals(['error', 'warning', 'information']),
  message: Schema.String,
  explanation: Schema.String,
  suggestion: Schema.String,
  location: citationSchema,
  related: Schema.Array(citationSchema),
})
export const missingEvidenceSchema = Schema.Struct({
  path: Schema.String,
  reason: Schema.String,
  nextAction: Schema.String,
})
export const reportSchema = Schema.Struct({
  schemaVersion: Schema.Number,
  artifact: Schema.String,
  time: Schema.String,
  mode: Schema.Literals(['files', 'changes']),
  model: Schema.String,
  status: Schema.Literals(['complete', 'incomplete', 'stale']),
  diagnostics: Schema.Array(diagnosticSchema),
  missingEvidence: Schema.Array(missingEvidenceSchema),
  files: Schema.Array(Schema.Struct({
    path: Schema.String,
    skipped: Schema.optional(Schema.String),
    error: Schema.optional(Schema.String),
  })),
  error: Schema.optional(Schema.String),
})
export type Report = typeof reportSchema.Type
export type Diagnostic = typeof diagnosticSchema.Type
export type Citation = typeof citationSchema.Type

export const StandardsResults = Rpc.define({
  id: 'vela.standards.results',
  methods: {
    latest: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })),
      output: Schema.toStandardSchemaV1(Schema.NullOr(reportSchema)),
    },
  },
  events: {
    updated: {
      schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })),
    },
  },
})
