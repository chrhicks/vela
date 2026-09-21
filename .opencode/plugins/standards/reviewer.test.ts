import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { Source } from './evidence.ts'
import { reviewStandards, type GenerateReview, type Review, type ReviewInput, type Target } from './reviewer.ts'
import type { Citation, Diagnostic } from './rpc.ts'

type ModelCitation = Omit<Citation, 'sha256'>
type ModelDiagnostic = Omit<Diagnostic, 'location' | 'related'> & {
  location: ModelCitation
  related: ModelCitation[]
}

function source(path: string, code: string): Source {
  return { path, code, sha256: createHash('sha256').update(code).digest('hex') }
}

const target = source('apps/server/capture.ts', [
  'export async function capture(camera: Camera) {',
  '  try {',
  '    return await camera.expose()',
  '  } catch (error) {',
  "    throw new Error('Capture failed')",
  '  }',
  '}',
].join('\n'))
const contract = source('apps/server/camera-contract.ts', [
  'export interface Camera {',
  '  /** Rejects with the device identity and transport failure. */',
  '  expose(): Promise<Image>',
  '}',
].join('\n'))
const codingStandards = source('CODING_STANDARDS.md', [
  '## Errors, retries, and device commands',
  'Translate low-level failures into stable boundary errors without discarding their meaningful cause.',
].join('\n'))
const guidance = source('AGENTS.md', 'Never report an unconfirmed operation as successful.')
const input: ReviewInput = {
  targets: [target],
  context: [contract],
  standards: codingStandards,
  guidance,
}
const changedTarget: Target = {
  ...target,
  diff: [
    'diff --git a/apps/server/capture.ts b/apps/server/capture.ts',
    '--- a/apps/server/capture.ts',
    '+++ b/apps/server/capture.ts',
    '@@ -4,3 +4,3 @@',
    '   } catch (error) {',
    "-    throw new Error('Capture failed', { cause: error })",
    "+    throw new Error('Capture failed')",
    '   }',
  ].join('\n'),
}

function causeDiagnostic(overrides: Partial<ModelDiagnostic> = {}): ModelDiagnostic {
  return {
    rule: 'error_context',
    severity: 'warning',
    message: 'Capture failure discards the device error',
    explanation: 'The camera rejects with device and transport details, but the replacement error retains neither. The caller cannot distinguish a disconnected device from a failed exposure.',
    suggestion: "Pass { cause: error } to the new Error constructor.",
    location: {
      path: target.path,
      startLine: 5,
      endLine: 5,
      quote: "    throw new Error('Capture failed')",
    },
    related: [{
      path: contract.path,
      startLine: 2,
      endLine: 3,
      quote: '  /** Rejects with the device identity and transport failure. */\n  expose(): Promise<Image>',
    }],
    ...overrides,
  }
}

function response(
  diagnostics: ModelDiagnostic[] = [],
  overrides: {
    reviewedPaths?: string[]
    missingEvidence?: Review['missingEvidence']
  } = {},
) {
  return JSON.stringify({ reviewedPaths: [target.path], diagnostics, missingEvidence: [], ...overrides })
}

function review(raw = response(), overrides: Partial<ReviewInput> = {}) {
  return reviewStandards({ ...input, ...overrides }, async () => raw, new AbortController().signal)
}

function assertRejected(result: Review, reason?: RegExp) {
  assert.equal(result.status, 'incomplete')
  assert.ok(result.error, 'Invalid output must not look like a clean review')
  if (reason) assert.match(result.error, reason)
  assert.deepEqual(result.diagnostics, [], 'Reject the whole response, including earlier valid diagnostics')
  assert.deepEqual(result.missingEvidence, [])
}

test('one direct review receives numbered targets and context and preserves a source-backed cause defect', async () => {
  const diagnostic = causeDiagnostic()
  const raw = response([diagnostic])
  const controller = new AbortController()
  let calls = 0
  let sentPrompt = ''
  const generate: GenerateReview = async (prompt, signal) => {
    calls++
    sentPrompt = prompt
    assert.equal(signal, controller.signal)
    const marker = '\n\nINPUT\n'
    assert.ok(prompt.includes(marker))
    const supplied = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length))
    assert.deepEqual(supplied.requiredReviewedPaths, [target.path])
    assert.deepEqual(supplied.targets, [{
      path: target.path,
      scope: 'changed_lines',
      text: "1: export async function capture(camera: Camera) {\n2:   try {\n3:     return await camera.expose()\n4:   } catch (error) {\n5:     throw new Error('Capture failed')\n6:   }\n7: }",
      diff: changedTarget.diff,
    }])
    assert.deepEqual(supplied.context, [{
      path: contract.path,
      text: '1: export interface Camera {\n2:   /** Rejects with the device identity and transport failure. */\n3:   expose(): Promise<Image>\n4: }',
    }])
    assert.equal(supplied.codingStandards, codingStandards.code)
    assert.equal(supplied.projectGuidance, guidance.code)
    assert.equal(supplied.ruleIds.error_context, 'Errors, retries, and device commands')
    return raw
  }
  const result = await reviewStandards(
    { ...input, targets: [changedTarget] },
    generate,
    controller.signal,
  )
  assert.equal(calls, 1)
  assert.equal(result.error, undefined)
  assert.equal(result.prompt, sentPrompt)
  assert.equal(result.response, raw)
  assert.ok(Number.isFinite(result.milliseconds) && result.milliseconds >= 0)
  assert.deepEqual(result.diagnostics, [{
    ...diagnostic,
    location: { ...diagnostic.location, sha256: target.sha256 },
    related: [{ ...diagnostic.related[0], sha256: contract.sha256 }],
  }])
  assert.deepEqual(result.missingEvidence, [])
})

