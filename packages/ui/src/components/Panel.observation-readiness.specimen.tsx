import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from './Badge'
import { Button } from './Button'
import { Panel } from './Panel'
import './Panel.observation-readiness.specimen.css'

const screens = ['rig', 'observe'] as const
const rigs = ['askar', 'seestar'] as const
const readinessStates = ['ready', 'disconnected', 'connecting', 'partial', 'uncertain', 'offline'] as const

type Screen = (typeof screens)[number]
type RigId = (typeof rigs)[number]
type ReadinessState = (typeof readinessStates)[number]

interface RigFixture {
  readonly id: RigId
  readonly name: string
  readonly server: string
  readonly endpoint: string
  readonly deviceCount: number
  readonly devices: ReadonlyArray<{ readonly kind: string; readonly name: string }>
  readonly interruptedConnection: {
    readonly confirmed: string
    readonly confirmedDevices: ReadonlyArray<string>
    readonly stoppedAt: string
    readonly stoppedDevice?: string
    readonly notAttempted: string
  }
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
  deviceCount: 6,
  devices: [
    { kind: 'Telescope', name: 'ASI Mount' },
    { kind: 'Camera', name: 'ZWO ASI2600MC Pro' },
    { kind: 'Camera', name: 'ZWO ASI220MM Mini' },
  ],
  interruptedConnection: {
    confirmed: 'Mount · Main camera',
    confirmedDevices: ['ASI Mount', 'ZWO ASI2600MC Pro'],
    stoppedAt: 'Guide camera',
    stoppedDevice: 'ZWO ASI220MM Mini',
    notAttempted: 'Focuser · Conditions · Switch',
  },
}

const seestar: RigFixture = {
  id: 'seestar',
  name: 'Seestar S30',
  server: 'ASCOM Alpaca 1.3.1-1',
  endpoint: '192.168.4.63:32323',
  deviceCount: 5,
  devices: [
    { kind: 'Telescope', name: 'Seestar S30_chicks Telescope' },
    { kind: 'Camera', name: 'Seestar S30_chicks Telephoto Camera' },
    { kind: 'Focuser', name: 'Seestar S30_chicks Telephoto Focuser' },
  ],
  interruptedConnection: {
    confirmed: 'Camera · Focuser',
    confirmedDevices: ['Seestar S30_chicks Telephoto Camera', 'Seestar S30_chicks Telephoto Focuser'],
    stoppedAt: 'Filter wheel',
    notAttempted: 'Telescope · Switch',
  },
}

function isScreen(value: unknown): value is Screen {
  return screens.includes(value as Screen)
}

function isRig(value: unknown): value is RigId {
  return rigs.includes(value as RigId)
}

function isReadinessState(value: unknown): value is ReadinessState {
  return readinessStates.includes(value as ReadinessState)
}

function ShellHeader() {
  return (
    <header className="vela-observation-shell__header">
      <div className="vela-observation-shell__brand"><span>V</span><strong>Vela</strong></div>
      <nav aria-label="Primary"><span data-active="true">Rigs</span></nav>
      <small>Observatory control</small>
    </header>
  )
}

function ObservationMark() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 28 28">
      <path d="m6 11 12-5 2.7 5.7-12 5L6 11Z" />
      <path d="m10 16 4 3m-1-1-3 7m3-7 6 6M4.5 9.5l3 8" />
      <path d="M22 3v4m-2-2h4" />
    </svg>
  )
}

function ReadinessMark({ state }: { readonly state: ReadinessState }) {
  if (state === 'ready') return <span aria-hidden="true">✓</span>
  if (state === 'connecting') return <span aria-hidden="true" className="vela-observation-spinner" />
  if (state === 'offline') return <span aria-hidden="true">×</span>
  if (state === 'partial' || state === 'uncertain') return <span aria-hidden="true">!</span>

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Z" />
      <path d="M12 17v4" />
    </svg>
  )
}

