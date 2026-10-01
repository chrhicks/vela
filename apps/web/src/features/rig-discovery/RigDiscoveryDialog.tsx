import type { DiscoveryCandidateView, DiscoveryResultView } from '@vela/model/rig'
import { Button, Dialog } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import { addRig, AddRigError } from './add-rig'
import { discoverRigs, DiscoverRigsError, type DiscoverRigsRequest } from './discover-rigs'
import { DiscoveryResults } from './DiscoveryResults'
import {
  ManualDiscoveryForm,
  manualDiscoveryFormId,
  manualHostId,
  manualPortId,
} from './ManualDiscoveryForm'
import { RigReview } from './RigReview'
import { isDiscoveryHost } from './manual-address'
import './RigDiscoveryDialog.css'

interface Props {
  open: boolean
  onAdded(): Promise<void>
  onDismiss(): void
}

type DiscoveryState =
  | { view: 'start' }
  | {
      view: 'manual'
      host: string
      port: string
      error?: string
      portError?: string
      warning?: string
    }
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
      status: 'ready' | 'adding' | 'unconfirmed' | 'checking'
      error?: string
    }
  | { view: 'request-failed'; request: DiscoverRigsRequest }

export default function RigDiscoveryDialog({ open, onAdded, onDismiss }: Props) {
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>({ view: 'start' })
  const requestController = useRef<AbortController | null>(null)
  const manualDraft = useRef({ host: '', port: '11111' })
  const nameDrafts = useRef(new Map<string, string>())

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
        if (
          request.mode === 'manual' &&
          result.candidates.length === 0 &&
          result.failures.length > 0 &&
          result.failures.every((failure) => failure.reason === 'unreachable')
        ) {
          setDiscoveryState({
            view: 'manual',
            host: request.host,
            port: String(request.port),
            warning: `No response from ${request.host}:${request.port}. Check the address and that the ALPACA server is running.`,
          })
        } else setDiscoveryState({ view: 'results', request, result, selected: null })
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
    if (
      discoveryState.view === 'review' &&
      (discoveryState.status === 'adding' || discoveryState.status === 'checking')
    )
      return
    requestController.current?.abort()
    requestController.current = null
    setDiscoveryState({ view: 'start' })
    onDismiss()
  }

  function showManualEntry(request?: Extract<DiscoverRigsRequest, { mode: 'manual' }>) {
    setDiscoveryState({
      view: 'manual',
      host: request?.host ?? manualDraft.current.host,
      port: request ? String(request.port) : manualDraft.current.port,
    })
  }

  function inspectManualAddress() {
    if (discoveryState.view !== 'manual') return

    const host = discoveryState.host.trim()
    const port = Number(discoveryState.port)

    if (!isDiscoveryHost(host)) {
      setDiscoveryState({
        ...discoveryState,
        error: host.startsWith('http://')
          ? 'Enter only the hostname or IP address.\nRemove “http://” from this address.'
          : 'Enter a hostname or IPv4 address without a URL, path, or port.',
      })
      document.getElementById(manualHostId)?.focus()

      return
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setDiscoveryState({ ...discoveryState, portError: 'Enter a port from 1 to 65535.' })
      document.getElementById(manualPortId)?.focus()

      return
    }

    void runDiscovery({ mode: 'manual', host, port })
  }

  function changeManualHost(host: string) {
    if (discoveryState.view !== 'manual') return
    manualDraft.current = { host, port: discoveryState.port }
    setDiscoveryState({ ...discoveryState, host, error: undefined, warning: undefined })
  }

  function changeManualPort(port: string) {
    if (discoveryState.view !== 'manual') return
    manualDraft.current = { host: discoveryState.host, port }
    setDiscoveryState({ ...discoveryState, port, portError: undefined, warning: undefined })
  }

  function selectCandidate(candidate: DiscoveryCandidateView | null) {
    if (discoveryState.view !== 'results') return
    setDiscoveryState({ ...discoveryState, selected: candidate })
  }

  function reviewCandidate() {
    if (discoveryState.view !== 'results' || discoveryState.selected?.disposition.state !== 'new')
      return

    const candidate = discoveryState.selected
    setDiscoveryState({
      view: 'review',
      request: discoveryState.request,
      result: discoveryState.result,
      candidate,
      rigName:
        nameDrafts.current.get(endpointKey(candidate)) ??
        (candidate.server?.name?.trim() || candidate.endpoint.host),
      status: 'ready',
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
    nameDrafts.current.set(endpointKey(discoveryState.candidate), rigName)
    setDiscoveryState({ ...discoveryState, rigName, error: undefined })
  }

  async function addReviewedRig() {
    if (
      discoveryState.view !== 'review' ||
      discoveryState.status !== 'ready' ||
      requestController.current ||
      !discoveryState.rigName.trim()
    )
      return

    const review = discoveryState
    const controller = new AbortController()
    requestController.current = controller
    setDiscoveryState({ ...review, status: 'adding', error: undefined })

    try {
      await addRig(review.rigName.trim(), review.candidate.endpoint, controller.signal)

      if (requestController.current !== controller) return

      requestController.current = null
      void onAdded()
    } catch (error) {
      if (!controller.signal.aborted && requestController.current === controller) {
        setDiscoveryState({
          ...review,
          status:
            !(error instanceof AddRigError) ||
            error.reason === 'unconfirmed' ||
            error.reason === 'already-added'
              ? 'unconfirmed'
              : 'ready',
          error: addRigFailureMessage(error instanceof AddRigError ? error : null),
        })
      }
    } finally {
      if (requestController.current === controller) requestController.current = null
    }
  }

  async function checkSavedRig() {
    if (
      discoveryState.view !== 'review' ||
      discoveryState.status !== 'unconfirmed' ||
      requestController.current
    )
      return
    const review = discoveryState
    const controller = new AbortController()
    requestController.current = controller
    setDiscoveryState({ ...review, status: 'checking' })

    try {
      const request: DiscoverRigsRequest = { mode: 'manual', ...review.candidate.endpoint }
      const result = await discoverRigs(request, controller.signal)

      if (requestController.current !== controller) return

      const candidate = result.candidates.find(
        (item) => item.endpoint.host === request.host && item.endpoint.port === request.port,
      )

      if (!candidate) throw new Error('Endpoint could not be inspected')

      if (candidate.disposition.state === 'already-added') {
        requestController.current = null
        void onAdded()
      } else if (candidate.disposition.state === 'new') {
        setDiscoveryState({
          ...review,
          candidate,
          result,
          status: 'ready',
          error: 'This endpoint is not saved. You can explicitly add the inspected rig.',
        })
      } else {
        setDiscoveryState({ view: 'results', request, result, selected: null })
      }
    } catch {
      if (!controller.signal.aborted && requestController.current === controller)
        setDiscoveryState({
          ...review,
          status: 'unconfirmed',
          error:
            'The saved state is still unknown. Vela could not inspect this endpoint. Check again before adding.',
        })
    } finally {
      if (requestController.current === controller) requestController.current = null
    }
  }

  const footer = (() => {
    switch (discoveryState.view) {
      case 'start':
        return (
          <>
            <Button onClick={() => void runDiscovery({ mode: 'scan' })}>Scan the network</Button>
            <Button onClick={() => showManualEntry()} tone="accent">
              Enter address
            </Button>
          </>
        )
      case 'manual':
        return (
          <>
            <Button form={manualDiscoveryFormId} tone="accent" type="submit">
              {discoveryState.warning ? 'Try again' : 'Find rig'}
            </Button>
            <Button onClick={() => setDiscoveryState({ view: 'start' })}>
              Back to network scan
            </Button>
          </>
        )
      case 'scanning':
        return (
          <Button onClick={dismiss} tone="quiet">
            Cancel
          </Button>
        )
      case 'results':
        return (
          <>
            {discoveryState.request.mode === 'manual' ? (
              <Button onClick={changeManualAddress}>
                Change address
              </Button>
            ) : (
              <Button onClick={() => void runDiscovery(discoveryState.request)}>
                Scan again
              </Button>
            )}
            {discoveryState.result.candidates.length === 0 ? (
              <Button onClick={() => showManualEntry()} tone="accent">
                Enter address
              </Button>
            ) : (
              <Button disabled={!discoveryState.selected} onClick={reviewCandidate} tone="accent">
                Review rig
              </Button>
            )}
          </>
        )
      case 'review':
        return (
          <>
            <Button
              disabled={discoveryState.status !== 'ready'}
              onClick={returnToResults}
            >
              Back
            </Button>
            <Button
              disabled={discoveryState.status !== 'ready' || !discoveryState.rigName.trim()}
              onClick={() => void addReviewedRig()}
              tone="accent"
            >
              {discoveryState.status === 'adding' ? 'Adding rig…' : 'Add rig'}
            </Button>
          </>
        )
      case 'request-failed':
        return (
          <>
            <Button onClick={() => returnToRequest(discoveryState.request)} tone="quiet">
              Back
            </Button>
            <Button onClick={() => void runDiscovery(discoveryState.request)} tone="accent">
              Try again
            </Button>
          </>
        )
    }
  })()

  const title = discoveryTitle(discoveryState)

  const busy =
    discoveryState.view === 'review' &&
    (discoveryState.status === 'adding' || discoveryState.status === 'checking')

  const caption =
    discoveryState.view === 'review'
      ? 'Add a rig · Review'
      : discoveryState.view === 'results' && discoveryState.result.candidates.length === 0
        ? 'Add a rig · Discovery complete'
        : ''

  return (
    <Dialog
      className="vela-rig-onboarding-dialog"
      data-caption={Boolean(caption)}
      data-entry={discoveryState.view === 'start' || (discoveryState.view === 'results' && discoveryState.result.candidates.length === 0)}
      returnFocusId="home-add-rig"
      onDismiss={busy ? undefined : dismiss}
      open={open}
      title={title}
    >
      <div className="vela-rig-onboarding__compact-bar">
        <span>Add a rig</span>
        <button type="button" disabled={busy} onClick={dismiss}>
          Cancel
        </button>
      </div>
      <div className="vela-rig-onboarding__content">
        {caption && <p className="vela-rig-onboarding__context">{caption}</p>}
        <h3 className="vela-rig-onboarding__compact-title">{title}</h3>
        {discoveryState.view === 'start' ? <DiscoveryStart /> : null}
        {discoveryState.view === 'manual' ? (
          <ManualDiscoveryForm
            error={discoveryState.error}
            portError={discoveryState.portError}
            warning={discoveryState.warning}
            host={discoveryState.host}
            onHostChange={changeManualHost}
            onPortChange={changeManualPort}
            onSubmit={inspectManualAddress}
            port={discoveryState.port}
          />
        ) : null}
        {discoveryState.view === 'scanning' ? (
          <DiscoveryProgress request={discoveryState.request} />
        ) : null}
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
            adding={Boolean(busy || discoveryState.status === 'unconfirmed')}
            candidate={discoveryState.candidate}
            error={discoveryState.error}
            onRigNameChange={changeRigName}
            rigName={discoveryState.rigName}
          />
        ) : null}
        {discoveryState.view === 'request-failed' ? <RequestFailure /> : null}
        {discoveryState.view === 'review' &&
          (discoveryState.status === 'unconfirmed' || discoveryState.status === 'checking') && (
            <Button disabled={busy} onClick={() => void checkSavedRig()}>
              {discoveryState.status === 'checking' ? 'Checking saved rig…' : 'Check saved rig'}
            </Button>
          )}
        <div
          className={
            discoveryState.view === 'manual'
              ? 'vela-rig-onboarding__address-actions'
              : 'vela-rig-onboarding__footer'
          }
        >
          {footer}
        </div>
        {discoveryState.view !== 'review' && (
          <p className="vela-rig-onboarding__consequence">
            Finding a rig reads its available devices. It does not connect them or move the mount.
          </p>
        )}
      </div>
    </Dialog>
  )
}

