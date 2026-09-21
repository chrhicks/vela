import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { Effect } from 'effect'
import { checkStandards } from './runner.ts'
import { formatReport, readReport } from './report.ts'

const source = "export function rethrow(error: unknown) {\n  throw new Error('Capture failed')\n}\n"
const guidance = '# Project guidance\nKeep device failure causes visible.\n'
const context = 'The capture boundary must retain the original device failure.\n'
const diagnostic = {
  rule: 'error_context', severity: 'warning', message: 'Original failure is discarded',
  explanation: 'The replacement error drops the device failure, preventing diagnosis of the capture boundary.',
  suggestion: 'Pass the original error as the cause.',
  location: { path: 'tracked.ts', startLine: 2, endLine: 2, quote: "  throw new Error('Capture failed')" },
  related: [{ path: 'contract.md', startLine: 1, endLine: 1, quote: context.trim() }],
}
type PromptInput = {
  targets: { path: string, text: string, diff?: string }[]
  context: { path: string, text: string }[]
  codingStandards: string
  projectGuidance: string
}

function inputFrom(prompt: string): PromptInput {
  assert.ok(prompt.includes('\nINPUT\n'))
  return JSON.parse(prompt.split('\nINPUT\n')[1])
}

function reply(input: PromptInput, diagnostics = [] as typeof diagnostic[]) {
  return JSON.stringify({ reviewedPaths: input.targets.map(target => target.path), diagnostics, missingEvidence: [] })
}

function hash(text: string) {
  return createHash('sha256').update(text).digest('hex')
}

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'standards-runner-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '--quiet')
  const standards = await readFile(new URL('../../../CODING_STANDARDS.md', import.meta.url), 'utf8')
  await writeFile(join(root, 'CODING_STANDARDS.md'), standards)
  await writeFile(join(root, 'AGENTS.md'), guidance)
  await writeFile(join(root, '.gitignore'), 'ignored.ts\n.opencode/.local/\n')
  await writeFile(join(root, 'tracked.ts'), source)
  await writeFile(join(root, 'contract.md'), context)
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'Fixture')
  return { root, git, standards }
}

test('a real message-less Effect timeout remains incomplete through persistence and projection', async t => {
  const { root } = await fixture(t)
  const result = await checkStandards(root, { mode: 'files', paths: ['tracked.ts'] }, new AbortController().signal, {
    model: 'test-reviewer',
    generate: (_prompt, signal) => Effect.runPromise(Effect.never.pipe(Effect.timeout('5 millis')), { signal }),
  })
  assert.match(result.content, /Standards review · incomplete/)
  assert.match(result.content, /TimeoutError/)
  assert.doesNotMatch(result.content, /No diagnostics reported/)
  const saved = JSON.parse(await readFile(result.artifact, 'utf8'))
  assert.equal(saved.review.status, 'incomplete')
  assert.equal(saved.review.error, 'TimeoutError')
  assert.equal(saved.review.response, undefined)
  assert.equal((await readReport(result.artifact)).status, 'incomplete')

  // Reopening a pre-fix artifact must not perpetuate the false-complete result.
  saved.report.status = 'complete'
  delete saved.report.error
  delete saved.review.status
  delete saved.review.error
  await writeFile(result.artifact, JSON.stringify(saved))
  const projected = await readReport(result.artifact)
  assert.equal(projected.status, 'incomplete')
  assert.deepEqual(projected.diagnostics, [])
  assert.match(projected.error!, /no model response/)
})

test('a multi-file batch makes one direct call with numbered source, docs context, and project standards', async t => {
  const { root, standards } = await fixture(t)
  await writeFile(join(root, 'second.ts'), 'export const second = true\n')
  const inputs: PromptInput[] = []
  const result = await checkStandards(root, {
    mode: 'files', paths: ['tracked.ts', 'second.ts'], supportingPaths: ['contract.md'],
  }, new AbortController().signal, {
    model: 'test-reviewer', generate: async prompt => {
      const input = inputFrom(prompt)
      inputs.push(input)
      return reply(input)
    },
  })
  assert.equal(inputs.length, 1)
  assert.deepEqual(inputs[0].targets, [
    { path: 'tracked.ts', scope: 'whole_file', text: "1: export function rethrow(error: unknown) {\n2:   throw new Error('Capture failed')\n3: }\n4: " },
    { path: 'second.ts', scope: 'whole_file', text: '1: export const second = true\n2: ' },
  ])
  assert.deepEqual(inputs[0].context, [{ path: 'contract.md', text: `1: ${context.trim()}\n2: ` }])
  assert.equal(inputs[0].codingStandards, standards)
  assert.equal(inputs[0].projectGuidance, guidance)
  assert.equal((await readReport(result.artifact)).status, 'complete')
  assert.match(result.content, /0 diagnostics · 2 targets supplied/)
})

