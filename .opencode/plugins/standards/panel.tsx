import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import type { Context } from '@opencode/plugin/tui/context'
import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import type { ResolvedTheme } from '@opencode/theme/tui'
import type { Citation, Report } from './rpc.ts'

export function reportSummary(report: Report) {
  if (report.status === 'stale') return `Stale · 0 accepted · ${report.diagnostics.length} unaccepted diagnostics`
  const count = (severity: string) => report.diagnostics.filter(diagnostic => diagnostic.severity === severity).length
  return `${report.status === 'complete' ? 'Complete' : 'Incomplete'} · ${count('error')} errors · ${count('warning')} warnings · ${count('information')} information`
}

function Evidence(props: { citation: Citation; label: string; theme: ResolvedTheme }) {
  return <>
    <text flexShrink={0} fg={props.theme.text.subdued} wrapMode="word">{props.label}: {props.citation.path}:{props.citation.startLine}-{props.citation.endLine}</text>
    <text flexShrink={0} fg={props.theme.text.default} wrapMode="word">{props.citation.quote}</text>
    <text flexShrink={0} fg={props.theme.text.subdued} wrapMode="char">SHA256: {props.citation.sha256}</text>
  </>
}

export function ResultsPanel(props: {
  report: Report
  width: number
  focused: boolean
  theme: ResolvedTheme
  keymap: Context['keymap']
}) {
  const [index, setIndex] = createSignal(0)
  const [focus, setFocus] = createSignal<'diagnostics' | 'detail'>('diagnostics')
  const [statusView, setStatusView] = createSignal(false)
  let detail: ScrollBoxRenderable | undefined
  let status: ScrollBoxRenderable | undefined
  createEffect(() => { props.report.artifact; setIndex(0); setFocus('diagnostics') })
  createEffect(() => { index(); statusView(); detail?.scrollTo(0); status?.scrollTo(0) })
  const diagnostics = createMemo(() => props.report.diagnostics.toSorted((a, b) =>
    ({ error: 0, warning: 1, information: 2 })[a.severity] - ({ error: 0, warning: 1, information: 2 })[b.severity]))
  const diagnostic = () => diagnostics()[index()]
  const stale = () => props.report.status === 'stale'
  const wide = () => props.width >= 100
  const detailOnly = () => !wide() && focus() === 'detail'
  const skipped = () => props.report.files.filter(file => file.skipped).length
  const errors = () => props.report.files.filter(file => file.error).length + Number(Boolean(props.report.error))
  const severityColor = (severity: string) => severity === 'error' ? props.theme.text.feedback.error.default
    : severity === 'warning' ? props.theme.text.feedback.warning.default : props.theme.text.default

  props.keymap.layer(() => ({ mode: 'global', enabled: props.focused, commands: [
    { bind: 'left', run: () => { setFocus('diagnostics') } },
    { bind: 'right', run: () => { setFocus('detail') } },
    { bind: 's', run: () => { setStatusView(value => !value) } },
  ] }))

  function scroll(event: KeyEvent) {
    if (event.name !== 'up' && event.name !== 'down') return
    // OpenTUI's fractional viewport step rounds to zero in a short detail pane.
    const pane = statusView() ? status : detail
    pane?.scrollBy(event.name === 'up' ? -1 : 1)
    event.preventDefault()
  }

  return <box flexDirection="column" width="100%" height="100%" paddingX={1} backgroundColor={props.theme.background.default}>
    <box flexDirection="column" flexShrink={0} paddingBottom={1}>
      <text fg={props.theme.text.default}><b>Standards</b></text>
      <text fg={stale() ? props.theme.text.feedback.warning.default : props.theme.text.subdued}>{reportSummary(props.report)}</text>
      <text fg={props.theme.text.subdued}>Source snapshot · {new Date(props.report.time).toLocaleString()} · {props.report.files.length} files · {props.report.mode === 'files' ? 'whole files' : 'changes'}</text>
      <text fg={props.theme.text.subdued}>Model: {props.report.model}</text>
      <text fg={props.theme.text.subdued}>Check status: {props.report.missingEvidence.length} missing context · {skipped()} skipped · {errors()} errors · S inspect</text>
      <Show when={stale()}><text fg={props.theme.text.feedback.warning.default}>Source changed · all diagnostics unaccepted. Run /standards again.</text></Show>
      <Show when={props.report.status === 'incomplete'}><text fg={props.theme.text.feedback.warning.default}>Review incomplete · available diagnostics retained; see S check status.</text></Show>
    </box>
    <Show when={statusView()} fallback={
      <Show when={diagnostics().length} fallback={
        <box flexGrow={1} minHeight={0}>
          <text fg={props.theme.text.subdued} wrapMode="word">{props.report.status === 'complete'
            ? 'No diagnostics from this review. This does not certify the source is correct.'
            : stale() ? 'No accepted diagnostics. The saved source snapshot is stale.'
              : 'No diagnostics available. Review incomplete; press S for check status.'}</text>
        </box>
      }>
        <box flexDirection={wide() ? 'row' : 'column'} flexGrow={1} minHeight={0} gap={1} overflow="hidden">
          <Show when={!detailOnly()}>
            <box flexDirection="column" width={wide() ? '48%' : '100%'} height={wide() ? '100%' : Math.min(diagnostics().length * 2 + 1, 7)} minHeight={2} flexShrink={0}>
              <text fg={focus() === 'diagnostics' ? props.theme.text.default : props.theme.text.subdued}>{stale() ? 'Diagnostics · unaccepted' : 'Diagnostics'}</text>
              <select
                flexGrow={1} minHeight={0} focused={props.focused && focus() === 'diagnostics' && !statusView()}
                options={diagnostics().map(value => ({ name: `${value.location.path}:${value.location.startLine}`, description: `${value.severity} · ${value.message}` }))}
                selectedIndex={index()} showDescription={true} showScrollIndicator={true}
                backgroundColor={props.theme.background.default} textColor={props.theme.text.subdued}
                focusedBackgroundColor={props.theme.background.default} focusedTextColor={props.theme.text.default}
                selectedBackgroundColor={props.theme.background.raised.high} selectedTextColor={props.theme.text.default}
                onChange={setIndex}
              />
            </box>
          </Show>
          {/* Reserve the scrollbar and fractional split-width rounding so evidence is not clipped. */}
          <scrollbox ref={detail} onKeyDown={scroll} flexGrow={1} minWidth={0} minHeight={1} wrapperOptions={{ minHeight: 0 }} viewportOptions={{ minHeight: 0 }} contentOptions={{ paddingRight: 2 }} focused={props.focused && focus() === 'detail' && !statusView()}>
            <Show when={diagnostic()}>{value => <>
              <text flexShrink={0} fg={stale() ? props.theme.text.feedback.warning.default : severityColor(value().severity)} wrapMode="word"><b>{stale() ? 'Unaccepted · ' : ''}{value().severity} · {value().message}</b></text>
              <text flexShrink={0} fg={props.theme.text.subdued} wrapMode="word">Rule: {value().rule}</text>
              <text flexShrink={0} fg={props.theme.text.default} wrapMode="word">Why: {value().explanation}</text>
              <text flexShrink={0} fg={props.theme.text.default} wrapMode="word">Suggestion: {value().suggestion}</text>
              <Evidence citation={value().location} label="Evidence" theme={props.theme} />
              <For each={value().related}>{citation => <Evidence citation={citation} label="Related" theme={props.theme} />}</For>
            </>}</Show>
          </scrollbox>
        </box>
      </Show>
    }>
      <scrollbox ref={status} onKeyDown={scroll} flexGrow={1} minHeight={1} wrapperOptions={{ minHeight: 0 }} viewportOptions={{ minHeight: 0 }} contentOptions={{ paddingRight: 1 }} focused={props.focused && statusView()}>
        <text flexShrink={0} fg={props.theme.text.default}><b>Check status · {props.report.status}</b></text>
        <text flexShrink={0} fg={props.theme.text.subdued} wrapMode="word">Review coverage and execution issues, separate from source diagnostics.</text>
        <Show when={props.report.error}><text flexShrink={0} fg={props.theme.text.feedback.warning.default} wrapMode="word">Review error: {props.report.error}</text></Show>
        <For each={props.report.missingEvidence}>{missing => <>
          <text flexShrink={0} fg={props.theme.text.default} wrapMode="word">Missing context: {missing.path}</text>
          <text flexShrink={0} fg={props.theme.text.subdued} wrapMode="word">Reason: {missing.reason}</text>
          <text flexShrink={0} fg={props.theme.text.default} wrapMode="word">Next action: {missing.nextAction}</text>
        </>}</For>
        <For each={props.report.files}>{file => <>
          <text flexShrink={0} fg={props.theme.text.default} wrapMode="word">{file.path}</text>
          <Show when={file.skipped}><text flexShrink={0} fg={props.theme.text.subdued} wrapMode="word">Skipped: {file.skipped}</text></Show>
          <Show when={file.error}><text flexShrink={0} fg={props.theme.text.feedback.warning.default} wrapMode="word">Check error: {file.error}</text></Show>
          <Show when={!file.skipped && !file.error}><text flexShrink={0} fg={props.theme.text.subdued}>Included in source snapshot</text></Show>
        </>}</For>
        <Show when={!props.report.files.length}><text flexShrink={0} fg={props.theme.text.subdued}>No source files in this report.</text></Show>
      </scrollbox>
    </Show>
    <box flexDirection="column" paddingTop={1} flexShrink={0}>
      <text fg={props.theme.text.subdued}>←→ list/detail ({statusView() ? 'status' : focus()}) · ↑↓ select/scroll</text>
      <text fg={props.theme.text.subdued}>S {statusView() ? 'diagnostics' : 'check status'} · F expand · R refresh · Esc close</text>
    </box>
  </box>
}
