import { useId, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { HomeSurface } from './fieldroom-equipment/HomeSurface'
import { RigOnboarding, type RigWorkshopProps } from './fieldroom-equipment/RigOnboarding'

export function RigHomePreview({ props, onPropsChange }: {
  props: RigWorkshopProps
  onPropsChange?: (patch: RigWorkshopProps) => void
}) {
  const [local, setLocal] = useState<RigWorkshopProps>({ ...props, stage: 'closed' })

  const values = onPropsChange ? props : local

  const update = (patch: RigWorkshopProps) => onPropsChange
    ? onPropsChange(patch)
    : setLocal(current => ({ ...current, ...patch }))

  const openerId = useId()
  const [notice, setNotice] = useState('')

  return (
    <div className="vela-rig-onboarding-canvas">
      <div className="vela-rig-onboarding-host" data-open={values.stage !== 'closed'}>
        <HomeSurface
          populated={values.catalog === 'populated'}
          addId={openerId}
          onAdd={() => update({ stage: 'start' })}
          onOpen={() => setNotice('Workshop example: open this rig’s Equipment page.')}
          onExplore={() => setNotice('Workshop example: Explore the sky remains available before adding a rig.')}
        />
        {notice && <p className="vela-rig-onboarding__notice" role="status">{notice}</p>}
        <RigOnboarding values={values} update={update} openerId={openerId} onComplete={setNotice} />
      </div>
    </div>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'dialog', componentName: 'Dialog', id: 'fieldroom-rig-onboarding',
  name: 'Rig onboarding · Fieldroom product example',
  description: 'Source 03.12 review, 03.15 compact address validation and 03.13 recovery/Forget. Existing Dialog focus behavior; sample fixtures only, no network or configuration writes.',
  controls: {
    stage: { type: 'select', label: 'Discovery state', options: ['closed', 'start', 'address', 'address-invalid', 'address-port-invalid', 'address-unreachable', 'review', 'review-unconfirmed', 'empty', 'forget'] },
    catalog: { type: 'select', label: 'Home state', options: ['first-night', 'populated'] },
    host: { type: 'text', label: 'Host or IP address' },
    port: { type: 'text', label: 'Port' },
    rigName: { type: 'text', label: 'Rig name' },
  },
  defaultProps: { stage: 'closed', catalog: 'first-night', host: '192.168.4.104', port: '11111', rigName: 'Askar FRA 400' },
  render: (props, onPropsChange) => <RigHomePreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
