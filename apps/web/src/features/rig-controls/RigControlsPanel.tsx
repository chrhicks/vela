import { Checkbox } from '@vela/ui'
import { useEffect } from 'react'
import { pagingLabel } from '../alerts/presentation'
import { useCapture } from '../capture/use-capture'
import { useRigObservation } from '../rig-detail/RigContext'
import { ClearHold } from './ClearHold'
import { coolingBlocker } from './cooling-blocker'
import { CoolerControls } from './CoolerControls'
import { MountControls } from './MountControls'

/**
 * The sections, in order, each present only when the rig has what it controls:
 * Mount, Cooler, Phone, Clear hold. A control that cannot run now stays visible and says why.
 */
export function RigControlsPanel({ rigId }: { rigId: string }) {
  const rig = useRigObservation()
  const capture = useCapture(rigId)
  const refreshRig = rig?.refresh
  const view = rig?.view
  const stale = !!rig?.interrupted
  const base = `/rigs/${encodeURIComponent(rigId)}`
  const mount = view?.devices.find(device => device.kind === 'telescope')
  const held = view?.devices.filter(device => device.observation?.hold) ?? []
  const cooler = !!capture.view?.cooling || !!capture.coolingError
  const phone = !!capture.view?.active

  // Polar alignment pauses the periodic read, so what the panel shows could be minutes old.
  useEffect(() => {
    void refreshRig?.()
  }, [refreshRig])

  const empty = !mount?.mountControl && !cooler && !phone && held.length === 0

  return (
    <div className="rig-controls__sections">
      {mount?.mountControl && refreshRig && (
        <section className="rig-controls__section" aria-label="Mount">
          <h3>Mount</h3>
          <MountControls
            rigId={rigId}
            device={mount}
            stale={stale || mount.observation?.state === 'interrupted'}
            refresh={() => refreshRig({ force: true })}
          />
        </section>
      )}
      {cooler && (
        <CoolerControls
          cooling={capture.view?.cooling ?? null}
          disabled={!capture.canCool}
          pending={capture.coolingPending}
          checking={capture.refreshing}
          error={capture.coolingError}
          unconfirmed={capture.coolingUnconfirmed}
          runActive={capture.view?.active}
          stale={capture.offline || capture.coolingUnconfirmed}
          blocker={coolingBlocker(capture.view?.cooling?.blockedBy, base)}
          onCooler={coolerOn => void capture.setCooler(coolerOn)}
          onSetpoint={setpointC => void capture.setCoolingTemperature(setpointC)}
          onCheck={() => void capture.refresh()}
        />
      )}
      {capture.view && phone && (
        <section className="rig-controls__section" aria-label="Phone">
          <h3>Phone</h3>
          <Checkbox
            label="Unattended (page my phone)"
            description={pagingLabel(capture.view.unattended)}
            checked={capture.view.unattended}
            disabled={!capture.canSetUnattended}
            onChange={event => void capture.setUnattended(event.target.checked)}
          />
          {capture.unattendedError && <p role="alert" className="rig-controls__error">{capture.unattendedError}</p>}
        </section>
      )}
      {held.length > 0 && refreshRig && (
        <section className="rig-controls__section" aria-label="Held devices">
          <h3>Clear hold</h3>
          {held.map(device => device.observation?.hold && (
            <div className="rig-controls__hold" role="group" aria-label={`${device.name} is held`} key={device.id}>
              <p>{device.name}: {device.observation.hold.reason}</p>
              <ClearHold
                rigId={rigId}
                deviceName={device.name}
                hold={device.observation.hold}
                refresh={() => refreshRig({ force: true })}
              />
            </div>
          ))}
        </section>
      )}
      {empty && (
        <p role="status" className="rig-controls__empty">
          {view || capture.view ? 'This rig has nothing to control right now.' : 'Checking what this rig offers…'}
        </p>
      )}
    </div>
  )
}
