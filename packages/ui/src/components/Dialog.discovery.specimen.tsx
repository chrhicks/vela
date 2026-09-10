import { z } from 'zod'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import './Dialog.discovery.specimen.css'
import { Badge } from './Badge'
import { Button } from './Button'
import { Input } from './Input'
import type { ComponentSpecimen } from '../themes'
import { Dialog } from './Dialog'

const views = ['start', 'manual', 'scanning', 'results', 'review', 'dismissed', 'complete'] as const

const scenarios = ['mixed', 'single', 'empty', 'scan-failed'] as const

type DiscoveryView = (typeof views)[number]

type ResultScenario = (typeof scenarios)[number]

const devices = [
  { kind: 'Telescope', name: 'ASI Mount' },
  { kind: 'Camera', name: 'ASI Camera (1)' },
  { kind: 'Camera', name: 'ASI Camera (2)' },
  { kind: 'Focuser', name: 'ZWO Focuser (1)' },
  { kind: 'Conditions', name: 'PegasusAstro ObservingConditions 1' },
  { kind: 'Switch', name: 'PegasusAstro Switch 1' },
]

function isView(value: unknown): value is DiscoveryView {
  return views.some(option => option === value)
}

function isScenario(value: unknown): value is ResultScenario {
  return scenarios.some(option => option === value)
}

function ScanIcon() {
  return (
    <svg aria-hidden="true" className="vela-discovery__button-icon" fill="none" viewBox="0 0 20 20">
      <path d="M3.5 8.5a6.7 6.7 0 0 1 11.7-3.1L17 7M16.5 11.5a6.7 6.7 0 0 1-11.7 3.1L3 13" />
      <path d="M17 3.5V7h-3.5M3 16.5V13h3.5" />
    </svg>
  )
}

function TelescopeMark() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 32 32">
      <path d="m8 12 13-6 3 6-13 6-3-6Z" />
      <path d="m13 17 4 3m-1-1-4 8m4-8 7 7" />
      <path d="m6 10 3 7" />
    </svg>
  )
}

interface PreviewProps {
  props: Record<string, string | number | boolean>
  onPropsChange: ((patch: Record<string, string | number | boolean>) => void) | undefined
}

