import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from './Badge'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { IconButton } from './IconButton'
import { Panel } from './Panel'
import './Panel.rig-detail.specimen.css'

const screens = ['rig', 'home'] as const

const rigs = ['askar', 'seestar'] as const

const scenarios = ['live', 'disconnected', 'mixed', 'stale', 'offline'] as const

type Screen = (typeof screens)[number]

type RigId = (typeof rigs)[number]

type Scenario = (typeof scenarios)[number]

type DeviceKind = 'telescope' | 'camera' | 'focuser' | 'filter-wheel' | 'conditions' | 'switch'

type Connection = 'connected' | 'disconnected' | 'unavailable' | 'last-known'

interface Metric {
  readonly label: string
  readonly value: string
  readonly tone?: 'normal' | 'muted' | 'warning'
}

interface DeviceFixture {
  readonly id: string
  readonly kind: DeviceKind
  readonly kindLabel: string
  readonly name: string
  readonly configuredName?: string
  readonly activity: string
  readonly activityNote?: string
  readonly connection: Connection
  readonly metrics: ReadonlyArray<Metric>
  readonly channels?: ReadonlyArray<{ readonly label: string; readonly value: string }>
}

interface RigFixture {
  readonly id: RigId
  readonly name: string
  readonly server: string
  readonly endpoint: string
  readonly addedAt: string
  readonly devices: ReadonlyArray<DeviceFixture>
}

interface PreviewProps {
  readonly props: Record<string, string | number | boolean>
  readonly onPropsChange: ((patch: Record<string, string | number | boolean>) => void) | undefined
}

const askar: RigFixture = {
  id: 'askar',
  name: 'Askar FRA 400',
  server: 'ASCOM Remote Server 7.0.1',
  endpoint: '192.168.4.104:11111',
  addedAt: 'September 2, 2026',
  devices: [
    {
      id: 'askar-mount',
      kind: 'telescope',
      kindLabel: 'Telescope',
      name: 'ASI Mount',
      configuredName: 'ASI Mount',
      activity: 'Idle',
      activityNote: 'Not tracking · Away from home',
      connection: 'connected',
      metrics: [
        { label: 'Tracking', value: 'Off', tone: 'muted' },
        { label: 'Parked', value: 'No' },
        { label: 'Home', value: 'Away', tone: 'muted' },
      ],
    },
    {
      id: 'askar-main-camera',
      kind: 'camera',
      kindLabel: 'Camera',
      name: 'ZWO ASI2600MC Pro',
      configuredName: 'ASI Camera (1)',
      activity: 'Idle',
      activityNote: 'Ready for an exposure',
      connection: 'connected',
      metrics: [
        { label: 'Sensor', value: '36.0 °C' },
        { label: 'Cooler', value: 'Off', tone: 'muted' },
      ],
    },
    {
      id: 'askar-guide-camera',
      kind: 'camera',
      kindLabel: 'Camera',
      name: 'ZWO ASI220MM Mini',
      configuredName: 'ASI Camera (2)',
      activity: 'Idle',
      activityNote: 'Guide camera',
      connection: 'connected',
      metrics: [{ label: 'Sensor', value: '26.1 °C' }],
    },
    {
      id: 'askar-focuser',
      kind: 'focuser',
      kindLabel: 'Focuser',
      name: 'ZWO Focuser',
      configuredName: 'ZWO Focuser (1)',
      activity: 'Idle',
      activityNote: 'Absolute position',
      connection: 'connected',
      metrics: [
        { label: 'Position', value: '32,888' },
        { label: 'Temperature', value: '27.0 °C' },
      ],
    },
    {
      id: 'askar-conditions',
      kind: 'conditions',
      kindLabel: 'Observing conditions',
      name: 'PPBMicro PPBMA91VU8A',
      configuredName: 'PegasusAstro ObservingConditions 1',
      activity: 'Reporting',
      activityNote: 'Environment at the Rig',
      connection: 'connected',
      metrics: [
        { label: 'Temperature', value: '23.8 °C' },
        { label: 'Humidity', value: '67%' },
        { label: 'Dew point', value: '17.3 °C' },
      ],
    },
    {
      id: 'askar-power',
      kind: 'switch',
      kindLabel: 'Power',
      name: 'PPBMicro PPBMA91VU8A',
      configuredName: 'PegasusAstro Switch 1',
      activity: 'Powered',
      activityNote: 'All monitored outputs responding',
      connection: 'connected',
      metrics: [
        { label: 'Input', value: '12.9 V' },
        { label: 'Current', value: '1.21 A' },
        { label: 'Power', value: '15 W' },
      ],
      channels: [
        { label: 'Quad power', value: 'On' },
        { label: 'Adjustable', value: 'On' },
        { label: 'Dew A', value: '20%' },
        { label: 'Dew B', value: '20%' },
        { label: 'AutoDew', value: 'On' },
      ],
    },
  ],
}

