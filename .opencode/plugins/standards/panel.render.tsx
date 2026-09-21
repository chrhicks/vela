// From .opencode: bun --preload @opentui/solid/preload plugins/standards/panel.render.tsx
// Native rendering stays separate from the Node-only *.test.ts suite.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { testRender } from '@opentui/solid'
import { createSignal } from 'solid-js'
import { Schema } from 'effect'
import type { Context } from '@opencode/plugin/tui/context'
import { DEFAULT_THEME, resolveThemeDocument } from '@opencode/theme/tui'
import { ResultsPanel } from './panel.tsx'
import { reportSchema, type Report } from './rpc.ts'

const theme = resolveThemeDocument(DEFAULT_THEME, 'dark')
const explanation = 'The UI reports success after starting the request, before the device confirms completion. '
  + 'The returned promise only acknowledges dispatch; it does not establish the physical outcome. '
  + 'A later read can still report an interrupted exposure. The starting state must stay distinct from confirmed completion.'
const report = Schema.decodeUnknownSync(reportSchema)({
  artifact: 'render-fixture.json',
  time: '2026-09-20T12:00:00Z',
  mode: 'changes',
  schemaVersion: 3,
  model: 'fixture/luna',
  status: 'complete',
  missingEvidence: [],
  files: [{ path: 'apps/server/src/capture.ts' }, { path: 'packages/alpaca/src/camera.ts' }],
  diagnostics: [
    {
      rule: 'readability.names',
      severity: 'information',
      message: 'Name the observed state',
      explanation: 'The value represents the last observed device state.',
      suggestion: 'Use observedState.',
      location: {
        path: 'apps/server/src/capture.ts',
        startLine: 60,
        endLine: 60,
        quote: 'const state = readState()',
        sha256: 'b'.repeat(64),
      },
      related: [],
    },
    {
      rule: 'error_context.confirmation',
      severity: 'error',
      message: 'Success before confirmation',
      explanation,
      suggestion: 'Publish completion only after the device confirms it.',
      location: {
        path: 'apps/server/src/capture.ts',
        startLine: 41,
        endLine: 55,
        quote: [
          'startExposure()',
          'publishSuccess()',
          ...Array.from({ length: 12 }, (_, index) => `// device observation ${index + 1}: still pending`),
          'return unconfirmedResult',
        ].join('\n'),
        sha256: 'a'.repeat(64),
      },
      related: [{
        path: 'packages/alpaca/src/camera.ts',
        startLine: 11,
        endLine: 12,
        quote: 'await dispatchExposure()\nreturn { dispatched: true }',
        sha256: 'c'.repeat(64),
      }],
    },
    {
      rule: 'error_context.cause',
      severity: 'warning',
      message: 'Original cause is lost',
      explanation: 'The replacement error drops the transport failure.',
      suggestion: 'Preserve the original error as cause.',
      location: {
        path: 'apps/server/src/capture.ts',
        startLine: 70,
        endLine: 70,
        quote: 'throw new Error("Capture failed")',
        sha256: 'd'.repeat(64),
      },
      related: [],
    },
  ],
})
const incomplete: Report = {
  ...report,
  artifact: 'incomplete.json',
  status: 'incomplete',
  error: 'Review stopped before all source was checked.',
  missingEvidence: [{
    path: 'packages/alpaca/src/validation.ts',
    reason: 'Adapter contract was not supplied.',
    nextAction: 'Include the adapter validation contract in the next review.',
  }],
  files: [
    ...report.files,
    { path: 'assets/image.png', skipped: 'Binary file excluded.' },
    { path: 'apps/server/src/missing.ts', error: 'Source could not be read.' },
  ],
}

const output = fileURLToPath(new URL('../../.local/panel-render/', import.meta.url))
await mkdir(output, { recursive: true })

