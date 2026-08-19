import type { CSSProperties, ReactNode } from 'react'
import { Button, Input, Panel } from '@vela/ui/drafts'
import { DEFAULT_PROFILE, resolveTheme, themeStyle } from '@vela/ui/themes'
import type { ComponentSpecimen, ThemeMode, ThemeParameters, WorkingSession } from '@vela/ui/themes'

interface PreviewCanvasProps {
  compare: boolean
  mode: ThemeMode
  session: WorkingSession
  specimen: ComponentSpecimen
  theme: ThemeParameters
}

function ContextFrame({ context, children }: { context: WorkingSession['context']; children: ReactNode }) {
  if (context === 'form') {
    return (
      <Panel description="Configure how the next sequence should begin." footer={<><Button size="small" tone="quiet">Cancel</Button><Button size="small" tone="accent">Apply</Button></>} title="Sequence settings">
        <Input label="Target" placeholder="NGC 7000" />
        {children}
      </Panel>
    )
  }
  if (context === 'toolbar') {
    return <div className="context-toolbar"><strong>Capture</strong><span>03:42 remaining</span><div className="context-toolbar__action">{children}</div></div>
  }
  if (context === 'card') {
    return <div className="context-card"><div><small>ACTIVE DEVICE</small><h3>Imaging train</h3><p>Camera, focuser, and filter wheel are ready.</p></div>{children}</div>
  }
  return <div className="context-isolated">{children}</div>
}

function Preview({ label, mode, session, specimen, theme }: { label: string; mode: ThemeMode; session: WorkingSession; specimen: ComponentSpecimen; theme: ThemeParameters }) {
  return (
    <section className="preview-column">
      <div className="preview-label"><span>{label}</span><span>{mode} · {Math.round(theme.density * 100)}%</span></div>
      <div className="vela-theme preview-surface" data-mode={mode} style={themeStyle(theme, mode) as CSSProperties}>
        <ContextFrame context={session.context}>{specimen.render(session.props)}</ContextFrame>
      </div>
    </section>
  )
}

export function PreviewCanvas({ compare, mode, session, specimen, theme }: PreviewCanvasProps) {
  const baseline = resolveTheme(DEFAULT_PROFILE, { density: session.density })
  return (
    <div className={`preview-grid ${compare ? 'preview-grid--compare' : ''}`} style={{ width: `${session.viewport}px` }}>
      {compare ? <Preview label="Baseline" mode={mode} session={session} specimen={specimen} theme={baseline} /> : null}
      <Preview label={compare ? 'Active profile' : specimen.name} mode={mode} session={session} specimen={specimen} theme={theme} />
    </div>
  )
}
