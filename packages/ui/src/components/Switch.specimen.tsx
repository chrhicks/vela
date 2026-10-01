import type { ComponentSpecimen } from '../themes'
import { Switch } from './Switch'

export const specimen: ComponentSpecimen = {
  componentId: 'switch',
  componentName: 'Switch',
  id: 'observed-setting',
  name: 'Observed setting',
  description: 'A confirmed on/off setting with a 44px target and independent pending state.',
  controls: {
    checked: { type: 'boolean', label: 'On' },
    pending: { type: 'boolean', label: 'Pending' },
    disabled: { type: 'boolean', label: 'Unavailable' },
  },
  defaultProps: { checked: true, pending: false, disabled: false },
  render: (props, onPropsChange) => (
    <Switch
      label="Cooler on"
      checked={Boolean(props.checked)}
      pending={Boolean(props.pending)}
      disabled={Boolean(props.disabled)}
      onChange={checked => onPropsChange?.({ checked })}
    />
  ),
}
