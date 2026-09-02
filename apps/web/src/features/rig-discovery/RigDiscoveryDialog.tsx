import type { DiscoveryCandidateView, DiscoveryResultView } from '@vela/model/rig'
import { Button, Dialog } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import {
  discoverRigs,
  DiscoverRigsError,
  type DiscoverRigsRequest,
} from './discover-rigs'
import { DiscoveryOrbit } from './DiscoveryOrbit'
import { DiscoveryResults } from './DiscoveryResults'
import { DiscoveryScanner } from './DiscoveryScanner'
import { ManualDiscoveryForm, manualDiscoveryFormId } from './ManualDiscoveryForm'
import { RigReview } from './RigReview'
import './RigDiscoveryDialog.css'

interface Props {
  open: boolean
  onDismiss(): void
}

type DiscoveryState =
  | { view: 'start' }
  | { view: 'manual'; host: string; port: string; error?: string }
  | { view: 'scanning'; request: DiscoverRigsRequest }
  | {
      view: 'results'
      request: DiscoverRigsRequest
      result: DiscoveryResultView
      selected: DiscoveryCandidateView | null
    }
  | {
      view: 'review'
      request: DiscoverRigsRequest
      result: DiscoveryResultView
      candidate: DiscoveryCandidateView
      rigName: string
    }
  | { view: 'request-failed'; request: DiscoverRigsRequest }

export default function RigDiscoveryDialog({ open, onDismiss }: Props) {
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>({ view: 'start' })
  const requestController = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => requestController.current?.abort()
  }, [])

  useEffect(() => {
    if (open) return

    requestController.current?.abort()
    requestController.current = null
    setDiscoveryState({ view: 'start' })
  }, [open])

  async function runDiscovery(request: DiscoverRigsRequest) {
    requestController.current?.abort()

    const controller = new AbortController()
    requestController.current = controller
    setDiscoveryState({ view: 'scanning', request })

    try {
      const result = await discoverRigs(request, controller.signal)
      if (requestController.current === controller) {
        setDiscoveryState({ view: 'results', request, result, selected: null })
      }
    } catch (error) {
      if (!controller.signal.aborted && requestController.current === controller) {
        if (request.mode === 'manual' && error instanceof DiscoverRigsError) {
          setDiscoveryState({
            view: 'manual',
            host: request.host,
            port: String(request.port),
            error: 'Enter a hostname or IPv4 address without a URL, path, or port.',
          })
        } else {
          setDiscoveryState({ view: 'request-failed', request })
        }
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null
      }
    }
  }

  function dismiss() {
    requestController.current?.abort()
    requestController.current = null
    setDiscoveryState({ view: 'start' })
    onDismiss()
  }

  function showManualEntry(request?: Extract<DiscoverRigsRequest, { mode: 'manual' }>) {
    setDiscoveryState({
      view: 'manual',
      host: request?.host ?? '',
      port: String(request?.port ?? 11111),
    })
  }

  function inspectManualAddress() {
    if (discoveryState.view !== 'manual') return

    const host = discoveryState.host.trim()
    const port = Number(discoveryState.port)
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return

    void runDiscovery({ mode: 'manual', host, port })
  }

  function changeManualHost(host: string) {
    if (discoveryState.view !== 'manual') return
    setDiscoveryState({ ...discoveryState, host, error: undefined })
  }

  function changeManualPort(port: string) {
    if (discoveryState.view !== 'manual') return
    setDiscoveryState({ ...discoveryState, port, error: undefined })
  }

  function selectCandidate(candidate: DiscoveryCandidateView | null) {
    if (discoveryState.view !== 'results') return
    setDiscoveryState({ ...discoveryState, selected: candidate })
  }

  function reviewCandidate() {
    if (discoveryState.view !== 'results' || !discoveryState.selected) return

    const candidate = discoveryState.selected
    setDiscoveryState({
      view: 'review',
      request: discoveryState.request,
      result: discoveryState.result,
      candidate,
      rigName: candidate.server?.name?.trim() || candidate.endpoint.host,
    })
  }

  function returnToResults() {
    if (discoveryState.view !== 'review') return
    setDiscoveryState({
      view: 'results',
      request: discoveryState.request,
      result: discoveryState.result,
      selected: discoveryState.candidate,
    })
  }

  function changeManualAddress() {
    if (discoveryState.view !== 'results' || discoveryState.request.mode !== 'manual') return
    showManualEntry(discoveryState.request)
  }

  function returnToRequest(request: DiscoverRigsRequest) {
    if (request.mode === 'manual') showManualEntry(request)
    else setDiscoveryState({ view: 'start' })
  }

  function changeRigName(rigName: string) {
    if (discoveryState.view !== 'review') return
    setDiscoveryState({ ...discoveryState, rigName })
  }

  const manualCanSubmit = discoveryState.view === 'manual'
    && discoveryState.host.trim().length > 0
    && Number.isInteger(Number(discoveryState.port))
    && Number(discoveryState.port) >= 1
    && Number(discoveryState.port) <= 65535

  const footer = (() => {
    switch (discoveryState.view) {
      case 'start':
        return (
          <>
            <Button onClick={() => showManualEntry()} tone="quiet">Enter an address manually</Button>
            <Button onClick={() => void runDiscovery({ mode: 'scan' })} tone="accent">Scan for rigs</Button>
          </>
        )
      case 'manual':
        return (
          <>
            <Button onClick={() => setDiscoveryState({ view: 'start' })} tone="quiet">Back</Button>
            <Button
              disabled={!manualCanSubmit}
              form={manualDiscoveryFormId}
              tone="accent"
              type="submit"
            >
              Inspect address
            </Button>
          </>
        )
      case 'scanning':
        return <Button onClick={dismiss} tone="quiet">Cancel</Button>
      case 'results':
        return (
          <>
            {discoveryState.request.mode === 'manual' ? (
              <Button onClick={changeManualAddress} tone="quiet">Change address</Button>
            ) : (
              <Button onClick={() => void runDiscovery(discoveryState.request)} tone="quiet">Scan again</Button>
            )}
            <Button disabled={!discoveryState.selected} onClick={reviewCandidate} tone="accent">Review rig</Button>
          </>
        )
      case 'review':
        return <Button onClick={returnToResults} tone="quiet">Back</Button>
      case 'request-failed':
        return (
          <>
            <Button onClick={() => returnToRequest(discoveryState.request)} tone="quiet">Back</Button>
            <Button onClick={() => void runDiscovery(discoveryState.request)} tone="accent">Try again</Button>
          </>
        )
    }
  })()

  const copy = discoveryCopy(discoveryState)

  return (
    <Dialog
      description={copy.description}
      footer={footer}
      onDismiss={dismiss}
      open={open}
      title={copy.title}
    >
      {discoveryState.view === 'start' ? <DiscoveryStart /> : null}
      {discoveryState.view === 'manual' ? (
        <ManualDiscoveryForm
          error={discoveryState.error}
          host={discoveryState.host}
          onHostChange={changeManualHost}
          onPortChange={changeManualPort}
          onSubmit={inspectManualAddress}
          port={discoveryState.port}
        />
      ) : null}
      {discoveryState.view === 'scanning' ? <DiscoveryProgress request={discoveryState.request} /> : null}
      {discoveryState.view === 'results' ? (
        <DiscoveryResults
          onSelectedChange={selectCandidate}
          request={discoveryState.request}
          result={discoveryState.result}
          selected={discoveryState.selected}
        />
      ) : null}
      {discoveryState.view === 'review' ? (
        <RigReview
          candidate={discoveryState.candidate}
          onRigNameChange={changeRigName}
          rigName={discoveryState.rigName}
        />
      ) : null}
      {discoveryState.view === 'request-failed' ? <RequestFailure /> : null}
    </Dialog>
  )
}