test('a complete review may report no diagnostics', async () => {
  const result = await review()
  assert.equal(result.error, undefined)
  assert.deepEqual(result.diagnostics, [])
  assert.deepEqual(result.missingEvidence, [])
  assert.equal(result.response, response())
})

test('missing code evidence stays separate from diagnostics and must name a reviewed target', async () => {
  const missing = {
    path: target.path,
    reason: 'The camera rejection contract is unavailable.',
    nextAction: 'Supply apps/server/camera-contract.ts.',
  }
  const result = await review(response([], { missingEvidence: [missing] }), { context: [] })
  assert.equal(result.error, undefined)
  assert.deepEqual(result.diagnostics, [])
  assert.deepEqual(result.missingEvidence, [missing])
  assertRejected(await review(response([causeDiagnostic()], {
    missingEvidence: [{ ...missing, path: 'not-reviewed.ts' }],
  })), /unknown target/)
})

test('a mixed batch explicitly includes whole new files as well as changed-line targets', async () => {
  const result = await reviewStandards(
    { ...input, targets: [changedTarget, contract], context: [] },
    async prompt => {
      const supplied = JSON.parse(prompt.split('\n\nINPUT\n')[1])
      assert.deepEqual(supplied.requiredReviewedPaths, [target.path, contract.path])
      assert.deepEqual(
        supplied.targets.map((target: { scope: string }) => target.scope),
        ['changed_lines', 'whole_file'],
      )
      return response([], { reviewedPaths: [target.path, contract.path] })
    },
    new AbortController().signal,
  )
  assert.equal(result.error, undefined)
})

test('every target must be covered exactly once, including targets without diagnostics', async t => {
  const targets = [target, contract]
  const valid = await review(
    response([causeDiagnostic()], { reviewedPaths: [contract.path, target.path] }),
    { targets, context: [] },
  )
  assert.equal(valid.error, undefined)
  for (const [name, reviewedPaths] of [
    ['omitted', [target.path]],
    ['empty', []],
    ['repeated', [target.path, contract.path, target.path]],
    ['unknown', [target.path, contract.path, 'invented.ts']],
  ] as const) {
    await t.test(name, async () => {
      assertRejected(
        await review(
          response([causeDiagnostic()], { reviewedPaths: [...reviewedPaths] }),
          { targets, context: [] },
        ),
        /omitted targets|Unknown or repeated reviewed target/,
      )
    })
  }
})

test('diagnostics use stable rule IDs rather than headings or invented rules', async t => {
  for (const rule of ['Errors, retries, and device commands', 'preserve_cause', 'toString']) {
    await t.test(rule, async () => {
      assertRejected(
        await review(response([causeDiagnostic(), causeDiagnostic({ rule })])),
        /Unknown standards rule/,
      )
    })
  }
})

test('invalid primary or related citations reject all diagnostics atomically', async t => {
  const diagnostic = causeDiagnostic()
  const cases: { name: string, citation: ModelCitation }[] = [
    { name: 'fabricated quote', citation: { ...diagnostic.location, quote: 'throw error' } },
    { name: 'partial quote', citation: { ...diagnostic.location, quote: 'new Error' } },
    { name: 'numbered quote', citation: { ...diagnostic.location, quote: `5: ${diagnostic.location.quote}` } },
    { name: 'missing source', citation: { ...diagnostic.location, path: 'not-provided.ts' } },
    { name: 'out of range', citation: { ...diagnostic.location, endLine: 40 } },
    { name: 'reversed range', citation: { ...diagnostic.location, startLine: 6 } },
    { name: 'zero-based range', citation: { ...diagnostic.location, startLine: 0 } },
  ]
  for (const { name, citation } of cases) {
    for (const position of ['primary', 'related'] as const) {
      await t.test(`${position}: ${name}`, async () => {
        const invalid = causeDiagnostic(position === 'primary' ? { location: citation } : { related: [citation] })
        assertRejected(await review(response([diagnostic, invalid])))
      })
    }
  }
  assertRejected(
    await review(response([causeDiagnostic({ location: diagnostic.related[0] })])),
    /not a reviewed target/,
  )
})

