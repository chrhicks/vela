import { Input } from './Input'
import type { ComponentSpecimen } from '../themes'

export const specimen: ComponentSpecimen = {
  componentId: 'input',
  componentName: 'Input',
  id: 'input-coordinate',
  name: 'Coordinate field',
  description: 'A labeled operational value with helper or validation feedback.',
  controls: {
    label: { type: 'text', label: 'Label' },
    placeholder: { type: 'text', label: 'Placeholder' },
    invalid: { type: 'boolean', label: 'Invalid' },
    disabled: { type: 'boolean', label: 'Disabled' },
  },
  defaultProps: { label: 'Right ascension', placeholder: '20h 58m 17s', invalid: false, disabled: false },
  render: (props) => (
    <div style={{ width: 'min(100%, 22rem)' }}>
      <Input
        disabled={Boolean(props.disabled)}
        invalid={Boolean(props.invalid)}
        label={String(props.label)}
        message={props.invalid ? 'Enter a valid coordinate.' : 'J2000 equatorial coordinate'}
        placeholder={String(props.placeholder)}
      />
    </div>
  ),
}
