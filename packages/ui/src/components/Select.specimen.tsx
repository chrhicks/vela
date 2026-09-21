import type { ComponentSpecimen } from '../themes'
import { Select } from './Select'

const cameras = [
  { value: 'asi2600', label: 'ASI2600MC Pro · Main camera' },
  { value: 'asi220', label: 'ASI220MM Mini · Guide camera' },
  { value: 'simulator', label: 'Camera simulator' },
]

export const specimen: ComponentSpecimen = {
  componentId: 'select',
  componentName: 'Select',
  id: 'select-device',
  name: 'Device selection',
  description: 'A labeled native selection control with operational feedback.',
  controls: {
    label: { type: 'text', label: 'Label' },
    value: { type: 'select', label: 'Value', options: cameras.map((camera) => camera.value) },
    invalid: { type: 'boolean', label: 'Invalid' },
    disabled: { type: 'boolean', label: 'Disabled' },
  },
  defaultProps: {
    label: 'Imaging camera',
    value: 'asi2600',
    invalid: false,
    disabled: false
  },
  render: (props, onPropsChange) => (
    <div style={{ width: 'min(100%, 24rem)' }}>
      <Select
        disabled={Boolean(props.disabled)}
        invalid={Boolean(props.invalid)}
        label={String(props.label)}
        message={props.invalid ? 'Choose an available device.' : 'Used for the next capture sequence'}
        options={cameras}
        onChange={(event) => onPropsChange?.({ value: event.target.value })}
        value={String(props.value)}
      />
    </div>
  ),
}