test('citations tolerate outer whitespace and can relate standards and project guidance', async () => {
  const diagnostic = causeDiagnostic({
    location: { ...causeDiagnostic().location, quote: "throw new Error('Capture failed')" },
    related: [
      { path: codingStandards.path, startLine: 1, endLine: 2, quote: codingStandards.code },
      { path: guidance.path, startLine: 1, endLine: 1, quote: guidance.code },
    ],
  })
  const result = await review(response([diagnostic]))
  assert.equal(result.error, undefined)
  assert.deepEqual(
    result.diagnostics[0].related.map(citation => citation.sha256),
    [codingStandards.sha256, guidance.sha256],
  )
})

test('a replacement cannot be diagnosed solely on its unchanged neighbors', async t => {
  for (const line of [3, 4, 6]) {
    await t.test(`line ${line}`, async () => {
      const location = {
        path: target.path,
        startLine: line,
        endLine: line,
        quote: target.code.split('\n')[line - 1],
      }
      assertRejected(
        await review(response([causeDiagnostic({ location })]), { targets: [changedTarget] }),
        /does not cite the reviewed change/,
      )
    })
  }
})

test('a pure deletion can cite the surviving boundary', async () => {
  const deletedGuard: Target = {
    ...target,
    diff: [
      '@@ -2,4 +2,3 @@',
      '   try {',
      "-    if (!camera.connected) throw new Error('Camera disconnected')",
      '     return await camera.expose()',
      '   } catch (error) {',
    ].join('\n'),
  }
  const diagnostic = causeDiagnostic({
    rule: 'state_persistence',
    message: 'Exposure starts without checking connection state',
    explanation: 'Removing the precondition allows exposure to start on a disconnected camera.',
    suggestion: 'Restore the connection precondition before starting exposure.',
    location: {
      path: target.path,
      startLine: 3,
      endLine: 3,
      quote: '    return await camera.expose()',
    },
    related: [],
  })
  const result = await review(response([diagnostic]), { targets: [deletedGuard] })
  assert.equal(result.error, undefined)
  assert.deepEqual(result.diagnostics[0].location, { ...diagnostic.location, sha256: target.sha256 })
})

test('malformed JSON and invalid diagnostic shapes retain raw output without accepting partial results', async t => {
  for (const [name, raw] of [
    ['malformed JSON', '{"reviewedPaths":['],
    ['incomplete diagnostic', JSON.stringify({
      reviewedPaths: [target.path],
      diagnostics: [causeDiagnostic(), { rule: 'error_context' }],
      missingEvidence: [],
    })],
  ]) {
    await t.test(name, async () => {
      const result = await review(raw)
      assertRejected(result)
      assert.equal(result.response, raw)
    })
  }
})

test('input budget counts UTF-8 bytes and rejects before generation', async () => {
  let calls = 0
  const result = await reviewStandards(
    { ...input, context: [source('docs/large.md', '界'.repeat(60_000))] },
    async () => {
      calls++
      return response()
    },
    new AbortController().signal,
  )
  assert.ok(result.prompt.length < 180_000)
  assert.ok(Buffer.byteLength(result.prompt) > 180_000)
  assertRejected(result, /input exceeds 180 KB/)
  assert.equal(calls, 0)
})

test('output budget counts UTF-8 bytes even when individual diagnostics fit the schema', async () => {
  const raw = response(Array.from({ length: 5 }, () => causeDiagnostic({ explanation: '界'.repeat(3500) })))
  assert.ok(raw.length < 48_000)
  assert.ok(Buffer.byteLength(raw) > 48_000)
  const result = await review(raw)
  assertRejected(result, /response exceeds 48 KB/)
  assert.equal(result.response, undefined)
})

test('cancellation reaches pending generation and rejects instead of returning a review', async () => {
  const controller = new AbortController()
  const started = Promise.withResolvers<void>()
  const transport = Promise.withResolvers<string>()
  let settled = false
  const checking = reviewStandards(
    input,
    async (_prompt, signal) => {
      assert.equal(signal, controller.signal)
      signal.addEventListener('abort', () => transport.reject(signal.reason), { once: true })
      started.resolve()
      return transport.promise
    },
    controller.signal,
  )
  void checking.then(
    () => { settled = true },
    () => { settled = true },
  )
  const stopped = assert.rejects(checking, /Stopped pending review/)
  await started.promise
  assert.equal(settled, false)
  controller.abort(new Error('Stopped pending review'))
  await stopped
  assert.equal(settled, true)
})

test('a successful response arriving after cancellation is never accepted', async () => {
  const controller = new AbortController()
  const started = Promise.withResolvers<void>()
  const transport = Promise.withResolvers<string>()
  let settled = false
  const checking = reviewStandards(
    input,
    async () => {
      started.resolve()
      return transport.promise
    },
    controller.signal,
  )
  void checking.then(
    () => { settled = true },
    () => { settled = true },
  )
  const stopped = assert.rejects(checking, /Stopped before response/)
  await started.promise
  assert.equal(settled, false)
  controller.abort(new Error('Stopped before response'))
  transport.resolve(response([causeDiagnostic()]))
  await stopped
  assert.equal(settled, true)
})
