import { useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { SkyPath, type SkyLightPhase } from './SkyPath'
import { getSkySamples } from './sky-path/fixtures'
import './SkyPath.specimen.css'

type Props = Record<string, string | number | boolean>

// Invented phase windows, deliberately aligned with 15-minute samples.
// These demonstrate the visual treatment, not a site's solar calculation.
function phaseAt(index: number): SkyLightPhase {
  if (index < 24 || index >= 72) return 'daylight'

  if (index < 26 || index >= 70) return 'civil'

  if (index < 28 || index >= 68) return 'nautical'

  if (index < 30 || index >= 66) return 'astronomical'

  return 'night'
}

function LightPreview({ props, onPropsChange }: { props: Props; onPropsChange?: (patch: Props) => void }) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const update = (patch: Props) => onPropsChange ? onPropsChange(patch) : setLocal(current => ({ ...current, ...patch }))
  const target = String(values.target)
  const samples = getSkySamples(target, 12, 97, 15).map((sample, index) => ({ ...sample, light: phaseAt(index) }))

  return <div className="vela-sky-path-specimen">
    <p className="vela-sky-path-specimen__caption">Sample day and night · invented light windows</p>
    <SkyPath samples={samples} targetName={target === 'm13' ? 'Hercules Cluster' : 'Andromeda'} selectedIndex={Number(values.selectedIndex)} onSelectedIndexChange={selectedIndex => update({ selectedIndex })} nowIndex={0} compact={Boolean(values.compact)} />
  </div>
}

export const specimen: ComponentSpecimen = {
  componentId: 'sky-path', componentName: 'Sky path', id: 'sky-path-light-windows', name: 'Light windows',
  description: 'Colored target-path segments distinguish daylight, twilight stages and astronomical darkness. Invented 24-hour fixtures; no production solar data.',
  controls: {
    target: { type: 'select', label: 'Target', options: ['m13', 'andromeda'] },
    selectedIndex: { type: 'text', label: 'Time sample (0–96, noon to noon)' },
    compact: { type: 'boolean', label: 'Compact presentation' },
  },
  defaultProps: { target: 'm13', selectedIndex: 26, compact: false },
  render: (props, onPropsChange) => <LightPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
