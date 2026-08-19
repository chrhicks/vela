import { Button } from './Button'
import type { ComponentSpecimen } from '../themes'

export const specimen: ComponentSpecimen = {
  componentId: 'button',
  componentName: 'Button',
  id: 'button-primary',
  name: 'Primary action',
  description: 'A semantic action with tone, size, and disabled states.',
  controls: {
    label: { type: 'text', label: 'Label' },
    tone: { type: 'select', label: 'Tone', options: ['neutral', 'accent', 'quiet'] },
    size: { type: 'select', label: 'Size', options: ['small', 'medium', 'large'] },
    disabled: { type: 'boolean', label: 'Disabled' },
  },
  defaultProps: { label: 'Start capture', tone: 'accent', size: 'medium', disabled: false },
  render: (props) => (
    <Button disabled={Boolean(props.disabled)} size={String(props.size) as 'small' | 'medium' | 'large'} tone={String(props.tone) as 'neutral' | 'accent' | 'quiet'}>
      {String(props.label)}
    </Button>
  ),
}