for (const [width, height] of [[120, 36], [72, 28]]) {
  type Layer = {
    enabled: boolean
    commands: { bind: string; run: () => void }[]
  }
  let layer: (() => Layer) | undefined
  // Only host section/view bindings are mocked. Selection and scrolling use
  // OpenTUI's actual input dispatcher and focus handling.
  const keymap = { layer: (input: () => Layer) => { layer = input } } as unknown as Context['keymap']
  const [currentReport, setReport] = createSignal(report)
  const screen = await testRender(
    () => (
      <ResultsPanel
        report={currentReport()}
        width={width}
        focused={true}
        theme={theme}
        keymap={keymap}
      />
    ),
    { width, height },
  )
  const captures: string[] = []
  function capture(label: string) {
    const frame = screen.captureCharFrame()
    captures.push(`${label}\n${frame}`)
    return frame
  }
  function normalized(text: string) {
    // Scrollbar glyphs are terminal chrome between wrapped source lines.
    return text.replace(/[█▀▄]/g, ' ').replace(/\s+/g, ' ')
  }
  function includes(text: string, expected: string) {
    assert.ok(normalized(text).includes(expected), `${width}x${height}: missing ${JSON.stringify(expected)}`)
  }
  function detailText(frame: string) {
    // The adjacent list must not be interleaved with wrapped detail text.
    return width >= 100
      ? frame.split('\n').map(line => line.slice(Math.round((width - 2) * 0.48) + 2)).join('\n')
      : frame
  }
  async function command(bind: string) {
    const current = layer?.()
    assert.ok(current?.enabled, 'Panel keymap must be enabled')
    const action = current.commands.find(command => command.bind === bind)
    assert.ok(action, `Missing binding: ${bind}`)
    action.run()
    await screen.flush()
  }
  async function arrow(direction: 'up' | 'down') {
    screen.mockInput.pressArrow(direction)
    await screen.flush()
  }
  async function scrollToEnd(label: string, onlyDetail = false) {
    const frames = [capture(`${label}: top`)]
    for (let step = 0; step < 120; step++) {
      await arrow('down')
      const frame = screen.captureCharFrame()
      if (frame === frames.at(-1)) break
      frames.push(capture(`${label}: down ${step + 1}`))
      assert.ok(step < 119, 'Scrolling did not settle')
    }
    return frames.map(frame => onlyDetail ? detailText(frame) : frame).join('\n')
  }
  async function show(next: Report, label: string) {
    setReport(next)
    await screen.flush()
    return capture(label)
  }
  try {
    await screen.flush()
    const initial = capture('Diagnostic list')
    includes(initial, 'Complete · 1 errors · 1 warnings · 1 information')
    includes(initial, 'Source snapshot')
    includes(initial, new Date(report.time).toLocaleString())
    includes(initial, 'Model: fixture/luna')
    includes(initial, 'apps/server/src/capture.ts:41')
    includes(initial, 'error · Success before confirmation')
    await command('right')
    const top = capture('Error detail focused')
    includes(top, 'Rule: error_context.confirmation')
    includes(detailText(top), `Why: ${explanation}`)
    const detail = await scrollToEnd('Exact evidence', true)
    includes(detail, 'Suggestion: Publish completion only after the device confirms it.')
    includes(detail, 'Evidence: apps/server/src/capture.ts:41-55')
    includes(detail, 'return unconfirmedResult')
    includes(detail, 'Related: packages/alpaca/src/camera.ts:11-12')
    includes(detail, 'await dispatchExposure()')
    includes(detail, 'return { dispatched: true }')
    const errorDiagnostic = report.diagnostics.find(diagnostic => diagnostic.severity === 'error')!
    includes(detail, normalized(errorDiagnostic.location.quote))
    includes(detail, normalized(errorDiagnostic.related[0].quote))
    // Long hashes can wrap mid-token; remove whitespace to assert every byte.
    assert.ok(detail.replace(/\s|[█▀▄]/g, '').includes(`SHA256:${'a'.repeat(64)}`))
    assert.ok(detail.replace(/\s|[█▀▄]/g, '').includes(`SHA256:${'c'.repeat(64)}`))
    assert.notEqual(screen.captureCharFrame(), top, 'Long evidence must scroll')
    const bottom = screen.captureCharFrame()
    await arrow('up')
    assert.notEqual(screen.captureCharFrame(), bottom, 'Up must scroll back')
    await command('left')
    await arrow('down')
    await command('right')
    includes(capture('Warning selected'), 'warning · Original cause is lost')
    await command('left')
    await arrow('down')
    await command('right')
    includes(capture('Information selected'), 'information · Name the observed state')

    const partial = await show(incomplete, 'Incomplete review')
    includes(partial, 'Incomplete · 1 errors · 1 warnings · 1 information')
    includes(partial, 'available diagnostics retained')
    includes(partial, '1 missing context · 1 skipped · 2 errors')
    assert.ok(!partial.includes('unaccepted'), 'Incomplete review must retain valid diagnostics')
    await command('s')
    const checkStatus = await scrollToEnd('Separate check status')
    includes(checkStatus, 'Check status · incomplete')
    includes(checkStatus, 'Review error: Review stopped before all source was checked.')
    includes(checkStatus, 'Missing context: packages/alpaca/src/validation.ts')
    includes(checkStatus, 'Reason: Adapter contract was not supplied.')
    includes(checkStatus, 'Next action: Include the adapter validation contract in the next review.')
    includes(checkStatus, 'Skipped: Binary file excluded.')
    includes(checkStatus, 'Check error: Source could not be read.')
    await command('s')
    includes(capture('Return to diagnostics'), 'error · Success before confirmation')

    await show(
      { ...incomplete, artifact: 'empty-incomplete.json', diagnostics: [] },
      'Incomplete without diagnostics',
    )
    includes(screen.captureCharFrame(), 'No diagnostics available. Review incomplete')
    await command('s')
    includes(await scrollToEnd('Status without diagnostics'), 'Source could not be read.')
    await command('s')

    const stale = await show({ ...report, artifact: 'stale.json', status: 'stale' }, 'Stale review')
    includes(stale, 'Stale · 0 accepted · 3 unaccepted diagnostics')
    includes(stale, 'all diagnostics unaccepted')
    await command('right')
    includes(capture('Stale detail'), 'Unaccepted · error · Success before confirmation')

    const empty = await show(
      { ...report, artifact: 'empty-complete.json', diagnostics: [], files: [] },
      'Complete without diagnostics',
    )
    includes(empty, 'No diagnostics from this review. This does not certify the source is correct.')
    await command('s')
    includes(capture('Status without files'), 'No source files in this report.')
    console.log(`PASS diagnostics, evidence scrolling, separate status, incomplete and stale: ${width}x${height}`)
  } finally {
    capture('Final frame')
    await writeFile(`${output}/${width}x${height}.txt`, captures.join('\n\n'))
    screen.renderer.destroy()
  }
}
console.log(`Terminal captures: ${output}`)
