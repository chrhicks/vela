import { Button } from '@vela/ui'
import { useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { useRigObservation } from './RigContext'

/**
 * An operation on this device ended uncertain. Cria does not hold the device, so this is a
 * warning with Cria's reason. It goes at the device's next confirmed command, or on Dismiss.
 */
export function DeviceWarning({ deviceName, warning }: {
  readonly deviceName: string
  readonly warning: { readonly deviceId: string; readonly reason: string }
}) {
  const rig = useRigObservation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  if (!rig) return null

  async function dismiss() {
    if (!rig) return
    setPending(true)
    setError('')

    try {
      await api(`rigs/${encodeURIComponent(rig.rigId)}/devices/${encodeURIComponent(warning.deviceId)}/warning`, { method: 'DELETE' })
      await rig.refresh({ force: true })
    } catch (failure) {
      setError(failure instanceof ApiError ? `Vela could not dismiss this. ${failure.message}.` : 'Vela did not hear back, so the warning may still be there.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="device-warning" role="group" aria-label={`${deviceName} warning`}>
      <div>
        <p>A command on {deviceName} ended with an unknown outcome. It is not held.</p>
        <p>{warning.reason}</p>
        {error && <p role="alert">{error}</p>}
      </div>
      <Button disabled={pending} pending={pending} onClick={() => void dismiss()}>Dismiss</Button>
    </div>
  )
}
