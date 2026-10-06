import type { MountControlAction, MountControlView, RigDetailView, RigTelescopeDeviceView } from '@vela/model/web'
import { Button } from '@vela/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { checkMountCommand, sendMountCommand } from './mount-control-api'

type Command = NonNullable<MountControlView['command']> & { serverInstanceId: string }

const confirmed = {
  unpark: 'Mount confirmed unparked.',
  'tracking-on': 'Tracking confirmed on.',
  'tracking-off': 'Tracking confirmed off.',
}

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
  const requestInFlight = useRef(false)
  const mounted = useRef(false)
  const messageId = useId()

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
    requestInFlight.current = true
    const requestId = crypto.randomUUID()
    const serverInstanceId = view.serverInstanceId

    setSending(true)
    setCheckMessage('')
    setLocal({ requestId, serverInstanceId, action, state: 'pending', message: null })

    try {
      const result = await sendMountCommand(rigId, device.id, action, requestId, serverInstanceId)

      if (!mounted.current) return
      setLocal(result.command && { ...result.command, serverInstanceId })
      await refresh()
    } catch (error) {
      if (!mounted.current) return
      const rejected = error instanceof ApiError && [400, 404, 409].includes(error.status)

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
          setCheckMessage('Vela restarted and cannot establish the previous command’s outcome. Reload Your rig to inspect current state before choosing a new action. The old request will not be repeated.')
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
      : !tracking.enabled ? tracking.reason : null

  const outcome = command?.state === 'confirmed' ? confirmed[command.action] : command?.message

  const message = pending ? 'Waiting for the mount to confirm the change…'
    : checkMessage || outcome || reason || 'Tracking follows the sky. It does not slew to your selected subject.'

  return (
    <div className="equipment__mount-controls" aria-label="Mount controls">
      <div className="equipment__mount-actions">
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
          aria-busy={pending && command?.action !== 'unpark'}
          aria-describedby={messageId}
          onClick={() => void execute(trackingOn ? 'tracking-off' : 'tracking-on')}
        >
          {pending && command?.action === 'tracking-on' ? 'Turning tracking on…'
            : pending && command?.action === 'tracking-off' ? 'Turning tracking off…'
              : trackingOn ? 'Turn tracking off' : 'Turn tracking on'}
        </Button>
        {(stale || unconfirmed || command?.state === 'failed' || !!reason) && (
          <Button disabled={pending || checking} aria-busy={checking} onClick={() => void check()}>
            {checking ? 'Checking mount state…' : 'Check mount state'}
          </Button>
        )}
        {serverRestarted && <Button onClick={() => window.location.reload()}>Reload Your rig</Button>}
      </div>
      <p id={messageId} role="status">{message}</p>
      {reason && reason !== message && <p>{reason}</p>}
    </div>
  )
}