function statePresentation(rig: RigFixture, state: ReadinessState) {
  if (state === 'ready') {
    return {
      badge: 'Ready',
      tone: 'positive' as const,
      title: 'This Rig is ready',
      description: 'Every device is connected and reporting its current state.',
    }
  }

  if (state === 'disconnected') {
    return {
      badge: 'Needs connection',
      tone: 'warning' as const,
      title: 'Connect this Rig’s devices',
      description: 'Vela can reach the Rig, but its devices are not yet ready to report their state.',
    }
  }

  if (state === 'connecting') {
    return {
      badge: 'Connecting',
      tone: 'accent' as const,
      title: 'Connecting devices…',
      description: 'Vela is asking the Rig to connect and is waiting for confirmed results.',
    }
  }

  if (state === 'partial') {
    return {
      badge: 'Needs attention',
      tone: 'warning' as const,
      title: 'Connection stopped before the Rig was ready',
      description: `Two devices connected. The ${rig.interruptedConnection.stoppedAt.toLowerCase()} rejected its connection, so Vela did not continue.`,
    }
  }

  if (state === 'uncertain') {
    return {
      badge: 'Confirmation needed',
      tone: 'warning' as const,
      title: 'The connection result is uncertain',
      description: `Vela did not receive enough information to confirm the ${rig.interruptedConnection.stoppedAt.toLowerCase()}. No further connection commands were sent.`,
    }
  }

  return {
    badge: 'Offline',
    tone: 'danger' as const,
    title: 'This Rig is offline',
    description: 'Vela cannot reach its Alpaca server. Saved device identities remain available, but connection commands are not.',
  }
}

function connectedCount(rig: RigFixture, state: ReadinessState): number | undefined {
  if (state === 'ready') return rig.deviceCount
  if (state === 'partial' || state === 'uncertain') return 2
  if (state === 'offline' || state === 'connecting') return undefined
  return 0
}

function entryDeviceState(rig: RigFixture, state: ReadinessState, deviceName: string): string {
  if (state === 'ready') return 'Connected'
  if (state === 'offline') return 'Unavailable'
  if (state === 'connecting') return 'Status updating'
  if ((state === 'partial' || state === 'uncertain') && rig.interruptedConnection.confirmedDevices.includes(deviceName)) return 'Connected'
  if (state === 'uncertain' && rig.interruptedConnection.stoppedDevice === deviceName) return 'Not confirmed'
  return 'Disconnected'
}

function RigEntry({
  onStart,
  rig,
  state,
}: {
  readonly onStart: () => void
  readonly rig: RigFixture
  readonly state: ReadinessState
}) {
  const connected = connectedCount(rig, state)
  const summary = state === 'connecting'
    ? 'Device connection is in progress'
    : state === 'offline'
      ? `${rig.deviceCount} devices unavailable`
      : state === 'uncertain'
        ? `${connected ?? 0} confirmed connected`
        : `${connected ?? 0} of ${rig.deviceCount} devices connected`
  const reachable = state !== 'offline'

  return (
    <main className="vela-observation-rig-page">
      <header className="vela-observation-rig-hero">
        <div>
          <small>RIG</small>
          <h1>{rig.name}</h1>
          <p>{summary}</p>
        </div>
        <div>
          <Badge marker={<i />} tone={reachable ? 'positive' : 'danger'}>{reachable ? 'Reachable' : 'Offline'}</Badge>
          <span>{reachable ? 'Updated just now' : 'Last seen earlier today'}</span>
        </div>
      </header>

      <Panel className="vela-observation-entry" elevation="raised">
        <div className="vela-observation-entry__mark"><ObservationMark /></div>
        <div className="vela-observation-entry__copy">
          <small>OBSERVATION WORKSPACE</small>
          <h2>Ready to use this Rig?</h2>
          <p>Open a focused workspace for preparing and observing with {rig.name}. Entering it does not move hardware or begin an exposure.</p>
        </div>
        <Button onClick={onStart} size="large" tone="accent">Start observing</Button>
      </Panel>

      <section className="vela-observation-equipment" aria-labelledby="observation-equipment-title">
        <div>
          <small>EQUIPMENT</small>
          <h2 id="observation-equipment-title">Devices</h2>
        </div>
        <div className="vela-observation-equipment__grid">
          {rig.devices.map((device) => {
            const deviceState = entryDeviceState(rig, state, device.name)
            return (
              <Panel description={device.kind} elevation="raised" key={device.name} title={device.name}>
                <div className="vela-observation-equipment__status" data-state={deviceState.toLowerCase().replace(' ', '-')}>
                  <span aria-hidden="true">●</span>
                  <strong>{deviceState}</strong>
                </div>
              </Panel>
            )
          })}
          <Panel className="vela-observation-equipment__more" elevation="flat">
            <strong>+{rig.deviceCount - rig.devices.length} more devices</strong>
            <span>Additional device details remain available on this Rig page.</span>
          </Panel>
        </div>
      </section>
    </main>
  )
}

