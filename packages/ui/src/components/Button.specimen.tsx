import { z } from 'zod'
import type { ComponentSpecimen } from '../themes'
import { Button } from './Button'

export const specimen: ComponentSpecimen = {
  componentId: 'button',
  componentName: 'Button',
  id: 'button-primary',
  name: 'Primary action',
  description: 'A semantic action with tone, pending, and unavailable states.',
  controls: {
    label: { type: 'text', label: 'Label' },
    tone: { type: 'select', label: 'Tone', options: ['neutral', 'accent', 'quiet'] },
    pending: { type: 'boolean', label: 'Pending' },
    disabled: { type: 'boolean', label: 'Disabled' },
  },
  defaultProps: {
    label: 'Start capture',
    tone: 'accent',
    disabled: false,
    pending: false,
  },
  render: props => (
    <Button
      disabled={Boolean(props.disabled)}
      pending={Boolean(props.pending)}
      tone={z.enum(['neutral', 'accent', 'quiet']).parse(props.tone)}
    >
      {props.pending ? 'Starting…' : String(props.label)}
    </Button>
  ),
}
