import { z } from 'zod'
import type { ComponentSpecimen } from '../themes'
import { Badge } from './Badge'

export const specimen: ComponentSpecimen = {
  componentId: 'badge',
  componentName: 'Badge',
  id: 'badge-status',
  name: 'Operational status',
  description: 'A compact semantic label for state, category, or emphasis.',
  controls: {
    label: { type: 'text', label: 'Label' },
    tone: { type: 'select', label: 'Tone', options: ['neutral', 'accent', 'positive', 'warning', 'danger'] },
    size: { type: 'select', label: 'Size', options: ['small', 'medium'] },
    marker: { type: 'boolean', label: 'Marker' },
  },
  defaultProps: { label: 'Guiding', tone: 'positive', size: 'medium', marker: true },
  render: (props) => (
    <Badge marker={props.marker ? <i /> : undefined} size={z.enum(['small', 'medium']).parse(props.size)} tone={z.enum(['neutral', 'accent', 'positive', 'warning', 'danger']).parse(props.tone)}>
      {String(props.label)}
    </Badge>
  ),
}
