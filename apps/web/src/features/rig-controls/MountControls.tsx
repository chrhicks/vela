import type { MountControlAction, MountControlView, RigDetailView, RigTelescopeDeviceView } from '@vela/model/web'
import { Button, Dialog } from '@vela/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { checkMountCommand, createRequestId, sendMountCommand, stopMount } from '../rig-detail/mount-control-api'

type Command = NonNullable<MountControlView['command']> & { serverInstanceId: string }

const trackingLabels = { on: 'Tracking on', off: 'Tracking off', unknown: 'Tracking unknown' }

const parkingLabels = { parked: 'Parked', unparked: 'Not parked', unknown: 'Parking unknown' }

const confirmed = {
  unpark: 'Mount confirmed unparked.',
  'tracking-on': 'Tracking confirmed on.',
  'tracking-off': 'Tracking confirmed off.',
  home: 'Homing finished.',
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })

export function MountControls({ rigId, device, stale, refresh }: {
  rigId: string
  device: RigTelescopeDeviceView
  stale: boolean
  refresh(): Promise<RigDetailView | undefined>
}) {
  const view = device.mountControl
  const [local, setLocal] = useState<Command | null>(null)
  const [sending, setSending] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkMessage, setCheckMessage] = useState('')
  const [serverRestarted, setServerRestarted] = useState(false)
  const [confirmingHome, setConfirmingHome] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [stopResult, setStopResult] = useState<Awaited<ReturnType<typeof stopMount>> | null>(null)
  const requestInFlight = useRef(false)
  const stopInFlight = useRef(false)
  const mounted = useRef(false)
  const messageId = useId()
  const homeOpenerId = useId()
  const homeCancelId = useId()

  useEffect(() => {
    mounted.current = true

    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!sending && local && view?.serverInstanceId === local.serverInstanceId && view.command?.requestId === local.requestId && view.command.state !== 'pending')
      setLocal(null)
  }, [local, sending, view?.command, view?.serverInstanceId])

  async function execute(action: MountControlAction) {
    if (requestInFlight.current || !view) return
    const requestId = createRequestId()
    const serverInstanceId = view.serverInstanceId

    // The lock is taken only where the finally below releases it.
    requestInFlight.current = true

    try {
      setSending(true)
      setCheckMessage('')
      setStopResult(null)
      setLocal({ requestId, serverInstanceId, action, state: 'pending', message: null })
      const result = await sendMountCommand(rigId, device.id, action, requestId, serverInstanceId)

      if (!mounted.current) return
      setStopResult(null)
      setLocal(result.command && { ...result.command, serverInstanceId })
      await refresh()
    } catch (error) {
      if (!mounted.current) return
      const rejected = error instanceof ApiError && [400, 404, 409].includes(error.status)

      setStopResult(null)
      setLocal({
        requestId,
        serverInstanceId,
        action,
        state: rejected ? 'failed' : 'uncertain',
        message: rejected
          ? 'The command was not accepted. Check the current mount state before continuing.'
          : 'The command response was lost. Check mount state before another command; Vela has not repeated the request.',
      })
      await refresh()
    } finally {
      requestInFlight.current = false

      if (mounted.current) setSending(false)
    }
  }

  /** Never gated by a command of this panel: a Stop must reach a mount that is mid-home or mid-slew. */
  async function stop() {
    if (stopInFlight.current) return
    stopInFlight.current = true
    setStopping(true)
    setStopResult(null)

    try {
      const result = await stopMount(rigId, device.id)

      if (mounted.current) setStopResult(result)
    } catch {
      if (mounted.current) setStopResult({ outcome: 'uncertain', message: 'The stop request failed or its reply was lost. Check the mount, and press Stop again if it is still moving.' })
    } finally {
      stopInFlight.current = false

      if (mounted.current) setStopping(false)
    }

    if (mounted.current) await refresh()
  }

  async function check() {
    setChecking(true)
    setCheckMessage('')

    try {
      if (local?.state === 'uncertain') {
        const result = await checkMountCommand(rigId, device.id, local)

        if (!mounted.current) return

        if (result.admission === 'not-admitted') {
          setLocal(null)
          setCheckMessage('No mount command was admitted. The old request is cancelled.')
        } else if (result.admission === 'unknown') {
          setServerRestarted(true)
          setCheckMessage('Vela restarted and cannot establish the previous command’s outcome. Reload the page to inspect current state before choosing a new action. The old request will not be repeated.')
        } else if (result.control.serverInstanceId === local.serverInstanceId && result.control.command?.requestId === local.requestId) {
          setLocal({ ...result.control.command, serverInstanceId: local.serverInstanceId })
        }
      }

      await refresh()
    } catch {
      if (mounted.current) setCheckMessage('Mount state could not be checked. No command has been repeated.')
    } finally {
      if (mounted.current) setChecking(false)
    }
  }

  if (!view) return null

  const status = device.connection === 'connected' && device.status.availability !== 'unsupported'
    ? device.status : null

  const command = local && (view.serverInstanceId !== local.serverInstanceId || view.command?.requestId !== local.requestId)
    ? local : view.command ?? local

  const pending = sending || command?.state === 'pending'
  const unconfirmed = command?.state === 'uncertain'
  const trackingOn = status?.tracking === 'on'
  const tracking = trackingOn ? view.trackingOff : view.trackingOn
  const showUnpark = status?.parking !== 'unparked'
  const disabled = stale || pending || unconfirmed || checking

  const reason = stale ? 'Current mount state is unavailable. The values above are last known.'
    : showUnpark && !view.unpark.enabled ? view.unpark.reason
      : !tracking.enabled ? tracking.reason
        : !view.home.enabled ? view.home.reason : null

  const reading = status ? `${trackingLabels[status.tracking]} · ${parkingLabels[status.parking]}` : 'Mount state unavailable'

  const outcome = command?.state === 'confirmed' ? confirmed[command.action] : command?.message

  const homing = pending && command?.action === 'home'

  const stopMessage = stopResult?.outcome === 'confirmed' ? 'Stopped. The mount confirmed it is still.' : stopResult?.message

  const message = stopping ? 'Stopping…'
    : stopMessage ? stopMessage
      : homing ? 'Homing… Stop ends it.'
        : pending ? 'Waiting for the mount to confirm the change…'
          : checkMessage || outcome || reason || 'Tracking follows the sky. It does not slew to your selected subject.'

  return (
    <div className="rig-controls__mount" aria-label="Mount controls">
      <p className="rig-controls__reading">{stale && status ? `${reading} · last known` : reading}</p>
      {view.homeConfirmedAt && !homing && <p className="rig-controls__home">Home confirmed at <time dateTime={view.homeConfirmedAt}>{clock(view.homeConfirmedAt)}</time></p>}
      <div className="rig-controls__actions">
        {showUnpark && (
          <Button
            disabled={disabled || !view.unpark.enabled}
            aria-busy={pending && command?.action === 'unpark'}
            aria-describedby={messageId}
            onClick={() => void execute('unpark')}
          >
            {pending && command?.action === 'unpark' ? 'Unparking…' : 'Unpark mount'}
          </Button>
        )}
        <Button
          disabled={disabled || !tracking.enabled}
          aria-busy={pending && (command?.action === 'tracking-on' || command?.action === 'tracking-off')}
          aria-describedby={messageId}
          onClick={() => void execute(trackingOn ? 'tracking-off' : 'tracking-on')}
        >
          {pending && command?.action === 'tracking-on' ? 'Turning tracking on…'
            : pending && command?.action === 'tracking-off' ? 'Turning tracking off…'
              : trackingOn ? 'Turn tracking off' : 'Turn tracking on'}
        </Button>
        <Button
          id={homeOpenerId}
          disabled={disabled || !view.home.enabled}
          aria-busy={homing}
          aria-describedby={messageId}
          onClick={() => setConfirmingHome(true)}
        >
          {homing ? 'Homing…' : 'Home'}
        </Button>
        <Button
          tone="accent"
          disabled={!(view.stop.enabled || pending || unconfirmed) || stopping}
          aria-busy={stopping}
          onClick={() => void stop()}
        >
          {stopping ? 'Stopping…' : 'Stop'}
        </Button>
        {(stale || unconfirmed || command?.state === 'failed' || !!reason) && (
          <Button disabled={pending || checking} aria-busy={checking} onClick={() => void check()}>
            {checking ? 'Checking mount state…' : 'Check mount state'}
          </Button>
        )}
        {serverRestarted && <Button onClick={() => window.location.reload()}>Reload the page</Button>}
      </div>
      <p id={messageId} role="status">{message}</p>
      {reason && reason !== message && <p>{reason}</p>}
      {!view.stop.enabled && !pending && !unconfirmed && view.stop.reason && <p>Stop is off. {view.stop.reason}</p>}
      <Dialog
        open={confirmingHome}
        title="Are you sure?"
        showCloseButton={false}
        initialFocusId={homeCancelId}
        returnFocusId={homeOpenerId}
        onDismiss={() => setConfirmingHome(false)}
        footer={<>
          <Button id={homeCancelId} onClick={() => setConfirmingHome(false)}>Cancel</Button>
          <Button tone="accent" onClick={() => { setConfirmingHome(false); void execute('home') }}>Home the mount</Button>
        </>}
      />
    </div>
  )
}