test('changes mode supplies staged and untracked source together with the tracked diff', async t => {
  const { root, git } = await fixture(t)
  await writeFile(join(root, 'tracked.ts'), 'export const changed = true\n')
  git('add', 'tracked.ts')
  await writeFile(join(root, 'new.ts'), 'export const added = true\n')
  const inputs: PromptInput[] = []
  const result = await checkStandards(root, {}, new AbortController().signal, {
    model: 'test-reviewer', generate: async prompt => {
      const input = inputFrom(prompt)
      inputs.push(input)
      return reply(input)
    },
  })
  assert.equal(inputs.length, 1)
  assert.deepEqual(inputs[0].targets.map(target => target.path).sort(), ['new.ts', 'tracked.ts'])
  const tracked = inputs[0].targets.find(target => target.path === 'tracked.ts')!
  assert.equal(tracked.text, '1: export const changed = true\n2: ')
  assert.match(tracked.diff!, /\+export const changed = true/)
  assert.match(tracked.diff!, /-export function rethrow/)
  assert.deepEqual(inputs[0].targets.find(target => target.path === 'new.ts'), {
    path: 'new.ts', scope: 'whole_file', text: '1: export const added = true\n2: ',
  })
  assert.equal((await readReport(result.artifact)).status, 'complete')
})

test('ignored, symlinked, secret-named, and oversized targets never reach inference', async t => {
  const { root } = await fixture(t)
  const outside = await mkdtemp('/tmp/opencode/standards-outside-')
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'outside.ts'), 'fixture-only excluded content')
  await symlink(join(outside, 'outside.ts'), join(root, 'linked.ts'))
  await writeFile(join(root, 'ignored.ts'), 'fixture-only excluded content')
  await writeFile(join(root, 'secrets.ts'), 'fixture-only excluded content')
  await writeFile(join(root, 'large.ts'), 'x'.repeat(40_001))
  let calls = 0
  const result = await checkStandards(root, {
    mode: 'files', paths: ['ignored.ts', 'linked.ts', 'secrets.ts', 'large.ts'],
  }, new AbortController().signal, {
    model: 'test-reviewer', generate: async () => { calls++; throw new Error('Unexpected inference') },
  })
  assert.equal(calls, 0)
  const report = await readReport(result.artifact)
  assert.equal(report.status, 'incomplete')
  assert.equal(report.files.length, 4)
  assert.match(report.files[0].error!, /Git-ignored/)
  assert.match(report.files[1].error!, /symlinks are not allowed/)
  assert.match(report.files[2].error!, /outside the allowed checkout context/)
  assert.match(report.files[3].error!, /exceeds 40000 bytes/)
  const saved = await readFile(result.artifact, 'utf8')
  assert.doesNotMatch(saved, /fixture-only excluded content/)
})

test('a valid diagnostic is saved and projected exactly, including source-backed related evidence', async t => {
  const { root } = await fixture(t)
  const result = await checkStandards(root, {
    mode: 'files', paths: ['tracked.ts'], supportingPaths: ['contract.md'],
  }, new AbortController().signal, {
    model: 'test-reviewer', generate: async prompt => reply(inputFrom(prompt), [diagnostic]),
  })
  const saved = JSON.parse(await readFile(result.artifact, 'utf8'))
  const report = await readReport(result.artifact)
  assert.equal(saved.schemaVersion, 3)
  assert.deepEqual(report, saved.report)
  assert.equal(report.status, 'complete')
  assert.equal(report.model, 'test-reviewer')
  assert.deepEqual(report.diagnostics, [{
    ...diagnostic, location: { ...diagnostic.location, sha256: hash(source) },
    related: [{ ...diagnostic.related[0], sha256: hash(context) }],
  }])
  assert.deepEqual(JSON.parse(saved.review.response).diagnostics, [diagnostic])
  assert.equal(result.content, formatReport(report))
  assert.match(result.content, /tracked.ts:2-2 · warning · error_context/)
  assert.ok(result.content.includes(diagnostic.explanation))
  assert.ok(result.content.includes(diagnostic.suggestion))
  assert.ok(result.content.includes(result.artifact))
})

test('model failure persists an incomplete review without accepted diagnostics', async t => {
  const { root } = await fixture(t)
  const result = await checkStandards(root, { mode: 'files', paths: ['tracked.ts'] }, new AbortController().signal, {
    model: 'test-reviewer', generate: async () => { throw new Error('Model unavailable') },
  })
  const report = await readReport(result.artifact)
  assert.equal(report.status, 'incomplete')
  assert.match(report.error!, /Model unavailable/)
  assert.deepEqual(report.diagnostics, [])
  assert.deepEqual(report.missingEvidence, [])
  assert.match(result.content, /Incomplete or stale review is not a clean check/)
})

