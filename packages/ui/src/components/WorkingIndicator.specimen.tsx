import type { ComponentSpecimen } from '../themes'
import { WorkingIndicator } from './WorkingIndicator'

export const specimen: ComponentSpecimen = {
  componentId: 'working-indicator',
  componentName: 'Working indicator',
  id: 'working-indicator',
  name: 'Primitive anatomy',
  description:
    'Persistent activity feedback. Inactive reserves space; reduced motion keeps a static highlight.',
  controls: { active: { type: 'boolean', label: 'Working' } },
  defaultProps: { active: true },
  render: props => <WorkingIndicator active={props.active === true} />,
}