function DiscoveryDialogPreview({ props, onPropsChange }: PreviewProps) {
  function renderDiscoveryResults() {
    switch (scenario) {
      case 'scan-failed':
        return (
              <div className="vela-discovery-message" data-tone="danger">
                <strong>Network scan could not start</strong>
                <p>Vela could not use this computer’s network interfaces. You can retry or enter the server address manually.</p>
                <Button onClick={() => update({ view: 'manual' })} size="small">Enter address</Button>
              </div>
            )
      case 'empty':
        return (
              <div className="vela-discovery-message">
                <strong>No Alpaca servers found</strong>
                <p>Confirm the server is running and that this device is on the same network, then scan again.</p>
                <Button onClick={() => update({ view: 'manual' })} size="small">Enter address</Button>
              </div>
            )
      default:
        return (
              <>
                <div className="vela-discovery-results__summary"><span>{scenario === 'single' ? '1 server found' : '2 servers found'}</span><small>Select one to continue</small></div>
                <button
                  aria-pressed={selected}
                  className="vela-discovery-candidate"
                  data-selected={selected}
                  onClick={() => update({ selected: !selected })}
                  type="button"
                >
                  <span className="vela-discovery-candidate__mark"><TelescopeMark /></span>
                  <span className="vela-discovery-candidate__copy">
                    <span><strong>ASCOM Remote</strong><Badge size="small" tone="positive">Eligible</Badge></span>
                    <small>192.168.4.104:11111 · 6 devices</small>
                    <span className="vela-discovery-candidate__kinds"><i>Mount</i><i>2 cameras</i><i>Focuser</i><i>+2</i></span>
                  </span>
                  <span className="vela-discovery-candidate__select">{selected ? 'Selected' : 'Select'}</span>
                </button>

                {scenario === 'mixed' ? (
                  <>
                    <article className="vela-discovery-candidate" data-disabled="true">
                      <span className="vela-discovery-candidate__mark"><TelescopeMark /></span>
                      <span className="vela-discovery-candidate__copy">
                        <span><strong>Legacy Alpaca</strong><Badge size="small" tone="warning">Unavailable</Badge></span>
                        <small>192.168.4.120:32323 · 1 device</small>
                        <p>This server did not provide a stable device ID, so Vela cannot add it safely.</p>
                      </span>
                    </article>
                    <div className="vela-discovery-partial"><span>!</span><p><strong>One server could not be inspected</strong><small>192.168.4.121:11111 did not respond.</small></p></div>
                  </>
                ) : null}
              </>
            )
    }
  }

  const view = isView(props.view) ? props.view : 'start'
  const scenario = isScenario(props.scenario) ? props.scenario : 'mixed'
  const selected = Boolean(props.selected)
  const canReview = selected && (scenario === 'mixed' || scenario === 'single')
  const rigName = z.string().catch('ASCOM Remote').parse(props.rigName)
  const canAdd = rigName.trim().length > 0
  const [host, setHost] = useState('ascom-remote.local')
  const [port, setPort] = useState('11111')
  const scanTimer = useRef<number | undefined>(undefined)
  const scanGeneration = useRef(0)
  const currentView = useRef(view)
  const open = view !== 'dismissed' && view !== 'complete'

  useEffect(() => () => window.clearTimeout(scanTimer.current), [])

  useLayoutEffect(() => {
    currentView.current = view

    if (view !== 'scanning') {
      scanGeneration.current += 1
      window.clearTimeout(scanTimer.current)
    }
  }, [view])

  function update(patch: Record<string, string | number | boolean>) {
    onPropsChange?.(patch)
  }

  function beginScan() {
    window.clearTimeout(scanTimer.current)
    const generation = ++scanGeneration.current
    update({ view: 'scanning', selected: false })
    scanTimer.current = window.setTimeout(() => {
      if (scanGeneration.current === generation && currentView.current === 'scanning') {
        update({ view: 'results' })
      }
    }, 900)
  }

  function dismiss() {
    scanGeneration.current += 1
    window.clearTimeout(scanTimer.current)
    update({ view: 'dismissed', selected: false })
  }

  const copy = {
    start: {
      title: 'Find your observatory rig',
      description: 'Vela can look for Alpaca servers on this network or inspect an address you already know.',
    },
    manual: {
      title: 'Enter an Alpaca address',
      description: 'Use the hostname or IP address shown by your Alpaca server.',
    },
    scanning: {
      title: 'Looking for rigs',
      description: 'Vela is reading server and device details. No hardware controls are being changed.',
    },
    results: {
      title: 'Rigs on this network',
      description: 'Choose the server you want Vela to use. Nothing is added until you confirm it.',
    },
    review: {
      title: 'Review this rig',
      description: 'Confirm the server and devices before adding this rig to Vela.',
    },
  }[open ? view : 'start']

  let footer

  if (view === 'manual') {
    footer = (
      <>
        <Button onClick={() => update({ view: 'start' })} tone="quiet">Back</Button>
        <Button onClick={beginScan} tone="accent">Inspect address</Button>
      </>
    )
  } else if (view === 'scanning') {
    footer = <Button onClick={dismiss} tone="quiet">Cancel scan</Button>
  } else if (view === 'results') {
    footer = (
      <>
        <Button onClick={beginScan} tone="quiet">Scan again</Button>
        <Button disabled={!canReview} onClick={() => update({ view: 'review' })} tone="accent">Review rig</Button>
      </>
    )
  } else if (view === 'review') {
    footer = (
      <>
        <Button onClick={() => update({ view: 'results' })} tone="quiet">Back</Button>
        <Button disabled={!canAdd} onClick={() => update({ view: 'complete', selected: false })} tone="accent">Add rig</Button>
      </>
    )
  }

  return (
    <div className="vela-discovery-demo">
      <header className="vela-discovery-shell__header">
        <div className="vela-discovery-shell__brand"><span>V</span><strong>Vela</strong></div>
        <small>Observatory control</small>
      </header>

      <main className="vela-discovery-shell__main">
        {view === 'complete' ? (
          <section className="vela-discovery-complete">
            <div className="vela-discovery-complete__heading">
              <div><small>YOUR RIG</small><h2>{rigName.trim() || 'Unnamed rig'}</h2><p>ASCOM Remote · 6 devices</p></div>
              <Badge marker={<i />} tone="positive">Ready</Badge>
            </div>
            <div className="vela-discovery-complete__devices">
              {devices.slice(0, 4).map((device) => <span key={device.name}>{device.name}</span>)}
              <span>+2 more</span>
            </div>
            <Button onClick={() => update({ view: 'start' })} tone="quiet">Find another rig</Button>
          </section>
        ) : (
          <section className="vela-discovery-empty">
            <div className="vela-discovery-empty__mark"><TelescopeMark /></div>
            <small>GET STARTED</small>
            <h1>No rig configured</h1>
            <p>Set up the observatory you want Vela to monitor and control.</p>
            <Button onClick={() => update({ view: 'start' })} tone="accent">Set up a rig</Button>
          </section>
        )}
      </main>

      <Dialog
        description={copy.description}
        footer={footer}
        onDismiss={dismiss}
        open={open}
        title={copy.title}
      >
        {view === 'start' ? (
          <div className="vela-discovery-start">
            <div className="vela-discovery-start__visual">
              <span className="vela-discovery-orbit vela-discovery-orbit--outer" />
              <span className="vela-discovery-orbit vela-discovery-orbit--inner" />
              <span className="vela-discovery-start__telescope"><TelescopeMark /></span>
              <i className="vela-discovery-signal vela-discovery-signal--one" />
              <i className="vela-discovery-signal vela-discovery-signal--two" />
              <i className="vela-discovery-signal vela-discovery-signal--three" />
            </div>
            <div className="vela-discovery-start__actions">
              <Button leadingIcon={<ScanIcon />} onClick={beginScan} size="large" tone="accent">Scan for rigs</Button>
              <Button onClick={() => update({ view: 'manual' })} tone="quiet">Enter an address manually</Button>
            </div>
            <p className="vela-discovery-note">Discovery reads Alpaca server information and configured device names. It does not connect devices or move hardware.</p>
          </div>
        ) : null}

        {view === 'manual' ? (
          <form
            className="vela-discovery-manual"
            onSubmit={(event) => {
              event.preventDefault()
              beginScan()
            }}
          >
            <div className="vela-discovery-manual__fields">
              <Input label="Host or IP address" onChange={(event) => setHost(event.target.value)} placeholder="ascom-remote.local" value={host} />
              <Input inputMode="numeric" label="Port" onChange={(event) => setPort(event.target.value)} value={port} />
            </div>
            <p>Vela will inspect <strong>{host || 'this host'}:{port || '11111'}</strong> using the read-only Alpaca Management API.</p>
          </form>
        ) : null}

        {view === 'scanning' ? (
          <div className="vela-discovery-scanning" role="status">
            <div className="vela-discovery-scanner"><span /><i /><i /><i /></div>
            <strong>Scanning your local network</strong>
            <p>This usually takes only a few seconds.</p>
            <div className="vela-discovery-scanning__steps"><span data-active="true">Finding servers</span><span>Inspecting devices</span></div>
          </div>
        ) : null}

        {view === 'results' ? (
          <div className="vela-discovery-results">
            {renderDiscoveryResults()}
          </div>
        ) : null}

        {view === 'review' ? (
          <div className="vela-discovery-review">
            <section className="vela-discovery-review__server">
              <span className="vela-discovery-candidate__mark"><TelescopeMark /></span>
              <div><small>ALPACA SERVER</small><strong>ASCOM Remote</strong><span>192.168.4.104:11111</span></div>
              <Badge size="small" tone="positive">Eligible</Badge>
            </section>
            <Input
              label="Rig name"
              message="Reported as ASCOM Remote. Keep this name or choose one that means more to you."
              onChange={(event) => update({ rigName: event.target.value })}
              value={rigName}
            />
            <section>
              <div className="vela-discovery-review__label"><strong>Configured devices</strong><span>6 found</span></div>
              <ul className="vela-discovery-device-list">
                {devices.map((device) => (
                  <li key={device.name}><span>{device.kind.slice(0, 1)}</span><p><strong>{device.name}</strong><small>{device.kind}</small></p></li>
                ))}
              </ul>
            </section>
            <div className="vela-discovery-review__notice"><span>✓</span><p><strong>Ready to add</strong><small>Adding this rig will not connect its devices or issue hardware commands.</small></p></div>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'dialog',
  componentName: 'Dialog',
  id: 'dialog-rig-discovery',
  name: 'Rig discovery · Product example',
  description: 'A non-exported, fixture-backed product example composed from the Dialog primitive.',
  controls: {
    view: { type: 'select', label: 'View', options: views },
    scenario: { type: 'select', label: 'Results', options: scenarios },
    selected: { type: 'boolean', label: 'Candidate selected' },
    rigName: { type: 'text', label: 'Rig name' },
  },
  defaultProps: { view: 'start', scenario: 'mixed', selected: false, rigName: 'ASCOM Remote' },
  render: (props, onPropsChange) => <DiscoveryDialogPreview onPropsChange={onPropsChange} props={props} />,
}