function ConnectionDetails({ rig, state }: { readonly rig: RigFixture; readonly state: ReadinessState }) {
  if (state !== 'partial' && state !== 'uncertain') return null

  return (
    <dl className="vela-observation-result">
      <div><dt>Confirmed connected</dt><dd>{rig.interruptedConnection.confirmed}</dd></div>
      <div><dt>{state === 'partial' ? 'Connection failed' : 'Not confirmed'}</dt><dd>{rig.interruptedConnection.stoppedAt}</dd></div>
      <div><dt>Not attempted</dt><dd>{rig.interruptedConnection.notAttempted}</dd></div>
    </dl>
  )
}

function ReadinessAction({
  onCheck,
  onConnect,
  rig,
  state,
}: {
  readonly onCheck: () => void
  readonly onConnect: () => void
  readonly rig: RigFixture
  readonly state: ReadinessState
}) {
  if (state === 'ready') {
    return <p className="vela-observation-action-note">Live device state is available throughout this workspace.</p>
  }

  if (state === 'disconnected') {
    return (
      <div className="vela-observation-action">
        <Button onClick={onConnect} size="large" tone="accent">Connect devices</Button>
        <p>Connects and confirms {rig.deviceCount} devices one at a time. It does not begin an exposure or move the Rig.</p>
      </div>
    )
  }

  if (state === 'connecting') {
    return (
      <div className="vela-observation-action">
        <Button disabled leadingIcon={<span aria-hidden="true" className="vela-observation-button-spinner" />} size="large" tone="accent">Connecting devices…</Button>
        <p>Waiting for the Rig to confirm each connection. Vela will stop if a result cannot be established.</p>
      </div>
    )
  }

  if (state === 'partial') {
    return (
      <div className="vela-observation-action">
        <Button onClick={onConnect} size="large" tone="accent">Try remaining devices</Button>
        <p>The failed connection was confirmed. Retrying requires this new explicit command.</p>
      </div>
    )
  }

  return (
    <div className="vela-observation-action">
      <Button onClick={onCheck} size="large" tone="neutral">Check Rig again</Button>
      <p>{state === 'uncertain'
        ? 'This only reads current state. Vela will not repeat the uncertain connection command.'
        : `Vela will check ${rig.endpoint} again without connecting devices.`}</p>
    </div>
  )
}

function ObservationWorkspace({
  onBack,
  onCheck,
  onConnect,
  rig,
  state,
  statusHeadingRef,
}: {
  readonly onBack: () => void
  readonly onCheck: () => void
  readonly onConnect: () => void
  readonly rig: RigFixture
  readonly state: ReadinessState
  readonly statusHeadingRef: RefObject<HTMLHeadingElement | null>
}) {
  const presentation = statePresentation(rig, state)
  const connected = connectedCount(rig, state)
  const serverState = state === 'offline' ? 'Offline' : 'Reachable'
  const deviceState = connected === undefined
    ? state === 'connecting' ? 'Connecting' : `${rig.deviceCount} known devices`
    : state === 'uncertain'
      ? `${connected} confirmed connected`
      : `${connected} of ${rig.deviceCount} connected`
  const liveState = state === 'ready'
    ? 'Available'
    : state === 'partial' ? 'Partially available'
      : state === 'uncertain' ? 'Last confirmed state'
        : state === 'offline' ? 'Unavailable'
          : state === 'connecting' ? 'Updating'
            : 'Waiting for connection'

  return (
    <main className="vela-observe-page">
      <Button className="vela-observation-back" onClick={onBack} size="small" tone="quiet">← Rig details</Button>

      <header className="vela-observe-hero">
        <div className="vela-observe-hero__mark"><ObservationMark /></div>
        <div>
          <small>OBSERVATION</small>
          <h1>Observing with {rig.name}</h1>
          <p>Prepare this Rig and confirm what Vela can see before using it.</p>
        </div>
        <Badge marker={<i />} tone={presentation.tone}>{presentation.badge}</Badge>
      </header>

      <section className="vela-observe-section" aria-labelledby="observation-readiness-title">
        <div className="vela-observe-section__heading">
          <div><small>PREPARATION</small><h2 id="observation-readiness-title">Rig readiness</h2></div>
          <span>Checked just now</span>
        </div>

        <div className="vela-observe-grid">
          <Panel className="vela-observe-readiness" data-state={state} elevation="raised">
            <div className="vela-observe-readiness__summary">
              <div className="vela-observe-readiness__mark"><ReadinessMark state={state} /></div>
              <div aria-atomic="true" aria-live="polite" role="status">
                <h3 ref={statusHeadingRef} tabIndex={-1}>{presentation.title}</h3>
                <p>{presentation.description}</p>
              </div>
            </div>

            <ConnectionDetails rig={rig} state={state} />
            <ReadinessAction onCheck={onCheck} onConnect={onConnect} rig={rig} state={state} />
          </Panel>

          <Panel className="vela-observe-facts" description={state === 'offline' ? rig.endpoint : rig.server} elevation="flat" title="What Vela can confirm">
            <dl>
              <div data-state={state === 'offline' ? 'danger' : 'positive'}><dt>Alpaca server</dt><dd>{serverState}</dd></div>
              <div data-state={state === 'ready' ? 'positive' : state === 'offline' ? 'danger' : 'warning'}><dt>Device connections</dt><dd>{deviceState}</dd></div>
              <div><dt>Live device state</dt><dd>{liveState}</dd></div>
            </dl>
            <p>Opening this workspace does not start an exposure or save an observation.</p>
          </Panel>
        </div>
      </section>
    </main>
  )
}

