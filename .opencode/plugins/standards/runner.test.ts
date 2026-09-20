import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Schema } from 'effect'
import { checkStandards } from './runner.ts'

const requestSchema = Schema.Struct({
  state: Schema.Struct({ path: Schema.String, code: Schema.String, diff: Schema.optional(Schema.String), coding_standards: Schema.Record(Schema.String, Schema.String) }),
  questions: Schema.Record(Schema.String, Schema.Struct({ type: Schema.Literals(['noul', 'choice']) })),
})
type Request = typeof requestSchema.Type

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'jev-standards-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '--quiet')
  await writeFile(join(root, 'CODING_STANDARDS.md'), await readFile(new URL('../../../CODING_STANDARDS.md', import.meta.url)))
  await writeFile(join(root, '.gitignore'), '.env\nignored.ts\n.opencode/.local/\n')
  await writeFile(join(root, '.env'), 'TYPESAFE_API_KEY=test-key\n')
  await writeFile(join(root, 'tracked.ts'), "export const original = true\n")
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'Fixture')
  return { root, git }
}

function reply(request: Request) {
  return Response.json({
    model: 'jev-test',
    answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id,
      question.type === 'noul' ? { type: 'noul', noul: id === 'error_context' ? 0.71 : 0.7 } : {
        type: 'choice', choice: 'violated', confidence: 0.9,
        probabilities: { violated: 0.9, met: 0.1, not_applicable: 0, insufficient_context: 0 },
      },
    ])),
  })
}

test('routes strictly above 70%, uses named source standards, and retains evidence without credentials', async t => {
  const { root } = await fixture(t)
  const requests: Request[] = []
  const send: typeof fetch = async (_url, init) => {
    const request = Schema.decodeUnknownSync(requestSchema)(JSON.parse(String(init?.body)))
    requests.push(request)
    return reply(request)
  }
  const result = await checkStandards(root, { mode: 'files', paths: ['tracked.ts'] }, new AbortController().signal, send)
  assert.match(result, /tracked.ts: error_context/)
  assert.equal(requests.length, 2)
  assert.deepEqual(Object.keys(requests[1].questions), ['error_context.cause'])
  assert.match(requests[0].state.coding_standards.error_context, /Preserve enough context to identify the operation/)
  assert.equal(requests[0].state.code, 'export const original = true\n')
  const evidenceDirectory = join(root, '.opencode/.local/standards')
  const evidence = await readFile(join(evidenceDirectory, (await readdir(evidenceDirectory))[0]), 'utf8')
  assert.match(evidence, /"sha256"/)
  assert.doesNotMatch(evidence, /test-key|Authorization/)
})

test('changes mode includes staged and untracked source, supplying the tracked diff', async t => {
  const { root, git } = await fixture(t)
  await writeFile(join(root, 'tracked.ts'), 'export const changed = true\n')
  git('add', 'tracked.ts')
  await writeFile(join(root, 'new.ts'), 'export const added = true\n')
  const requests: Request[] = []
  const send: typeof fetch = async (_url, init) => {
    const request = Schema.decodeUnknownSync(requestSchema)(JSON.parse(String(init?.body)))
    requests.push(request)
    return reply(request)
  }
  const result = await checkStandards(root, {}, new AbortController().signal, send)
  assert.match(result, /2 files evaluated/)
  const tracked = requests.find(request => request.state.path === 'tracked.ts')!
  assert.match(tracked.state.diff!, /\+export const changed/)
  assert.equal(requests.find(request => request.state.path === 'new.ts')!.state.diff, undefined)
})

test('missing Jev answers are inconclusive, never reported as a clean evaluation', async t => {
  const { root } = await fixture(t)
  const send: typeof fetch = async () => Response.json({ model: 'jev-test', answers: {} })
  const result = await checkStandards(root, { mode: 'files', paths: ['tracked.ts'] }, new AbortController().signal, send)
  assert.match(result, /inconclusive.*Jev omitted or mistyped answer/)
  assert.match(result, /0 files evaluated/)
  assert.doesNotMatch(result, /No failed standards/)
})

test('ignored source and symlinks outside the checkout are not sent to Jev', async t => {
  const { root } = await fixture(t)
  const outside = await mkdtemp(join(tmpdir(), 'jev-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'outside.ts'), 'secret')
  await symlink(join(outside, 'outside.ts'), join(root, 'linked.ts'))
  await writeFile(join(root, 'ignored.ts'), 'secret')
  let calls = 0
  const send: typeof fetch = async () => { calls++; throw new Error('Unexpected API call') }
  const result = await checkStandards(root, { mode: 'files', paths: ['ignored.ts', 'linked.ts'] }, new AbortController().signal, send)
  assert.equal(calls, 0)
  assert.match(result, /Ignored files are excluded/)
  assert.match(result, /Source must be inside this checkout/)
})

test('cancelling a pending request aborts transport and never starts judgment calls', async t => {
  const { root } = await fixture(t)
  const controller = new AbortController()
  const started = Promise.withResolvers<void>()
  const aborted = Promise.withResolvers<void>()
  let calls = 0
  const send: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    calls++
    init!.signal!.addEventListener('abort', () => {
      aborted.resolve()
      reject(init!.signal!.reason)
    }, { once: true })
    started.resolve()
  })
  const checking = checkStandards(root, { mode: 'files', paths: ['tracked.ts'] }, controller.signal, send)
  const stopped = assert.rejects(checking, /Stopped test/)
  await started.promise
  assert.equal(calls, 1)
  controller.abort(new Error('Stopped test'))
  await aborted.promise
  await stopped
  assert.equal(calls, 1)
  assert.equal((await readdir(join(root, '.opencode/.local/standards'))).length, 1)
})

for (const subject of ['source', 'support', 'standards'] as const) {
  for (const change of ['edited', 'deleted'] as const) test(`${subject} ${change} during evaluation invalidates the old finding`, async t => {
    const { root } = await fixture(t)
    await writeFile(join(root, 'helper.ts'), 'export const helper = true\n')
    const judgmentStarted = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const send: typeof fetch = async (_url, init) => {
      const request = Schema.decodeUnknownSync(requestSchema)(JSON.parse(String(init?.body)))
      if (Object.values(request.questions).some(question => question.type === 'choice')) {
        judgmentStarted.resolve()
        await finish.promise
      }
      return reply(request)
    }
    const checking = checkStandards(root, { mode: 'files', paths: ['tracked.ts'], supportingPaths: ['helper.ts'] }, new AbortController().signal, send)
    await judgmentStarted.promise
    const changedPath = subject === 'source' ? 'tracked.ts' : subject === 'support' ? 'helper.ts' : 'CODING_STANDARDS.md'
    if (change === 'edited') await writeFile(join(root, changedPath), 'Edited during review\n')
    else await rm(join(root, changedPath))
    finish.resolve()
    const result = await checking
    assert.match(result, change === 'edited' ? /inconclusive — .*changed during review/ : /inconclusive — ENOENT/)
    assert.match(result, /0 flagged/)
    assert.doesNotMatch(result, /tracked.ts: error_context/)
  })
}
