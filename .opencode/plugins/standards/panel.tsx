import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import type { Context } from '@opencode/plugin/tui/context'
import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import type { ResolvedTheme } from '@opencode/theme/tui'
import type { Report, ReportFile } from './rpc.ts'

function title(id: string) {
  return id.replaceAll('_', ' ').replaceAll('.', ' / ').replace(/^./, letter => letter.toUpperCase())
}

function fileStatus(file: ReportFile) {
  if (file.error) return 'Incomplete'
  if (file.failed.length) return 'Flagged'
  if (file.inconclusive.length) return 'Needs context'
  if (file.skipped) return 'Skipped'
  if (!file.checks.length) return 'No rules selected'
  return 'No findings'
}

function verdictLabel(verdict: string) {
  return ({ met: 'Met', violated: 'Flagged', insufficient_context: 'Needs context', not_applicable: 'Not applicable' })[verdict] ?? verdict
}

export function reportSummary(report: Report) {
  const flagged = report.files.filter(file => file.failed.length).length
  const uncertain = report.files.filter(file => file.error || file.inconclusive.length).length
  const skipped = report.files.filter(file => file.skipped).length
  return `${report.files.length} files · ${flagged} flagged · ${uncertain} inconclusive${skipped ? ` · ${skipped} skipped` : ''}`
}

