import type { DewControlAction, DewControlView, RigDetailView, RigSwitchDeviceView } from '@vela/model/web'
import { Button, Checkbox, Input } from '@vela/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { checkDewCommand, sendDewCommand } from '../rig-detail/dew-control-api'
import { createRequestId } from '../rig-detail/mount-control-api'

type Command = NonNullable<DewControlView['command']> & { serverInstanceId: string }

const dutyText = (percent: number | null) =>
  percent === null ? 'Not reported' : `${percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`

export function DewControls({ rigId, device, stale, refresh }: {
  rigId: string
  device: RigSwitchDeviceView
  stale: boolean
  refresh(): Promise<RigDetailView | undefined>
}) {
  const view = device.dewControl
  const [local, setLocal] = useState<Command | null>(null)
  const [sending, setSending] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkMessage, setCheckMessage] = useState('')
  const [serverRestarted, setServerRestarted] = useState(false)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
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

  async function execute(action: DewControlAction) {
    if (requestInFlight.current || !view) return
    const requestId = createRequestId()
    const serverInstanceId = view.serverInstanceId

    requestInFlight.current = true

    try {
      setSending(true)
      setCheckMessage('')
      setLocal({ requestId, serverInstanceId, action, state: 'pending', message: null })
      const result = await sendDewCommand(rigId, device.id, action, requestId, serverInstanceId)

      if (!mounted.current) return
      setLocal(result.command && { ...result.command, serverInstanceId })

      if (action.kind === 'duty' && result.command?.state === 'confirmed')
        setDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== action.channelId)))
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
          ? 'The change was not accepted. Check the current dew heater state before continuing.'
          : 'The reply was lost. Check the dew heaters before another change; Vela has not repeated the request.',
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
        const result = await checkDewCommand(rigId, device.id, local)

        if (!mounted.current) return

        if (result.admission === 'not-admitted') {
          setLocal(null)
          setCheckMessage('No dew heater change was admitted. The old request is cancelled.')
        } else if (result.admission === 'unknown') {
          setServerRestarted(true)
          setCheckMessage('Vela restarted and cannot establish the previous change’s outcome. Reload the page to see the dew heaters as they are. The old request will not be repeated.')
        } else if (result.control.serverInstanceId === local.serverInstanceId && result.control.command?.requestId === local.requestId) {
          setLocal({ ...result.control.command, serverInstanceId: local.serverInstanceId })
        }
      }

      await refresh()
    } catch {
      if (mounted.current) setCheckMessage('The dew heaters could not be checked. No change has been repeated.')
    } finally {
      if (mounted.current) setChecking(false)
    }
  }

  if (!view) return null

  const command = local && (view.serverInstanceId !== local.serverInstanceId || view.command?.requestId !== local.requestId)
    ? local : view.command ?? local

  const pending = sending || command?.state === 'pending'
  const unconfirmed = command?.state === 'uncertain'
  const disabled = stale || pending || unconfirmed || checking

  const outcome = command?.state === 'confirmed' ? command.message ?? 'The power box confirmed the change.' : command?.message

  const reason = stale ? 'Current dew heater state is unavailable. The values above are last known.' : view.auto?.set.reason ?? null

  const message = pending ? 'Waiting for the power box to confirm the change…'
    : checkMessage || outcome || reason || 'Auto dew lets the box set each duty. A fixed duty applies until you change it.'

  return (
    <div className="rig-controls__dew" aria-label="Dew heater controls">
      <dl>
        {view.channels.map(channel => (
          <div key={channel.id}>
            <dt>{channel.name}</dt>
            <dd>{dutyText(channel.dutyPercent)}</dd>
          </div>
        ))}
      </dl>
      {view.auto && (
        <Checkbox
          label="Auto dew"
          description={pending && command?.action.kind === 'auto' ? 'Confirming Auto dew…' : 'The box sets each heater’s duty from the dew point.'}
          checked={view.auto.on === true}
          disabled={disabled || !view.auto.set.enabled}
          onChange={event => void execute({ kind: 'auto', on: event.target.checked })}
        />
      )}
      {view.channels.map(channel => {
        const requested = drafts[channel.id] ?? (channel.dutyPercent === null ? '' : String(Math.round(channel.dutyPercent)))
        const percent = Number(requested)
        const valid = requested.trim() !== '' && Number.isFinite(percent) && percent >= 0 && percent <= 100

        return (
          <form
            key={channel.id}
            onSubmit={event => {
              event.preventDefault()

              if (valid) void execute({ kind: 'duty', channelId: channel.id, percent })
            }}
          >
            <Input
              label={`${channel.name} · fixed duty`}
              type="number"
              min="0"
              max="100"
              step="1"
              inputMode="numeric"
              value={requested}
              disabled={disabled || !channel.set.enabled}
              invalid={!valid && channel.set.enabled}
              message={channel.set.enabled ? valid ? 'Choose 0 to 100.' : 'Choose a whole number from 0 to 100.' : channel.set.reason ?? undefined}
              onChange={event => setDrafts(current => ({ ...current, [channel.id]: event.target.value }))}
            />
            <Button
              type="submit"
              disabled={disabled || !channel.set.enabled || !valid}
              aria-busy={pending && command?.action.kind === 'duty' && command.action.channelId === channel.id}
              aria-describedby={messageId}
            >
              {pending && command?.action.kind === 'duty' && command.action.channelId === channel.id ? 'Confirming…' : 'Set duty'}
            </Button>
          </form>
        )
      })}
      <p id={messageId} role="status">{message}</p>
      {(stale || unconfirmed || command?.state === 'failed') && (
        <div className="rig-controls__actions">
          <Button disabled={pending || checking} aria-busy={checking} onClick={() => void check()}>
            {checking ? 'Checking dew heaters…' : 'Check dew heaters'}
          </Button>
          {serverRestarted && <Button onClick={() => window.location.reload()}>Reload the page</Button>}
        </div>
      )}
    </div>
  )
}