function DiscoveryStart() {
  return (
    <div className="rig-discovery-start">
      <p>Find the computer that serves your astronomy devices on this local network.</p>
    </div>
  )
}

function DiscoveryProgress({ request }: { request: DiscoverRigsRequest }) {
  const manualEndpoint = request.mode === 'manual' ? `${request.host}:${request.port}` : null

  return (
    <div className="rig-discovery-progress" role="status">
      <strong>
        {manualEndpoint ? `Inspecting ${manualEndpoint}` : 'Scanning your local network'}
      </strong>
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

function addRigFailureMessage(error: AddRigError | null): string {
  if (!(error instanceof AddRigError)) {
    return 'Adding this rig could not be confirmed. Check whether the rig was saved before trying again.'
  }

  switch (error.reason) {
    case 'already-added':
      return 'This rig is already in Vela. Check the saved rig to refresh your catalog.'
    case 'conflict':
      return 'This server now conflicts with another saved rig. Scan again before continuing.'
    case 'inspection-failed':
      return 'Vela could not confirm the server and devices. Check the address and try again.'
    case 'no-stable-device-id':
      return 'The server no longer reports a stable device ID, so Vela cannot add it safely.'
    case 'rejected':
      return 'The server rejected this rig. Check its details before trying again.'
    case 'unconfirmed':
      return 'Adding this rig could not be confirmed. Check whether the rig was saved before trying again.'
  }
}

function discoveryTitle(state: DiscoveryState): string {
  switch (state.view) {
    case 'start':
      return 'Add a rig'
    case 'manual':
      return 'Find a rig by address'
    case 'scanning':
      return state.request.mode === 'manual' ? 'Inspecting Alpaca address' : 'Looking for rigs'
    case 'results':
      if (state.request.mode === 'manual') return 'Rig at this address'

      if (state.result.candidates.length === 0 && state.result.failures.length === 0) {
        return 'No rigs found on your network'
      }

      return 'Rigs on this network'
    case 'review':
      return state.candidate.server?.name || state.candidate.endpoint.host
    case 'request-failed':
      return 'Could not look for rigs'
  }
}

function endpointKey(candidate: DiscoveryCandidateView): string {
  return `${candidate.endpoint.host}:${candidate.endpoint.port}`
}
