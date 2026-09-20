import { Schema } from 'effect'
import type { Question } from './checks.ts'

const probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const verdict = Schema.Literals(['met', 'violated', 'not_applicable', 'insufficient_context'])
const answer = Schema.Union([
  Schema.Struct({ type: Schema.Literal('noul'), noul: probability }),
  Schema.Struct({
    type: Schema.Literal('choice'),
    choice: verdict,
    confidence: probability,
    probabilities: Schema.Struct({ met: probability, violated: probability, not_applicable: probability, insufficient_context: probability }),
  }),
])
export const responseSchema = Schema.Struct({
  model: Schema.String,
  answers: Schema.Record(Schema.String, answer),
  usage: Schema.optional(Schema.Struct({ input_tokens: Schema.Number, output_tokens: Schema.Number })),
})

export type Answer = typeof answer.Type
export type State = {
  path: string
  code: string
  diff?: string
  supporting_context?: Record<string, string>
  coding_standards: Partial<Record<string, string>>
}
export type Call = {
  request: { model: string; state: State; questions: Record<string, Question> }
  status?: number
  response?: string
  milliseconds?: number
}

export async function askJev(state: State, questions: Record<string, Question>, key: string, signal: AbortSignal, calls: Call[], send = globalThis.fetch) {
  const request = { model: 'jev-1.13.0', state, questions }
  const call: Call = { request }
  calls.push(call)
  const start = performance.now()

  try {
    const response = await send('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    })
    call.status = response.status
    call.response = await response.text()
    if (!response.ok) throw new Error(`Jev returned HTTP ${response.status}`)
    const decoded = Schema.decodeUnknownSync(responseSchema)(JSON.parse(call.response))

    for (const [id, question] of Object.entries(questions)) {
      if (decoded.answers[id]?.type !== question.type) throw new Error(`Jev omitted or mistyped answer ${id}`)
    }

    return Object.fromEntries(Object.keys(questions).map(id => [id, decoded.answers[id]]))
  } catch (cause) {
    throw new Error(`Jev check for ${state.path} failed`, { cause })
  } finally {
    call.milliseconds = Math.round(performance.now() - start)
  }
}
