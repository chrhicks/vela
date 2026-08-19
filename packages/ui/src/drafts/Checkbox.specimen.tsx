import type { ComponentSpecimen } from '../themes'
import { Checkbox } from './Checkbox'

export const specimen: ComponentSpecimen = {
  componentId: 'checkbox',
  componentName: 'Checkbox',
  id: 'checkbox-option',
  name: 'Sequence option',
  description: 'A native binary choice with a useful explanatory label.',
  controls: {
    label: { type: 'text', label: 'Label' },
    checked: { type: 'boolean', label: 'Checked' },
    disabled: { type: 'boolean', label: 'Disabled' },
    description: { type: 'boolean', label: 'Description' },
  },
  defaultProps: { label: 'Warm camera when complete', checked: true, disabled: false, description: true },
  render: (props) => (
    <Checkbox
      checked={Boolean(props.checked)}
      description={Boolean(props.description) ? 'Returns the sensor to ambient temperature safely.' : undefined}
      disabled={Boolean(props.disabled)}
      label={String(props.label)}
      onChange={() => undefined}
    />
  ),
}
