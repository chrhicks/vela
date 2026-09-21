import type { ReactNode } from 'react'
import { Badge, Button, Checkbox, IconButton, Input, Panel, Select, Tabs } from '@vela/ui'
import { DEFAULT_PROFILE, resolveTheme, themeStyle } from '@vela/ui/themes'
import type { ComponentSpecimen, ThemeMode, ThemeParameters, WorkingSession } from '@vela/ui/themes'

interface PreviewCanvasProps {
  compare: boolean
  mode: ThemeMode
  session: WorkingSession
  specimen: ComponentSpecimen
  theme: ThemeParameters
  onPropsChange: (patch: Record<string, string | number | boolean>) => void
}

function ContextFrame({
  context,
  children,
}: {
  context: WorkingSession['context']
  children: ReactNode
}) {
  const deviceOptions = [
    { value: 'main', label: 'ASI2600MC Pro' },
    { value: 'guide', label: 'ASI220MM Mini' },
  ]

  const moreIcon = (
    <svg fill="currentColor" stroke="none" viewBox="0 0 20 20">
      <circle cx="4" cy="10" r="1.4" />
      <circle cx="10" cy="10" r="1.4" />
      <circle cx="16" cy="10" r="1.4" />
    </svg>
  )

  if (context === 'form') {
    return (
      <Panel
        description="Configure how the next sequence should begin."
        footer={
          <>
            <Button size="small" tone="quiet">
              Cancel
            </Button>
            <Button size="small" tone="accent">
              Apply
            </Button>
          </>
        }
        title="Sequence settings"
      >
        <Input label="Target" placeholder="NGC 7000" />
        <Select defaultValue="main" label="Imaging camera" options={deviceOptions} />
        <Checkbox
          defaultChecked
          description="Returns the sensor to ambient temperature safely."
          label="Warm camera when complete"
        />
        <div className="context-focus">
          <small>ACTIVE SPECIMEN</small>
          {children}
        </div>
      </Panel>
    )
  }

  if (context === 'toolbar') {
    return (
      <div className="context-toolbar">
        <div>
          <strong>Capture</strong>
          <span>03:42 remaining</span>
        </div>
        <Badge marker={<i />} size="small" tone="positive">
          Guiding
        </Badge>
        <Button size="small" tone="quiet">
          Pause
        </Button>
        <div className="context-toolbar__action">{children}</div>
        <IconButton icon={moreIcon} label="More actions" size="small" />
      </div>
    )
  }

  if (context === 'card') {
    return (
      <Panel
        action={
          <Badge marker={<i />} size="small" tone="positive">
            Connected
          </Badge>
        }
        description="Camera, focuser, and filter wheel are ready."
        elevation="raised"
        title="Imaging train"
      >
        <Tabs
          defaultValue="status"
          items={[
            {
              id: 'status',
              label: 'Status',
              content: (
                <div className="context-card">
                  <div>
                    <small>ACTIVE DEVICE</small>
                    <h3>Main camera</h3>
                    <p>Sensor −5.0 °C · Cooler 42%</p>
                  </div>
                  <div className="context-focus">{children}</div>
                </div>
              ),
            },
            {
              id: 'settings',
              label: 'Settings',
              content: (
                <div className="context-card">
                  <div>
                    <small>CAPTURE DEFAULTS</small>
                    <h3>Gain 100</h3>
                    <p>Offset 50 · USB limit 40</p>
                  </div>
                </div>
              ),
            },
          ]}
          size="small"
        />
      </Panel>
    )
  }

  return <div className="context-isolated">{children}</div>
}

function Preview({
  label,
  mode,
  session,
  specimen,
  theme,
  onPropsChange,
}: {
  label: string
  mode: ThemeMode
  session: WorkingSession
  specimen: ComponentSpecimen
  theme: ThemeParameters
  onPropsChange: (patch: Record<string, string | number | boolean>) => void
}) {
  return (
    <section className="preview-column">
      <div className="preview-label">
        <span>{label}</span>
        <span>
          {mode} · {Math.round(theme.density * 100)}%
        </span>
      </div>
      <div className="vela-theme preview-surface" data-mode={mode} style={themeStyle(theme, mode)}>
        <ContextFrame context={session.context}>
          {specimen.render(session.props, onPropsChange)}
        </ContextFrame>
      </div>
    </section>
  )
}

export function PreviewCanvas({
  compare,
  mode,
  session,
  specimen,
  theme,
  onPropsChange,
}: PreviewCanvasProps) {
  const baseline = resolveTheme(DEFAULT_PROFILE, { density: session.density })

  return (
    <div
      className={`preview-grid ${compare ? 'preview-grid--compare' : ''}`}
      style={{ width: `${session.viewport}px` }}
    >
      {compare ? (
        <Preview
          label="Baseline"
          mode={mode}
          onPropsChange={onPropsChange}
          session={session}
          specimen={specimen}
          theme={baseline}
        />
      ) : null}
      <Preview
        label={compare ? 'Active profile' : specimen.name}
        mode={mode}
        onPropsChange={onPropsChange}
        session={session}
        specimen={specimen}
        theme={theme}
      />
    </div>
  )
}
