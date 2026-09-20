import { readFile } from 'node:fs/promises'
import { Schema } from 'effect'
import { responseSchema } from './jev.ts'
import type { Report } from './rpc.ts'

const artifactSchema = Schema.Struct({
  time: Schema.String,
  mode: Schema.String,
  threshold: Schema.Number,
  results: Schema.Array(Schema.Struct({
    path: Schema.String,
    failed: Schema.Array(Schema.String),
    inconclusive: Schema.Array(Schema.String),
    skipped: Schema.optional(Schema.String),
    error: Schema.optional(Schema.String),
  })),
  calls: Schema.Array(Schema.Struct({
    request: Schema.Struct({
      state: Schema.Struct({ path: Schema.String }),
      questions: Schema.Record(Schema.String, Schema.Struct({ instructions: Schema.String })),
    }),
    response: Schema.optional(Schema.String),
  })),
})

export async function readReport(artifact: string): Promise<Report> {
  const saved = Schema.decodeUnknownSync(artifactSchema)(JSON.parse(await readFile(artifact, 'utf8')))
  const files = saved.results.map(file => {
    const applicability: Record<string, number> = {}
    const checks: Report['files'][number]['checks'][number][] = []
    for (const call of saved.calls) {
      if (call.request.state.path !== file.path || !call.response) continue
      let response: typeof responseSchema.Type
      try {
        response = Schema.decodeUnknownSync(responseSchema)(JSON.parse(call.response))
      } catch {
        // Failed API bodies need not match the schema; the file's error explains the failure.
        continue
      }
      for (const [id, question] of Object.entries(call.request.questions)) {
        const answer = response.answers[id]
        if (!answer) continue
        if (answer.type === 'noul') applicability[id] = answer.noul
        else checks.push({
          id, verdict: answer.choice, probability: answer.probabilities[answer.choice], confidence: answer.confidence,
          probabilities: answer.probabilities,
          question: question.instructions.split('this specific judgment: ').at(-1)!,
        })
      }
    }
    return { ...file, applicability, checks }
  })
  return { artifact, time: saved.time, mode: saved.mode, threshold: saved.threshold, files }
}