function DiscoveryStart() {
  return (
    <div className="rig-discovery-start">
      <DiscoveryOrbit />
      <p>
        Discovery reads Alpaca server information and configured device names. It does
        not connect devices or move hardware.
      </p>
    </div>
  )
}

function DiscoveryProgress({ request }: { request: DiscoverRigsRequest }) {
  const manualEndpoint = request.mode === 'manual' ? `${request.host}:${request.port}` : null

  return (
    <div className="rig-discovery-progress" role="status">
      <DiscoveryScanner />
      <strong>{manualEndpoint ? `Inspecting ${manualEndpoint}` : 'Scanning your local network'}</strong>
      <p>This usually takes only a few seconds.</p>
      <div className="rig-discovery-progress__steps">
        <span data-active="true">{manualEndpoint ? 'Contacting server' : 'Finding servers'}</span>
        <span>Inspecting devices</span>
      </div>
    </div>
  )
}

function RequestFailure() {
  return (
    <div className="rig-discovery-message" data-tone="danger" role="alert">
      <strong>Discovery request failed</strong>
      <p>Check that the Vela server is reachable, then try again.</p>
    </div>
  )
}

function discoveryCopy(state: DiscoveryState) {
  switch (state.view) {
    case 'start':
      return {
        title: 'Find your observatory rig',
        description: 'Vela can look for Alpaca servers on this network or inspect an address you already know.',
      }
    case 'manual':
      return {
        title: 'Enter an Alpaca address',
        description: 'Use the hostname or IP address shown by your Alpaca server.',
      }
    case 'scanning':
      return {
        title: state.request.mode === 'manual' ? 'Inspecting Alpaca address' : 'Looking for rigs',
        description: 'Vela is reading server and device details. No hardware controls are being changed.',
      }
    case 'results':
      return {
        title: state.request.mode === 'manual' ? 'Rig at this address' : 'Rigs on this network',
        description: 'Review what Vela found. Discovery does not change configuration or hardware.',
      }
    case 'review':
      return {
        title: 'Review this rig',
        description: 'Review the server, devices, and proposed name. Nothing has been added yet.',
      }
    case 'request-failed':
      return {
        title: 'Could not look for rigs',
        description: 'Vela could not complete the request. No configuration or hardware was changed.',
      }
  }
}
