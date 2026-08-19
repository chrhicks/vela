import type { CSSProperties, ReactNode } from 'react'
import { Badge, Button, Checkbox, IconButton, Input, Panel, Select, Tabs } from '@vela/ui'
import { themeStyle } from '@vela/ui/themes'
import type { ThemeMode, ThemeParameters, WorkingSession } from '@vela/ui/themes'

export interface CompositionDefinition {
  id: string
  name: string
  description: string
  context: WorkingSession['context']
  componentId: string
  specimenId: string
  render: () => ReactNode
}

const deviceOptions = [
  { value: 'main', label: 'ASI2600MC Pro' },
  { value: 'guide', label: 'ASI220MM Mini' },
]

function MoreIcon() {
  return <svg fill="currentColor" stroke="none" viewBox="0 0 20 20"><circle cx="4" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="16" cy="10" r="1.4" /></svg>
}

export const compositions: CompositionDefinition[] = [
  {
    id: 'composition-lineup',
    name: 'Isolated lineup',
    description: 'Core shapes, labels, and control heights without application context.',
    context: 'isolated',
    componentId: 'button',
    specimenId: 'button-primary',
    render: () => <div className="composition-lineup"><Button tone="accent">Start capture</Button><IconButton icon={<MoreIcon />} label="More actions" /><Input label="Target" placeholder="NGC 7000" /><Select defaultValue="main" label="Camera" options={deviceOptions} /><Checkbox defaultChecked label="Dither between frames" /><Badge marker={<i />} tone="positive">Ready</Badge></div>,
  },
  {
    id: 'composition-form',
    name: 'Form / settings',
    description: 'Field rhythm, explanation, validation, and action hierarchy.',
    context: 'form',
    componentId: 'select',
    specimenId: 'select-device',
    render: () => <Panel description="Configure how the next sequence should begin." footer={<><Button size="small" tone="quiet">Cancel</Button><Button size="small" tone="accent">Apply</Button></>} title="Sequence settings"><Input label="Target" placeholder="NGC 7000" /><Select defaultValue="main" label="Imaging camera" options={deviceOptions} /><Checkbox defaultChecked description="Returns the sensor to ambient temperature safely." label="Warm camera when complete" /></Panel>,
  },
  {
    id: 'composition-toolbar',
    name: 'Toolbar / action row',
    description: 'Dense status and action hierarchy under constrained width.',
    context: 'toolbar',
    componentId: 'icon-button',
    specimenId: 'icon-button-capture',
    render: () => <div className="composition-toolbar"><div><strong>Capture</strong><span>03:42 remaining</span></div><Badge marker={<i />} size="small" tone="positive">Guiding</Badge><Button size="small" tone="quiet">Pause</Button><IconButton icon={<MoreIcon />} label="More actions" size="small" /></div>,
  },
  {
    id: 'composition-card',
    name: 'Card / data list',
    description: 'A contained operational summary with navigation and status.',
    context: 'card',
    componentId: 'panel',
    specimenId: 'panel-device',
    render: () => <Panel action={<Badge marker={<i />} size="small" tone="positive">Connected</Badge>} description="ASI2600MC Pro · USB 3.0" elevation="raised" title="Main camera"><Tabs defaultValue="status" items={[{ id: 'status', label: 'Status', content: <div className="composition-data"><span>Sensor</span><strong>−5.0 °C</strong><span>Cooler</span><strong>42%</strong></div> }, { id: 'settings', label: 'Settings', content: <div className="composition-data"><span>Gain</span><strong>100</strong><span>Offset</span><strong>50</strong></div> }]} size="small" /></Panel>,
  },
]

export function CompositionPreview({ composition, mode, theme }: { composition: CompositionDefinition; mode: ThemeMode; theme: ThemeParameters }) {
  return <div className="vela-theme composition-preview" data-mode={mode} style={themeStyle(theme, mode) as CSSProperties}>{composition.render()}</div>
}
