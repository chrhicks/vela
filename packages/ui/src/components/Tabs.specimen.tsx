import { z } from 'zod'
import type { ComponentSpecimen } from '../themes'
import { Badge } from './Badge'
import { Tabs } from './Tabs'

export const specimen: ComponentSpecimen = {
  componentId: 'tabs',
  componentName: 'Tabs',
  id: 'tabs-device',
  name: 'Device sections',
  description: 'A compact in-house switcher with controlled or internal selection.',
  controls: {
    selected: { type: 'select', label: 'Selected', options: ['status', 'settings', 'history'] },
    size: { type: 'select', label: 'Size', options: ['small', 'medium'] },
  },
  defaultProps: { selected: 'status', size: 'medium' },
  render: (props, onPropsChange) => (
    <div style={{ width: 'min(100%, 34rem)' }}>
      <Tabs
        items={[
          { id: 'status', label: 'Status', content: <div className="vela-specimen-copy"><Badge marker={<i />} tone="positive">Connected</Badge><p>Camera temperature is stable at −5.0 °C.</p></div> },
          { id: 'settings', label: 'Settings', content: <div className="vela-specimen-copy"><strong>Gain 100 · Offset 50</strong><p>Applied to the next exposure.</p></div> },
          { id: 'history', label: 'History', content: <div className="vela-specimen-copy"><strong>42 completed exposures</strong><p>Last frame completed 18 seconds ago.</p></div> },
        ]}
        size={z.enum(['small', 'medium']).parse(props.size)}
        onValueChange={(selected) => onPropsChange?.({ selected })}
        value={String(props.selected)}
      />
    </div>
  ),
}