test('aborting pending generation saves an incomplete artifact and rejects late valid output', { timeout: 10_000 }, async t => {
  const { root } = await fixture(t)
  const controller = new AbortController()
  const started = Promise.withResolvers<AbortSignal>()
  const finish = Promise.withResolvers<void>()
  const checking = checkStandards(root, {
    mode: 'files', paths: ['tracked.ts'], supportingPaths: ['contract.md'],
  }, controller.signal, {
    model: 'test-reviewer', generate: async (prompt, signal) => {
      started.resolve(signal)
      await finish.promise
      return reply(inputFrom(prompt), [diagnostic])
    },
  })
  const rejected = assert.rejects(checking, /Stopped test/)
  const generationSignal = await started.promise
  controller.abort(new Error('Stopped test'))
  assert.equal(generationSignal.aborted, true)
  finish.resolve()
  await rejected
  const directory = join(root, '.opencode/.local/standards')
  const artifacts = await readdir(directory)
  assert.equal(artifacts.length, 1)
  const report = await readReport(join(directory, artifacts[0]))
  assert.equal(report.status, 'incomplete')
  assert.match(report.error!, /Stopped test/)
  assert.deepEqual(report.diagnostics, [])
  assert.deepEqual(report.missingEvidence, [])
})

for (const path of ['tracked.ts', 'contract.md', 'CODING_STANDARDS.md']) {
  test(`editing ${path} during generation makes the returned review stale`, { timeout: 10_000 }, async t => {
    const { root } = await fixture(t)
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const checking = checkStandards(root, {
      mode: 'files', paths: ['tracked.ts'], supportingPaths: ['contract.md'],
    }, new AbortController().signal, {
      model: 'test-reviewer', generate: async prompt => {
        started.resolve()
        await finish.promise
        return reply(inputFrom(prompt), [diagnostic])
      },
    })
    await started.promise
    await writeFile(join(root, path), 'Edited during review\n')
    finish.resolve()
    const result = await checking
    const saved = JSON.parse(await readFile(result.artifact, 'utf8'))
    assert.equal(saved.report.status, 'stale')
    assert.ok(saved.report.error.includes(path))
    assert.match(result.content, /Saved diagnostics are unaccepted/)
    assert.match(result.content, /0 diagnostics/)
    assert.ok(!result.content.includes(diagnostic.message))
  })
}

for (const path of ['tracked.ts', 'AGENTS.md']) {
  test(`editing ${path} after completion makes readReport stale`, async t => {
    const { root } = await fixture(t)
    const result = await checkStandards(root, { mode: 'files', paths: ['tracked.ts'] }, new AbortController().signal, {
      model: 'test-reviewer', generate: async prompt => reply(inputFrom(prompt)),
    })
    assert.equal((await readReport(result.artifact)).status, 'complete')
    await writeFile(join(root, path), 'Edited after review\n')
    const report = await readReport(result.artifact)
    assert.equal(report.status, 'stale')
    assert.equal(report.error, `${path} changed since this review`)
    assert.match(formatReport(report), /Incomplete or stale review is not a clean check/)
  })
}

test('missing code evidence remains separate from a source-backed warning', async t => {
  const { root } = await fixture(t)
  const missing = { path: 'tracked.ts', reason: 'The caller contract is absent.', nextAction: 'Supply the capture caller source.' }
  const result = await checkStandards(root, {
    mode: 'files', paths: ['tracked.ts'], supportingPaths: ['contract.md'],
  }, new AbortController().signal, {
    model: 'test-reviewer', generate: async () => JSON.stringify({
      reviewedPaths: ['tracked.ts'], diagnostics: [diagnostic], missingEvidence: [missing],
    }),
  })
  const report = await readReport(result.artifact)
  assert.equal(report.status, 'incomplete')
  assert.deepEqual(report.missingEvidence, [missing])
  assert.equal(report.diagnostics.length, 1)
  assert.equal(report.diagnostics[0].severity, 'warning')
  assert.equal(report.diagnostics[0].message, diagnostic.message)
  assert.match(result.content, /Missing evidence for tracked.ts: The caller contract is absent/)
  assert.match(result.content, /1 diagnostics · 1 targets supplied · 1 unresolved code questions/)
})

test('legacy JSON reports explain the legacy format and retain the raw artifact path', async t => {
  const { root } = await fixture(t)
  const artifact = join(root, 'legacy-report.json')
  const original = JSON.stringify({ schemaVersion: 2, files: [{ path: 'tracked.ts', failed: ['error_context'] }] })
  await writeFile(artifact, original)
  const report = await readReport(artifact)
  assert.equal(report.status, 'incomplete')
  assert.equal(report.model, 'legacy')
  assert.equal(report.artifact, artifact)
  assert.deepEqual(report.diagnostics, [])
  assert.match(report.error!, /Legacy detector report.*original JSON.*artifact path/)
  assert.ok(formatReport(report).includes(artifact))
  assert.equal(await readFile(artifact, 'utf8'), original)
})