export function ResultsPanel(props: {
  report: Report
  width: number
  focused: boolean
  theme: ResolvedTheme
  keymap: Context['keymap']
}) {
  const [fileIndex, setFileIndex] = createSignal(0)
  const [checkIndex, setCheckIndex] = createSignal(0)
  const [focus, setFocus] = createSignal<'files' | 'checks' | 'detail'>('files')
  const [routing, setRouting] = createSignal(false)
  let detail: ScrollBoxRenderable | undefined
  createEffect(() => { props.report.artifact; setFileIndex(0); setCheckIndex(0) })
  const files = createMemo(() => props.report.files.toSorted((a, b) =>
    Number(Boolean(b.failed.length || b.inconclusive.length || b.error)) - Number(Boolean(a.failed.length || a.inconclusive.length || a.error))))
  const file = () => files()[fileIndex()]
  const rank = (verdict: string) => verdict === 'violated' ? 0 : verdict === 'insufficient_context' ? 1 : 2
  const checks = createMemo(() => (file()?.checks ?? []).toSorted((a, b) => rank(a.verdict) - rank(b.verdict)))
  const check = () => checks()[checkIndex()]
  const wide = () => props.width >= 100
  const color = (verdict: string) => verdict === 'violated' ? props.theme.text.feedback.error.default
    : verdict === 'insufficient_context' ? props.theme.text.feedback.warning.default : props.theme.text.default

  props.keymap.layer(() => ({ mode: 'global', enabled: props.focused, commands: [
    { bind: 'left', run: () => { setFocus(value => value === 'detail' ? 'checks' : 'files') } },
    { bind: 'right', run: () => { setFocus(value => value === 'files' || routing() || !checks().length ? 'checks' : 'detail') } },
    { bind: 'a', run: () => { setRouting(value => !value); setFocus('checks') } },
  ] }))

  function scrollDetail(event: KeyEvent) {
    if (event.name !== 'up' && event.name !== 'down') return
    // OpenTUI's fractional viewport step rounds to zero in a short detail pane.
    detail?.scrollBy(event.name === 'up' ? -1 : 1)
    event.preventDefault()
  }

  return <box flexDirection="column" width="100%" height="100%" paddingX={1} backgroundColor={props.theme.background.default}>
    <box flexDirection="column" flexShrink={0} paddingBottom={1}>
      <text fg={props.theme.text.default}><b>Standards</b></text>
      <text fg={props.theme.text.subdued}>{reportSummary(props.report)}</text>
      <text fg={props.theme.text.subdued}>Saved {new Date(props.report.time).toLocaleString()} · {props.report.mode === 'files' ? 'whole files' : 'changes'}</text>
    </box>
    <Show when={files().length} fallback={<text fg={props.theme.text.subdued}>This run contained no files to evaluate.</text>}>
      <box flexDirection={wide() ? 'row' : 'column'} flexGrow={1} minHeight={0} gap={1} overflow="hidden">
        <box flexDirection="column" width={wide() ? '34%' : '100%'} height={wide() ? '100%' : Math.min(files().length + 1, 5)} minHeight={2} flexShrink={wide() ? 0 : 1}>
          <text fg={focus() === 'files' ? props.theme.text.default : props.theme.text.subdued}>Files</text>
          <select
            flexGrow={1} minHeight={0} focused={props.focused && focus() === 'files'}
            options={files().map(file => ({ name: `${file.failed.length ? '!' : file.error || file.inconclusive.length ? '?' : '·'} ${file.path.split('/').at(-1)}  ${fileStatus(file)}`, description: file.path }))}
            selectedIndex={fileIndex()} showDescription={false} showScrollIndicator={true}
            backgroundColor={props.theme.background.default} textColor={props.theme.text.subdued}
            focusedBackgroundColor={props.theme.background.default} focusedTextColor={props.theme.text.default}
            selectedBackgroundColor={props.theme.background.raised.high} selectedTextColor={props.theme.text.default}
            onChange={index => { setFileIndex(index); setCheckIndex(0) }}
          />
        </box>
        <box flexDirection="column" flexGrow={1} minHeight={0} minWidth={0}>
          <text flexShrink={0} fg={props.theme.text.default}>{file()?.path}</text>
          <Show when={file()?.error || file()?.skipped}>
            <text flexShrink={0} fg={props.theme.text.feedback.warning.default}>{file()?.error ?? file()?.skipped}</text>
            <text flexShrink={0} fg={props.theme.text.subdued}>Saved answers below are not an accepted result for this file.</text>
          </Show>
          <text flexShrink={0} fg={focus() === 'checks' ? props.theme.text.default : props.theme.text.subdued}>{routing() ? `Applicability · selected only above ${Math.round(props.report.threshold * 100)}%` : 'Judgments · concerns first · P(answer)'}</text>
          <Show when={!routing()} fallback={
            <scrollbox flexGrow={1} minHeight={0} focused={props.focused && focus() === 'checks'}>
              <For each={Object.entries(file()?.applicability ?? {})}>{([id, probability]) =>
                <text fg={probability > props.report.threshold ? props.theme.text.default : props.theme.text.subdued}>
                  {`${probability > props.report.threshold ? '+' : '·'} ${title(id)}  ${Math.round(probability * 100)}%${probability > props.report.threshold ? ' · selected' : ' · not selected'}`}
                </text>
              }</For>
            </scrollbox>
          }>
            <Show when={checks().length} fallback={<text fg={props.theme.text.subdued}>No specific judgments were returned for this file.</text>}>
              <select
                flexGrow={1} flexBasis={0} minHeight={2} focused={props.focused && focus() === 'checks'}
                options={checks().map(check => ({ name: `${check.verdict === 'violated' ? '!' : check.verdict === 'insufficient_context' ? '?' : '·'} ${title(check.id)}  ${verdictLabel(check.verdict)} ${Math.round(check.probability * 100)}%`, description: check.question }))}
                selectedIndex={checkIndex()} showDescription={false} showScrollIndicator={true}
                backgroundColor={props.theme.background.default} textColor={props.theme.text.subdued}
                focusedBackgroundColor={props.theme.background.default} focusedTextColor={props.theme.text.default}
                selectedBackgroundColor={props.theme.background.raised.high} selectedTextColor={props.theme.text.default}
                onChange={setCheckIndex}
              />
              <box flexDirection="column" flexShrink={0} paddingTop={1}>
                <text fg={color(check()?.verdict ?? '')}><b>{verdictLabel(check()?.verdict ?? '')}</b> · {Math.round((check()?.probability ?? 0) * 100)}% probability</text>
                <text fg={props.theme.text.subdued}>Confidence {Math.round((check()?.confidence ?? 0) * 100)}% · model judgment, not proof</text>
              </box>
              <scrollbox ref={detail} onKeyDown={scrollDetail} flexGrow={1} flexBasis={0} minHeight={1} wrapperOptions={{ minHeight: 0 }} viewportOptions={{ minHeight: 0 }} focused={props.focused && focus() === 'detail'}>
                <text flexShrink={0} fg={props.theme.text.default} wrapMode="word">{check()?.question}</text>
                <text flexShrink={0} fg={props.theme.text.subdued} wrapMode="word">{Object.entries(check()?.probabilities ?? {}).map(([verdict, p]) => `${verdictLabel(verdict)} ${Math.round(p * 100)}%`).join(' · ')}</text>
              </scrollbox>
            </Show>
          </Show>
        </box>
      </box>
    </Show>
    <box flexDirection="column" paddingTop={1} flexShrink={0}>
      <text fg={props.theme.text.subdued}>←→ sections ({focus()}) · ↑↓ select/scroll · A applicability · F expand · R refresh · Esc close</text>
    </box>
  </box>
}