const seestar: RigFixture = {
  id: 'seestar',
  name: 'Seestar S30',
  server: 'ASCOM Alpaca 1.2.0-3',
  endpoint: '192.168.4.63:32323',
  addedAt: 'September 3, 2026',
  devices: [
    {
      id: 'seestar-telescope',
      kind: 'telescope',
      kindLabel: 'Telescope',
      name: 'Seestar S30_chicks Telescope',
      activity: 'Tracking',
      activityNote: 'Following the current field',
      connection: 'connected',
      metrics: [
        { label: 'Tracking', value: 'On' },
        { label: 'Parked', value: 'No' },
      ],
    },
    {
      id: 'seestar-camera',
      kind: 'camera',
      kindLabel: 'Camera',
      name: 'Seestar S30_chicks Telephoto Camera',
      activity: 'Idle',
      activityNote: 'Ready for an exposure',
      connection: 'connected',
      metrics: [
        { label: 'Sensor', value: '29.4 °C' },
        { label: 'Cooling', value: 'Not supported', tone: 'muted' },
      ],
    },
    {
      id: 'seestar-focuser',
      kind: 'focuser',
      kindLabel: 'Focuser',
      name: 'Seestar S30_chicks Telephoto Focuser',
      activity: 'Idle',
      activityNote: 'Position unavailable',
      connection: 'connected',
      metrics: [{ label: 'Temperature', value: '29.4 °C' }],
    },
    {
      id: 'seestar-filter',
      kind: 'filter-wheel',
      kindLabel: 'Filter wheel',
      name: 'Seestar S30_chicks Filter Wheel',
      activity: 'Idle',
      activityNote: 'Filter selected',
      connection: 'connected',
      metrics: [{ label: 'Filter', value: 'Dark' }],
    },
    {
      id: 'seestar-switch',
      kind: 'switch',
      kindLabel: 'Switch',
      name: 'Seestar S30_chicks Switch',
      activity: 'Limited status',
      activityNote: 'Detailed status is not available',
      connection: 'connected',
      metrics: [],
    },
  ],
}

function isScreen(value: unknown): value is Screen {
  return screens.includes(value as Screen)
}

function isRig(value: unknown): value is RigId {
  return rigs.includes(value as RigId)
}

function isScenario(value: unknown): value is Scenario {
  return scenarios.includes(value as Scenario)
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M16.5 7A7 7 0 1 0 17 11" />
      <path d="M16.5 3v4h-4" />
    </svg>
  )
}

function DeviceIcon({ kind }: { kind: DeviceKind }) {
  let drawing: ReactNode

  if (kind === 'telescope') {
    drawing = <><path d="m5 8 10-4 2.2 5.2-10 4L5 8Z" /><path d="m9 12 3 2m-1.5-1-3 6m3-6 5 5M3.8 6.8 6 12" /></>
  } else if (kind === 'camera') {
    drawing = <><rect height="10" rx="2" width="14" x="3" y="6" /><circle cx="10" cy="11" r="3.2" /><path d="m6 6 1-2h6l1 2" /></>
  } else if (kind === 'focuser') {
    drawing = <><circle cx="10" cy="10" r="5" /><circle cx="10" cy="10" r="2" /><path d="M10 2v3m0 10v3M2 10h3m10 0h3" /></>
  } else if (kind === 'filter-wheel') {
    drawing = <><circle cx="10" cy="10" r="7" /><circle cx="10" cy="6" r="1.2" /><circle cx="6.5" cy="12" r="1.2" /><circle cx="13.5" cy="12" r="1.2" /></>
  } else if (kind === 'conditions') {
    drawing = <><path d="M6 14.5a3.5 3.5 0 1 1 1.2-6.8A5 5 0 0 1 17 9.3a2.7 2.7 0 0 1-.7 5.2H6Z" /><path d="M8 17h.01m4 0h.01" /></>
  } else {
    drawing = <><path d="m11.5 2-6 9h5l-2 7 6-9h-5l2-7Z" /></>
  }

  return <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">{drawing}</svg>
}

