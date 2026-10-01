import { useId, useRef } from 'react'
import { Button, Dialog, Input, type DialogProps } from '../../components'
import { devices } from './fixtures'
import '../Dialog.rig-onboarding.specimen.css'

export type RigWorkshopProps = Record<string, string | number | boolean>

export function RigOnboarding({ values, update, openerId, onComplete }: {
  values: RigWorkshopProps
  update: (patch: RigWorkshopProps) => void
  openerId: string
  onComplete: (message: string) => void
}) {
  const stage = String(values.stage)
  const name = String(values.rigName)
  const address = stage.startsWith('address')
  const review = stage === 'review' || stage === 'review-unconfirmed'
  const forget = stage === 'forget'

  const caption = review ? 'Add a rig · Review' : stage === 'empty' ? 'Add a rig · Discovery complete' : ''

  function dialogTitle() {
    if (forget) return `Forget ${name}?`
    
    if (review) return name || 'Review your rig'
    
    if (address) return 'Find a rig by address'
    
    if (stage === 'empty') return 'No rigs found on your network'

    return 'Add a rig'
  }

  const title = dialogTitle()
  const invalidHost = stage === 'address-invalid'
  const invalidPort = stage === 'address-port-invalid'
  const unreachable = stage === 'address-unreachable'
  const id = useId()
  const hostId = `${id}-host`
  const nameId = `${id}-name`
  const cancelId = `${id}-cancel`
  const previous = useRef('start')
  const close = () => update({ stage: 'closed' })
  const focusProps: Pick<DialogProps, 'initialFocusId'> = {}

  if (forget) focusProps.initialFocusId = cancelId

  function inspectAddress() {
    const host = String(values.host).trim()
    const port = Number(values.port)

    if (!host || /[:/\s]/.test(host)) {
      update({ stage: 'address-invalid' })
      document.getElementById(hostId)?.focus()

      return
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      update({ stage: 'address-port-invalid' })
      document.getElementById(`${id}-port`)?.focus()

      return
    }

    previous.current = 'address'
    update({ stage: 'review' })
  }

  return (
    <Dialog
      open={stage !== 'closed'}
      title={title}
      className="vela-rig-onboarding-dialog"
      data-stage={stage}
      data-caption={Boolean(caption)}
      onDismiss={close}
      returnFocusId={openerId}
      {...focusProps}
      showCloseButton={!forget}
    >
      <div className="vela-rig-onboarding__compact-bar">
        <span>{forget ? 'Forget rig' : 'Add a rig'}</span>
        <button type="button" onClick={close}>Cancel</button>
      </div>
      <div className="vela-rig-onboarding__content">
        {caption && <p className="vela-rig-onboarding__context">{caption}</p>}
        <h3 className="vela-rig-onboarding__compact-title">{title}</h3>
        {address ? (
          <>
            <p className="vela-rig-onboarding__intro">Enter the computer running your ALPACA server.</p>
            <form onSubmit={event => { event.preventDefault(); inspectAddress() }}>
              <div className="vela-rig-onboarding__address-fields">
                <Input
                  id={hostId}
                  label="Host or IP address"
                  value={String(values.host)}
                  invalid={invalidHost}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  message={invalidHost ? 'Enter only the hostname or IP address.\nRemove “http://” from this address.' : ''}
                  onChange={event => update({ host: event.target.value })}
                />
                <Input
                  id={`${id}-port`}
                  label="Port"
                  value={String(values.port)}
                  invalid={invalidPort}
                  message={invalidPort ? 'Enter a port from 1 to 65535.' : ''}
                  inputMode="numeric"
                  onChange={event => update({ port: event.target.value })}
                />
              </div>
              {!invalidHost && <p className="vela-rig-onboarding__address-help">Use a hostname or IP address, without http:// or a path.</p>}
              {unreachable && (
                <aside className="vela-rig-onboarding__warning" role="status">
                  <strong>Could not reach this server</strong>
                  <p>No response from {String(values.host)}:{String(values.port)}. Check the address and that the ALPACA server is running.</p>
                  <details><summary>Technical details</summary><p>Sample network timeout. No network request was made.</p></details>
                </aside>
              )}
              <div className="vela-rig-onboarding__address-actions">
                <Button type="submit" tone="accent">{unreachable ? 'Try again' : 'Find rig'}</Button>
                <Button type="button" onClick={() => update({ stage: 'start' })}>Back to network scan</Button>
              </div>
            </form>
            <p className="vela-rig-onboarding__consequence">Finding a rig reads its available devices. It does not connect them or move the mount.</p>
          </>
        ) : review ? (
          <>
            <Input id={nameId} label="Rig name" value={name} onChange={event => update({ rigName: event.target.value })} />
            <p className="vela-rig-onboarding__endpoint">Found at {String(values.host)} · Port {String(values.port)}</p>
            <p className="vela-rig-onboarding__device-count">4 devices available</p>
            <ul className="vela-rig-onboarding__devices">
              {[devices[0], devices[3], devices[1], devices[2]].map(device => <li key={device.id}><span>{device.name}</span><span>{device.kind}</span></li>)}
            </ul>
            <p className="vela-rig-onboarding__review-consequence">Adding saves this rig in Vela. Connect its devices from Equipment when you’re ready.</p>
            {stage === 'review-unconfirmed' && (
              <aside className="vela-rig-onboarding__warning" role="status">
                <strong>Adding this rig could not be confirmed</strong>
                <p>The response was interrupted. Check whether the rig was saved before trying to add it again.</p>
                <Button onClick={() => onComplete('Workshop example: checking the saved rig. No Add request is repeated.')}>Check saved rig</Button>
              </aside>
            )}
            <div className="vela-rig-onboarding__footer">
              <Button onClick={() => update({ stage: previous.current })}>Back</Button>
              <Button tone="accent" disabled={!name.trim() || stage === 'review-unconfirmed'} onClick={() => { close(); onComplete('Workshop example: rig added. No server configuration was written.') }}>Add rig</Button>
            </div>
          </>
        ) : forget ? (
          <>
            <p>Remove this rig’s saved configuration from Vela. This does not change its ALPACA server or hardware. You can discover and add it again later.</p>
            <div className="vela-rig-onboarding__footer vela-rig-onboarding__footer--end">
              <Button id={cancelId} onClick={close}>Cancel</Button>
              <Button tone="accent" onClick={() => { close(); onComplete('Workshop example: rig forgotten. No configuration was removed.') }}>Forget rig</Button>
            </div>
          </>
        ) : (
          <>
            <p>{stage === 'empty'
              ? 'Make sure the ALPACA server is running on the local network, or enter its address directly.'
              : 'Find the computer that serves your astronomy devices on this local network.'}</p>
            <div className="vela-rig-onboarding__entry-actions">
              <Button onClick={() => { previous.current = 'start'; update({ stage: 'review' }) }}>{stage === 'empty' ? 'Scan again' : 'Scan the network'}</Button>
              <Button tone="accent" onClick={() => update({ stage: 'address' })}>Enter address</Button>
            </div>
            <p className="vela-rig-onboarding__consequence">Workshop example · Sample devices · No network scan or hardware commands.</p>
          </>
        )}
      </div>
    </Dialog>
  )
}
