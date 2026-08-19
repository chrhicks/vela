import { Button } from './Button'
import { Panel } from './Panel'
import type { ComponentSpecimen } from '../themes'

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-device',
  name: 'Device summary',
  description: 'A contained operational surface with hierarchy and actions.',
  controls: {
    title: { type: 'text', label: 'Title' },
    elevation: { type: 'select', label: 'Elevation', options: ['flat', 'raised'] },
    connected: { type: 'boolean', label: 'Connected' },
  },
  defaultProps: { title: 'Main camera', elevation: 'raised', connected: true },
  render: (props) => (
    <div style={{ width: 'min(100%, 30rem)' }}>
      <Panel
        action={<span style={{ color: Boolean(props.connected) ? 'var(--vela-positive)' : 'var(--vela-text-muted)', fontSize: '.78em', fontWeight: 700 }}>{Boolean(props.connected) ? 'CONNECTED' : 'OFFLINE'}</span>}
        description="ASI2600MC Pro · USB 3.0"
        elevation={String(props.elevation) as 'flat' | 'raised'}
        footer={<><Button size="small" tone="quiet">Details</Button><Button size="small" tone="accent">Cool camera</Button></>}
        title={String(props.title)}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'calc(var(--vela-space) * 2)' }}>
          {['Sensor −5.0 °C', 'Cooler 42%', 'Gain 100'].map((value) => <div key={value} style={{ color: 'var(--vela-text-muted)', fontSize: '.84em' }}>{value}</div>)}
        </div>
      </Panel>
    </div>
  ),
}