function ShellHeader() {
  return (
    <header className="vela-rig-shell__header">
      <div className="vela-rig-shell__brand"><span>V</span><strong>Vela</strong></div>
      <nav aria-label="Primary"><span data-active="true">Rigs</span><span>Library</span></nav>
      <small>Observatory control</small>
    </header>
  )
}

function connectionPresentation(connection: Connection) {
  if (connection === 'connected') return { label: 'Connected', tone: 'positive' as const }

  if (connection === 'disconnected') return { label: 'Disconnected', tone: 'warning' as const }

  if (connection === 'last-known') return { label: 'Last known', tone: 'warning' as const }

  return { label: 'Unavailable', tone: 'danger' as const }
}

function scenarioDevices(rig: RigFixture, scenario: Scenario): ReadonlyArray<DeviceFixture> {
  if (scenario === 'live') return rig.devices

  if (scenario === 'offline') {
    return rig.devices.map((device) => ({
      id: device.id,
      kind: device.kind,
      kindLabel: device.kindLabel,
      name: device.configuredName ?? device.name,
      activity: 'Status unavailable',
      activityNote: 'No live information from this device',
      connection: 'unavailable',
      metrics: [],
    }))
  }

  if (scenario === 'stale') {
    return rig.devices.map((device) => ({ ...device, connection: 'last-known' }))
  }

  if (scenario === 'disconnected') {
    return rig.devices.map((device) => ({
      id: device.id,
      kind: device.kind,
      kindLabel: device.kindLabel,
      name: device.name,
      ...(device.configuredName === undefined ? {} : { configuredName: device.configuredName }),
      activity: 'Disconnected',
      activityNote: 'Connect this device in its driver to see live status',
      connection: 'disconnected',
      metrics: [],
    }))
  }

  return rig.devices.map((device, index) => {
    if (index === 2) {
      return {
        id: device.id,
        kind: device.kind,
        kindLabel: device.kindLabel,
        name: device.name,
        ...(device.configuredName === undefined ? {} : { configuredName: device.configuredName }),
        activity: 'Disconnected',
        activityNote: 'Connect this device in its driver to see live status',
        connection: 'disconnected',
        metrics: [],
      }
    }

    if (index === rig.devices.length - 2) {
      return {
        ...device,
        activity: 'Partial status',
        activityNote: 'Some values could not be read',
        metrics: device.metrics.slice(0, 1),
      }
    }

    return device
  })
}

