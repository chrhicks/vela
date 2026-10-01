import type { ComponentSpecimen } from '../themes'
import { RigHomePreview } from './Dialog.rig-onboarding.specimen'

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'fieldroom-home',
  name: 'Home · Fieldroom product example',
  description: 'Source 03.8 first night and a compact saved-rig catalog using the same Fieldroom surfaces. Add is explicit and opens the existing Dialog. Sample rigs only; no hardware.',
  controls: {
    catalog: { type: 'select', label: 'Home state', options: ['first-night', 'populated'] },
    stage: { type: 'select', label: 'Discovery state', options: ['closed', 'start', 'address', 'address-invalid', 'address-port-invalid', 'address-unreachable', 'review', 'review-unconfirmed', 'empty', 'forget'] },
    host: { type: 'text', label: 'Host or IP address' },
    port: { type: 'text', label: 'Port' },
    rigName: { type: 'text', label: 'Rig name' },
  },
  defaultProps: { catalog: 'first-night', stage: 'closed', host: '192.168.4.104', port: '11111', rigName: 'Askar FRA 400' },
  render: (props, onPropsChange) => <RigHomePreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
