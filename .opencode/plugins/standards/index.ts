import { Plugin } from '@opencode/plugin/effect'
import { Effect, Schema } from 'effect'
import { checkStandards } from './runner.ts'
import { StandardsResults } from './rpc.ts'
import { readReport } from './report.ts'

const input = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)),
  mode: Schema.optional(Schema.Literals(['files', 'changes'])),
  base: Schema.optional(Schema.String),
  supportingPaths: Schema.optional(Schema.Array(Schema.String)),
  applicabilityThreshold: Schema.optional(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
})

export default Plugin.define({
  id: 'vela.standards',
  effect: ctx => Effect.gen(function* () {
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
        description: 'Check JavaScript/TypeScript files or Git changes against the experimental Vela coding-standards catalog using Jev. Defaults to tracked and untracked changes against HEAD. Paths are checkout-root-relative. Use mode files for whole files; supportingPaths supplies helper code, contracts, documentation or verification reports (JS/TS, Markdown, text, JSON, YAML). Returns file: failed standards and a raw evidence path. Investigate findings in the source; this is a probabilistic signal, not a correctness verdict. Sends selected source and context to TypeSafe.',
        input,
        options: { codemode: true },
        execute: (input, context) => Effect.gen(function* () {
          const session = yield* ctx.session.get({ sessionID: context.sessionID }).pipe(Effect.orDie)
          yield* context.progress({ status: 'Checking coding standards with Jev' })
          const result = yield* Effect.tryPromise(signal => checkStandards(session.location.directory, input, signal)).pipe(Effect.orDie)
          yield* ctx.storage.set(`standards/latest/${context.sessionID}`, result.artifact)
          yield* results.events.emit('updated', { sessionID: context.sessionID }).pipe(Effect.orDie)
          return { content: result.content }
        }),
      })
    })

    yield* ctx.command.transform(editor => {
      editor.add({
        name: 'standards',
        description: 'Run Jev standards checks on current changes or specified files',
        execute: ({ sessionID, prompt, delivery }) => ctx.session.prompt({
          ...prompt, sessionID, delivery,
          text: `Use standards_check to review ${prompt.text.trim() ? `these files or changes: ${prompt.text}` : 'current working-tree changes against HEAD'}. For explicit file paths use mode files. Present the concise findings, then inspect the flagged source and relevant standards to explain any actionable issues. A finding is a prompt to investigate, not an instruction to rewrite code automatically.`,
        }).pipe(Effect.asVoid),
      })
    })

    yield* ctx.session.hook('context', event => Effect.sync(() => {
      event.system.push({ type: 'text', text: 'After a coherent batch of code edits in Vela, use standards_check on the affected files or changes before reporting completion. Investigate flagged standards in the source. Raw Jev judgments are evidence, not authority; skipped or inconclusive checks are not passes. Do not rerun unchanged checks merely to obtain a different verdict.' })
    }))
  }),
})
