import { Model, Plugin } from '@opencode/plugin/effect'
import { Effect, Schema } from 'effect'
import { checkStandards } from './runner.ts'
import { StandardsResults } from './rpc.ts'
import { readReport } from './report.ts'

const input = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)),
  mode: Schema.optional(Schema.Literals(['files', 'changes'])),
  base: Schema.optional(Schema.String),
  supportingPaths: Schema.optional(Schema.Array(Schema.String)),
})

export default Plugin.define({
  id: 'vela.standards',
  effect: ctx => Effect.gen(function* () {
    const options = Schema.decodeUnknownSync(Schema.Struct({ reviewerModel: Schema.optional(Schema.String) }))(ctx.options)
    const reviewerModel = options.reviewerModel ?? 'openai/gpt-5.6-luna#medium'
    const model = Model.Ref.parse(reviewerModel)
    const results = yield* ctx.rpc.register(StandardsResults, {
      latest: ({ sessionID }) => Effect.gen(function* () {
        const artifact = yield* ctx.storage.get(`standards/latest/${sessionID}`)
        if (typeof artifact !== 'string') return null
        return yield* Effect.tryPromise(() => readReport(artifact)).pipe(Effect.orDie)
      }),
    }).pipe(Effect.orDie)

    yield* ctx.tool.transform(editor => {
      editor.add({
        name: 'standards_check',
        description: 'Review Vela JS/TS code against repository standards with one isolated Luna call. Returns diagnostics with stable rule IDs, severity, exact source citations and suggested corrections; missing code evidence and failed/stale reviews are separate check status. Defaults to working-tree changes against HEAD; mode files reviews whole files. Paths are checkout-relative. Supply relevant helper definitions/contracts in supportingPaths. At most 30 targets, 40 KB per source, 180 KB assembled input. Sends source and repository guidance to the configured model provider. No edits, command execution, automatic follow-up calls or merge verdict; the independent verifier remains separate.',
        input,
        options: { codemode: true },
        execute: (input, context) => Effect.gen(function* () {
          const session = yield* ctx.session.get({ sessionID: context.sessionID }).pipe(Effect.orDie)
          yield* context.progress({ status: `Reviewing standards with ${reviewerModel}` })
          const result = yield* Effect.tryPromise(signal => checkStandards(session.location.directory, input, signal, {
            model: reviewerModel,
            // The Promise runner's abort signal explicitly owns this model fiber too.
            generate: (prompt, signal) => Effect.runPromise(ctx.generate.text({ model, prompt }).pipe(Effect.timeout('90 seconds')), { signal }).then(result => result.text),
          })).pipe(Effect.orDie)
          yield* ctx.storage.set(`standards/latest/${context.sessionID}`, result.artifact)
          yield* results.events.emit('updated', { sessionID: context.sessionID }).pipe(Effect.orDie)
          return { content: result.content }
        }),
      })
    })

    yield* ctx.command.transform(editor => {
      editor.add({
        name: 'standards',
        description: 'Review standards with evidence-backed findings',
        execute: ({ sessionID, prompt, delivery }) => ctx.session.prompt({
          ...prompt, sessionID, delivery,
          text: `Use standards_check to review ${prompt.text.trim() ? `these files or changes: ${prompt.text}` : 'current working-tree changes against HEAD'}. For explicit file paths use mode files. Include relevant helper contracts in supportingPaths. Present diagnostics and unresolved code evidence, checking citations before correcting code. These diagnostics do not replace independent delivery verification.`,
        }).pipe(Effect.asVoid),
      })
    })

    yield* ctx.session.hook('context', event => Effect.sync(() => {
      event.system.push({ type: 'text', text: 'After a coherent batch of Vela code edits, use standards_check on a focused set of affected files or changes with relevant supportingPaths before reporting completion. It performs one isolated reasoning-model review and returns source-backed diagnostics. Resolve concrete concerns; disclose missing evidence, incomplete, stale and skipped results. Do not rerun unchanged inputs to obtain a preferred verdict. This tool does not replace or need to be invoked by the independent repository verifier.' })
    }))
  }),
})