function ObservationReadinessPreview({ props, onPropsChange }: PreviewProps) {
  const screen = isScreen(props.screen) ? props.screen : 'observe'
  const rigId = isRig(props.rig) ? props.rig : 'seestar'
  const state = isReadinessState(props.state) ? props.state : 'disconnected'
  const rig = rigId === 'askar' ? askar : seestar
  const timer = useRef<number | undefined>(undefined)
  const animationFrame = useRef<number | undefined>(undefined)
  const generation = useRef(0)
  const operationRig = useRef<RigId | undefined>(undefined)
  const previousRig = useRef(rigId)
  const statusHeading = useRef<HTMLHeadingElement>(null)

  function update(patch: Record<string, string | number | boolean>) {
    onPropsChange?.(patch)
  }

  useEffect(() => () => {
    window.clearTimeout(timer.current)
    window.cancelAnimationFrame(animationFrame.current ?? 0)
  }, [])

  useLayoutEffect(() => {
    const rigChanged = previousRig.current !== rigId
    previousRig.current = rigId

    if (state !== 'connecting' || rigChanged) {
      generation.current += 1
      operationRig.current = undefined
      window.clearTimeout(timer.current)
    }

    if (rigChanged && state === 'connecting') {
      update({ state: rigId === 'askar' ? 'ready' : 'disconnected' })
    }
  }, [rigId, state])

  function startObserving() {
    update({ screen: 'observe' })
  }

  function connectDevices() {
    window.clearTimeout(timer.current)
    const initiatingRig = rig.id
    const nextGeneration = ++generation.current
    operationRig.current = initiatingRig
    update({ state: 'connecting' })
    timer.current = window.setTimeout(() => {
      if (generation.current !== nextGeneration || operationRig.current !== initiatingRig) return

      operationRig.current = undefined
      update({ state: 'ready' })
      animationFrame.current = window.requestAnimationFrame(() => statusHeading.current?.focus())
    }, 1_200)
  }

  return (
    <div className="vela-observation-demo">
      <ShellHeader />
      {screen === 'rig' ? (
        <RigEntry onStart={startObserving} rig={rig} state={state} />
      ) : (
        <ObservationWorkspace
          onBack={() => update({ screen: 'rig' })}
          onCheck={() => update({ state: rig.id === 'askar' ? 'ready' : 'disconnected' })}
          onConnect={connectDevices}
          rig={rig}
          state={state}
          statusHeadingRef={statusHeading}
        />
      )}
    </div>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-observation-readiness',
  name: 'Observation readiness · Product example',
  description: 'A non-exported product exploration for entering an observation workspace and explicitly preparing a chosen Rig.',
  controls: {
    screen: { type: 'select', label: 'Screen', options: screens },
    rig: { type: 'select', label: 'Rig', options: rigs },
    state: { type: 'select', label: 'Readiness', options: readinessStates },
  },
  defaultProps: { screen: 'observe', rig: 'seestar', state: 'disconnected' },
  render: (props, onPropsChange) => <ObservationReadinessPreview onPropsChange={onPropsChange} props={props} />,
}