function DeviceCard({ device }: { device: DeviceFixture }) {
  const connection = connectionPresentation(device.connection)
  const noDetails = device.metrics.length === 0 && device.channels === undefined

  return (
    <Panel
      action={<Badge marker={<i />} size="small" tone={connection.tone}>{connection.label}</Badge>}
      className="vela-rig-device"
      data-connection={device.connection}
      description={device.configuredName && device.configuredName !== device.name
        ? `${device.kindLabel} · ${device.configuredName}`
        : device.kindLabel}
      elevation="raised"
      title={device.name}
    >
      <div className="vela-rig-device__state">
        <span className="vela-rig-device__icon"><DeviceIcon kind={device.kind} /></span>
        <p><small>STATUS</small><strong>{device.activity}</strong><span>{device.activityNote}</span></p>
      </div>

      {device.metrics.length > 0 ? (
        <dl className="vela-rig-device__metrics">
          {device.metrics.map((metric) => (
            <div data-tone={metric.tone ?? 'normal'} key={metric.label}>
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {device.channels ? (
        <div className="vela-rig-device__channels">
          {device.channels.map((channel) => (
            <span key={channel.label}><small>{channel.label}</small><strong>{channel.value}</strong></span>
          ))}
        </div>
      ) : null}

      {noDetails ? <p className="vela-rig-device__empty">Detailed status is not available from this device.</p> : null}
    </Panel>
  )
}

function countSummary(devices: ReadonlyArray<DeviceFixture>, scenario: Scenario): string {
  if (scenario === 'offline') return `${devices.length} devices · status unavailable`

  if (scenario === 'stale') return `${devices.length} devices · last update 42 seconds ago`

  const connected = devices.filter((device) => device.connection === 'connected').length
  const disconnected = devices.filter((device) => device.connection === 'disconnected').length
  const unavailable = devices.length - connected - disconnected
  const parts = [`${connected} of ${devices.length} devices connected`]

  if (disconnected > 0) parts.push(`${disconnected} disconnected`)

  if (unavailable > 0) parts.push(`${unavailable} unavailable`)

  return parts.join(' · ')
}

function reachability(scenario: Scenario) {
  if (scenario === 'offline') return { label: 'Offline', tone: 'danger' as const }

  if (scenario === 'stale') return { label: 'Updates interrupted', tone: 'warning' as const }

  return { label: 'Reachable', tone: 'positive' as const }
}

function HomeView({
  forgottenRigs,
  onOpen,
}: {
  forgottenRigs: ReadonlySet<RigId>
  onOpen: (rig: RigId, scenario: Scenario) => void
}) {
  const cards = [
    { rig: askar, connected: 6, scenario: 'live' as const, state: 'Reachable', tone: 'positive' as const },
    { rig: seestar, connected: 0, scenario: 'disconnected' as const, state: 'Reachable', tone: 'positive' as const },
  ].filter((card) => !forgottenRigs.has(card.rig.id))

  return (
    <main className="vela-rig-home">
      <div className="vela-rig-home__heading">
        <div><small>OBSERVATORY</small><h1>Rigs</h1><p>Choose a Rig to see what is connected and what it is doing.</p></div>
        <Button size="small" tone="accent">Add rig</Button>
      </div>
      {cards.length === 0 ? (
        <section className="vela-rig-home__empty">
          <strong>No Rigs configured</strong>
          <p>Set up the observatory you want Vela to monitor.</p>
          <Button tone="accent">Set up a rig</Button>
        </section>
      ) : (
        <div className="vela-rig-home__grid">
          {cards.map((card) => (
            <button className="vela-rig-summary" key={card.rig.id} onClick={() => onOpen(card.rig.id, card.scenario)} type="button">
              <span className="vela-rig-summary__heading"><strong>{card.rig.name}</strong><Badge marker={<i />} size="small" tone={card.tone}>{card.state}</Badge></span>
              <span className="vela-rig-summary__server">{card.rig.server}</span>
              <span className="vela-rig-summary__footer">
                <span className="vela-rig-summary__connections" data-state={card.connected === card.rig.devices.length ? 'complete' : 'attention'}>
                  <strong>{card.connected} of {card.rig.devices.length}</strong>
                  <small>devices connected</small>
                </span>
                <strong>View rig <i>→</i></strong>
              </span>
            </button>
          ))}
        </div>
      )}
    </main>
  )
}

function RigDetails({ open, rig, onToggle }: { open: boolean; rig: RigFixture; onToggle: () => void }) {
  return (
    <section className="vela-rig-details">
      <button aria-expanded={open} className="vela-rig-details__summary" onClick={onToggle} type="button">
        <span><strong>Rig details</strong><small>{rig.endpoint} · Added {rig.addedAt}</small></span>
        <i aria-hidden="true">⌄</i>
      </button>
      {open ? (
        <dl className="vela-rig-details__body">
          <div><dt>Endpoint</dt><dd>{rig.endpoint}</dd></div>
          <div><dt>Alpaca server</dt><dd>{rig.server}</dd></div>
          <div><dt>Added to Vela</dt><dd>{rig.addedAt}</dd></div>
          <div><dt>Last inventory</dt><dd>Today at 8:42 PM</dd></div>
        </dl>
      ) : null}
    </section>
  )
}

function RigView({
  detailsOpen,
  onBack,
  onDetailsToggle,
  onForget,
  onRefresh,
  rig,
  scenario,
}: {
  readonly detailsOpen: boolean
  readonly onBack: () => void
  readonly onDetailsToggle: () => void
  readonly onForget: () => void
  readonly onRefresh: () => void
  readonly rig: RigFixture
  readonly scenario: Scenario
}) {
  const devices = scenarioDevices(rig, scenario)
  const status = reachability(scenario)

  return (
    <main className="vela-rig-page">
      <Button className="vela-rig-page__back" onClick={onBack} size="small" tone="quiet">← All rigs</Button>

      <header className="vela-rig-hero">
        <div>
          <small>RIG</small>
          <h1>{rig.name}</h1>
          <p>{countSummary(devices, scenario)}</p>
        </div>
        <div className="vela-rig-hero__status">
          <Badge marker={<i />} tone={status.tone}>{status.label}</Badge>
          <span>{scenario === 'offline' ? 'Last seen yesterday at 10:09 PM' : scenario === 'stale' ? 'Last updated 42 seconds ago' : 'Updated just now'}</span>
          <IconButton icon={<RefreshIcon />} label="Refresh Rig" onClick={onRefresh} size="small" tone="quiet" />
        </div>
      </header>

      {scenario === 'stale' ? (
        <div className="vela-rig-notice" data-tone="warning"><strong>Live updates are interrupted</strong><span>Showing the most recent values Vela received. They may no longer describe the Rig.</span></div>
      ) : null}

      {scenario === 'offline' ? (
        <div className="vela-rig-notice" data-tone="danger"><strong>This Rig is offline</strong><span>Vela cannot reach {rig.endpoint}. Device names come from the last successful inventory.</span></div>
      ) : null}

      <section className="vela-rig-devices" aria-labelledby="rig-devices-title">
        <div className="vela-rig-section-heading"><div><small>EQUIPMENT</small><h2 id="rig-devices-title">Devices</h2></div><span>Refreshes every 5 seconds</span></div>
        <div className="vela-rig-device-grid">
          {devices.map((device) => <DeviceCard device={device} key={device.id} />)}
        </div>
      </section>

      <RigDetails onToggle={onDetailsToggle} open={detailsOpen} rig={rig} />

      <section className="vela-rig-management">
        <div><strong>Remove this Rig from Vela</strong><p>This only removes the saved Rig. It does not change the Alpaca server or hardware.</p></div>
        <Button className="vela-rig__forget-button" onClick={onForget} size="small" tone="quiet">Forget rig</Button>
      </section>
    </main>
  )
}

function RigDetailPreview({ props, onPropsChange }: PreviewProps) {
  const screen = isScreen(props.screen) ? props.screen : 'rig'
  const rigId = isRig(props.rig) ? props.rig : 'askar'
  const scenario = isScenario(props.scenario) ? props.scenario : 'live'
  const detailsOpen = Boolean(props.detailsOpen)
  const rig = rigId === 'askar' ? askar : seestar
  const [forgetOpen, setForgetOpen] = useState(false)
  const [forgottenRigs, setForgottenRigs] = useState<ReadonlySet<RigId>>(() => new Set())
  const effectiveScreen = screen === 'rig' && forgottenRigs.has(rig.id) ? 'home' : screen

  function update(patch: Record<string, string | number | boolean>) {
    onPropsChange?.(patch)
  }

  return (
    <div className="vela-rig-demo">
      <ShellHeader />
      {effectiveScreen === 'home' ? (
        <HomeView
          forgottenRigs={forgottenRigs}
          onOpen={(nextRig, nextScenario) => update({ screen: 'rig', rig: nextRig, scenario: nextScenario })}
        />
      ) : (
        <RigView
          detailsOpen={detailsOpen}
          onBack={() => update({ screen: 'home' })}
          onDetailsToggle={() => update({ detailsOpen: !detailsOpen })}
          onForget={() => setForgetOpen(true)}
          onRefresh={() => update({ scenario: 'live' })}
          rig={rig}
          scenario={scenario}
        />
      )}

      <Dialog
        description="This removes the saved Rig from Vela. It does not change the Alpaca server or any hardware."
        footer={<><Button onClick={() => setForgetOpen(false)} tone="quiet">Cancel</Button><Button className="vela-rig__confirm-forget" onClick={() => { setForgetOpen(false); setForgottenRigs((current) => new Set([...current, rig.id])); update({ screen: 'home' }) }}>Forget rig</Button></>}
        onDismiss={() => setForgetOpen(false)}
        open={forgetOpen}
        title={`Forget ${rig.name}?`}
      >
        <p className="vela-rig-forget-copy">You can discover and add it again later.</p>
      </Dialog>
    </div>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-rig-detail',
  name: 'Rig overview · Product example',
  description: 'A throwaway product prototype for clickable Rig summaries and kind-specific live device cards.',
  controls: {
    screen: { type: 'select', label: 'Screen', options: screens },
    rig: { type: 'select', label: 'Rig', options: rigs },
    scenario: { type: 'select', label: 'State', options: scenarios },
    detailsOpen: { type: 'boolean', label: 'Rig details open' },
  },
  defaultProps: { screen: 'rig', rig: 'askar', scenario: 'live', detailsOpen: false },
  render: (props, onPropsChange) => <RigDetailPreview onPropsChange={onPropsChange} props={props} />,
}
