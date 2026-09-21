import { Plugin, usePlugin } from '@opencode/plugin/tui'
import { Show, createResource, onCleanup } from 'solid-js'
import type { PanelInput } from '@opencode/plugin/tui/context'
import { StandardsResults } from './rpc.ts'
import { ResultsPanel, reportSummary } from './panel.tsx'

function useReport(sessionID: () => string) {
  const context = usePlugin()
  const rpc = context.client.rpc(StandardsResults)
  const [report, { refetch }] = createResource(sessionID, id => rpc.latest({ sessionID: id }, {
    location: context.data.session.get(id)?.location ?? context.location ?? context.data.location.default(),
  }))
  onCleanup(rpc.events.on('updated', event => {
    if (event.data.sessionID === sessionID()) void refetch()
  }))
  return { report, refetch }
}

function Panel(props: { panel: PanelInput }) {
  const context = usePlugin()
  const { report, refetch } = useReport(() => props.panel.sessionID)
  context.keymap.layer(() => ({
    mode: 'global',
    enabled: props.panel.focused,
    commands: [
      { bind: 'r', run: () => { void refetch() } },
      { bind: 'escape', run: props.panel.close },
      { bind: 'f', run: props.panel.toggleFullscreen },
    ],
  }))
  return (
    <Show
      when={!report.error}
      fallback={
        <box flexDirection="column" padding={1}>
          <text fg={context.theme.text.feedback.error.default}>
            Could not load standards results: {String(report.error)}
          </text>
          <text fg={context.theme.text.subdued}>R retry · Esc close</text>
        </box>
      }
    >
      <Show
        when={report()}
        fallback={
          <box padding={1}>
            <text fg={context.theme.text.subdued}>
              {report.loading
                ? 'Loading standards results…'
                : 'No saved standards review in this session yet. Run /standards first.'}
            </text>
          </box>
        }
      >
        {value => (
          <ResultsPanel
            report={value()}
            width={props.panel.width}
            focused={props.panel.focused}
            theme={context.theme}
            keymap={context.keymap}
          />
        )}
      </Show>
    </Show>
  )
}

function Indicator(props: { sessionID: string }) {
  const context = usePlugin()
  const { report } = useReport(() => props.sessionID)
  return (
    <Show when={!report.error && report()}>
      {value => (
        <box paddingX={1} onMouseDown={() => context.ui.panel.open('vela.standards.results')}>
          <text fg={context.theme.text.subdued}>
            Saved standards · {reportSummary(value())} · <b>inspect /standards-results</b>
          </text>
        </box>
      )}
    </Show>
  )
}

export default Plugin.define({
  id: 'vela.standards.panel',
  setup(context) {
    const command = context.ui.slot({
      append: 'app',
      render: () => {
        context.keymap.layer(() => ({
          mode: 'global',
          commands: [{
            id: 'vela.standards.results',
            title: 'Inspect standards results',
            group: 'Vela',
            palette: true,
            slash: { name: 'standards-results' },
            run: () => { context.ui.panel.open('vela.standards.results') },
          }],
        }))
        return null
      },
    })
    const panel = context.ui.slot({
      append: 'session.panel',
      render: props => (
        <Show when={props.name === 'vela.standards.results'}>
          <Panel panel={props} />
        </Show>
      ),
    })
    const indicator = context.ui.slot({
      append: 'session.composer.top',
      render: props => <Indicator sessionID={props.sessionID} />,
    })
    return () => {
      command()
      panel()
      indicator()
    }
  },
})
