import type { RigDetailView } from '@vela/model/web'
import { Button, Dialog } from '@vela/ui'
import { useId, useRef, useState } from 'react'
import { clearHold } from '../rig-detail/clear-hold-api'

export const busyMessage = 'An operation is still running on this device. Stop it first.'

export function ClearHold({ rigId, deviceName, hold, refresh }: {
  readonly rigId: string
  readonly deviceName: string
  readonly hold: { readonly deviceId: string; readonly reason: string }
  readonly refresh: () => Promise<RigDetailView | undefined>
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const openerId = useId()
  const cancelId = useId()

  async function confirm() {
    if (sending.current) return
    sending.current = true
    setPending(true)
    setError('')

    try {
      const result = await clearHold(rigId, hold.deviceId)

      if (result.kind === 'cleared') {
        setOpen(false)
        await refresh()
      } else {
        setError(result.kind === 'busy' ? busyMessage : result.message)
      }
    } finally {
      sending.current = false
      setPending(false)
    }
  }

  return (
    <>
      <Button id={openerId} onClick={() => { setError(''); setOpen(true) }}>Clear hold</Button>
      <Dialog
        className="rig-controls__hold-dialog"
        open={open}
        title={`Clear the hold on ${deviceName}?`}
        showCloseButton={false}
        initialFocusId={cancelId}
        returnFocusId={openerId}
        onDismiss={pending ? undefined : () => setOpen(false)}
        footer={<>
          <Button id={cancelId} disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
          <Button tone="accent" disabled={pending} pending={pending} onClick={() => void confirm()}>
            {pending ? 'Clearing the hold…' : 'I have checked it, clear the hold'}
          </Button>
        </>}
      >
        <p>{hold.reason}</p>
        <p>Clearing the hold tells Cria it is safe to command {deviceName} again. Only do this after you have checked the equipment.</p>
        {error && <p role="alert">{error}</p>}
      </Dialog>
    </>
  )
}
