import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

const scratch = join(root, 'data', 'effect-lint-tests')

mkdirSync(scratch, { recursive: true })

const fixtures = mkdtempSync(join(scratch, 'run-'))

afterAll(() => rmSync(fixtures, { recursive: true, force: true }))

const config = JSON.parse(readFileSync(join(root, '.oxlintrc.json'), 'utf8'))

for (const plugin of config.jsPlugins) plugin.specifier = resolve(root, plugin.specifier)

writeFileSync(join(fixtures, '.oxlintrc.json'), JSON.stringify(config))

type Fixture = { path: string; source: string }

type Diagnostic = { filename: string; code: string; message?: ReturnType<typeof expect.stringContaining> }

function lint(files: Fixture[], expected: Diagnostic[]) {
  for (const file of files) {
    const path = join(fixtures, file.path)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, file.source)
  }

  const result = spawnSync(join(root, 'node_modules/.bin/oxlint'), [
    '--format', 'json', '--threads', '1', ...files.map(file => file.path),
  ], { cwd: fixtures, encoding: 'utf8' })

  expect(result.error).toBeUndefined()
  expect(result.stderr).toBe('')
  expect(result.status, result.stdout).toBe(expected.length ? 1 : 0)
  const output = JSON.parse(result.stdout)
  expect(output.diagnostics).toHaveLength(expected.length)
  expect(output.diagnostics).toEqual(expect.arrayContaining(expected.map(diagnostic => expect.objectContaining(diagnostic))))
}

const bannedMembers = [
  'catch', 'catchAll', 'catchAllCause', 'catchTag', 'catchTags', 'catchReason', 'catchReasons',
  'catchCause', 'catchDefect', 'catchIf', 'catchFilter', 'catchNoSuchElement', 'catchCauseIf',
  'catchCauseFilter', 'catchEager', 'ignore', 'ignoreCause', 'ignoreLogged', 'orElse', 'orElseSucceed',
  'option', 'exit', 'result', 'match', 'matchEager', 'matchCause', 'matchCauseEager',
  'matchCauseEffectEager', 'matchCauseEffect', 'matchEffect', 'timeout', 'timeoutOption',
  'timeoutOrElse', 'timeoutFail', 'race', 'raceFirst', 'raceAll', 'raceAllFirst', 'retry',
  'retryOrElse', 'mapError', 'mapErrorEager', 'mapErrorCause', 'mapBoth', 'flip', 'sandbox',
  'sandboxWith', 'fork', 'forkChild', 'forkIn', 'forkScoped', 'forkDetach', 'forkDaemon',
  'runFork', 'runForkWith', 'runCallback', 'runCallbackWith', 'runPromise', 'runPromiseWith',
  'runPromiseExit', 'runPromiseExitWith', 'runSync', 'runSyncWith', 'runSyncExit', 'runSyncExitWith',
]

const endingSource = `import { Effect } from 'effect'\n\n${bannedMembers.map((member, index) =>
  `export const ending${index} = Effect.${member}${member === 'catchTag' ? "('Uncertain')" : ''}`,
).join('\n\n')}\n`

const endingScopes = ['apps/server/src/capture/workflow.ts', 'apps/server/src/rig/jobs.ts']

describe.each(endingScopes)('operation endings in %s', path => {
  it('rejects every ending escape, including catching Uncertain', () => {
    lint([{ path, source: endingSource }], bannedMembers.map(member => ({
      filename: path,
      code: 'anti-slop-effect(no-ending-escape)',
      message: expect.stringContaining(`Effect.${member} `),
    })))
  })

  it('allows carrying endings and settling through Cria primitives', () => {
    lint([{ path, source: `import { Effect } from 'effect'
import { settle } from '@cria/primitives'

export const capture = Effect.gen(function* () {
  return yield* Effect.map(Effect.succeed(1), value => value + 1)
})

export const outcome = settle(capture)
` }], [])
  })
})

it.each([
  'apps/server/src/rig/rig.ts',
  'apps/server/src/rig/stop.ts',
  'apps/server/src/cria/equipment.ts',
  'packages/cria/src/equipment.ts',
  'apps/server/src/saved-images/store.ts',
  'apps/server/src/plate-solving/solver.ts',
  'apps/server/src/targets/catalog/catalog.ts',
])('allows deciding every ending in %s', path => {
  lint([{ path, source: endingSource }], [])
})

it('resolves Effect aliases, namespaces, subpath imports, and literal member access', () => {
  const path = 'apps/server/src/alignment/workflow.ts'

  const sources = [
    "import { Effect as Fx } from 'effect'\n\nexport const ending = Fx.retry",
    "import * as Fx from 'effect'\n\nexport const ending = Fx.Effect.timeout",
    "import * as Fx from 'effect/Effect'\n\nexport const ending = Fx['exit']",
    "import { catchTag as recover } from 'effect/Effect'\n\nexport const ending = recover('Uncertain')",
  ]

  for (const source of sources) {
    lint([{ path, source }], [{ filename: path, code: 'anti-slop-effect(no-ending-escape)' }])
  }
})

it('leaves unrelated objects and shadowed Effect bindings alone', () => {
  lint([{ path: 'apps/server/src/capture/workflow.ts', source: `import { Effect } from 'effect'

export const capture = Effect.succeed(1)

export function read(Effect) {
  return Effect.exit()
}

export const cache = { retry: () => 1 }

export const value = cache.retry()
` }], [])
})

it.each(['apps/server/src/rig/rig.ts', 'apps/web/src/app.ts', 'apps/workshop/src/app.ts'])(
  'rejects service graphs in %s', path => {
    const source = `import { Context, Layer } from 'effect'

export const service = Context.Service

export const tag = Context.Tag

export const layer = Layer.succeed
`

    const expected = ['Context.Service', 'Context.Tag', 'Layer.succeed'].map(member => ({
      filename: path,
      code: 'anti-slop-effect(no-service-graph)',
      message: expect.stringContaining(member),
    }))

    if (path.startsWith('apps/web/')) expected.push({
      filename: path,
      code: 'eslint(no-restricted-imports)',
      message: expect.stringContaining('effect'),
    })
    lint([{ path, source }], expected)
  },
)

it('resolves service graph aliases, namespaces, subpaths, and literal members', () => {
  const path = 'apps/server/src/rig/rig.ts'

  for (const source of [
    "import { Context as C } from 'effect'\n\nexport const service = C['Service']",
    "import * as Fx from 'effect'\n\nexport const service = Fx.Context.Tag",
    "import * as L from 'effect/Layer'\n\nexport const layer = L.succeed",
    "import { Tag } from 'effect/Context'\n\nexport const service = Tag",
    "import { succeed } from 'effect/Layer'\n\nexport const layer = succeed",
  ]) lint([{ path, source }], [{ filename: path, code: 'anti-slop-effect(no-service-graph)' }])
})

it('allows plain constructors and unrelated Context and Layer objects in apps', () => {
  lint([{ path: 'apps/server/src/rig/rig.ts', source: `import { makeRig } from './factory'

export const rig = makeRig()

export function draw(Context, Layer) {
  return [Context.Service, Context.Tag, Layer.succeed]
}
` }], [])
})

it('rejects service graphs in adapter code too', () => {
  lint([{ path: 'packages/alpaca/src/internal/example.ts', source: `import { Context, Layer } from 'effect'

export const service = Context.Service

export const tag = Context.Tag

export const layer = Layer.succeed
` }], ['Context.Service', 'Context.Tag', 'Layer.succeed'].map(member => ({
    filename: 'packages/alpaca/src/internal/example.ts',
    code: 'anti-slop-effect(no-service-graph)',
    message: expect.stringContaining(member),
  })))
})

it.each(['packages/model/src/example.ts', 'apps/web/src/example.ts'])('keeps Effect and Cria imports out of %s', path => {
  for (const source of [
    "import { Effect } from 'effect'\n\nexport const value = Effect",
    "import * as Fx from 'effect/Effect'\n\nexport const value = Fx",
    "import { settle } from '@cria/primitives'\n\nexport const value = settle",
    "import type { Snapshot } from '@cria/wire'\n\nexport type Value = Snapshot",
    "import type { Snapshot } from '@cria/wire/snapshot'\n\nexport type Value = Snapshot",
  ]) lint([{ path, source }], [{ filename: path, code: 'eslint(no-restricted-imports)' }])
})

it.each(['apps/server/src/rig/rig.ts', 'packages/equipment/src/example.ts', 'apps/server/src/rig/example.test.ts'])(
  'keeps Cria wire imports out of %s', path => {
    lint([{ path, source: "import type { Snapshot } from '@cria/wire'\n\nexport type Value = Snapshot" }], [
      { filename: path, code: 'eslint(no-restricted-imports)' },
    ])
  },
)

it('allows wire imports in Cria and Effect and primitives in server code', () => {
  lint([
    { path: 'packages/cria/src/example.ts', source: "import type { Snapshot } from '@cria/wire'\n\nexport type Value = Snapshot" },
    { path: 'apps/server/src/rig/example.ts', source: "import { Effect } from 'effect'\nimport { settle } from '@cria/primitives'\n\nexport const result = settle(Effect.succeed(1))" },
  ], [])
})
