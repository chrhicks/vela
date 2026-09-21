import { useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { SkyPath } from './SkyPath'
import { getDemoHorizon, getSkySamples, getMoonSamples } from './sky-path/fixtures'
import './SkyPath.specimen.css'

type Props = Record<string, string | number | boolean>

function SkyPathPreview({ props, onPropsChange }: { props: Props, onPropsChange?: (patch: Props) => void }) {
  function targetLabel() {
    switch (targetId) {
      case 'low-target':
        return 'Low target'
      case 'andromeda':
        return 'Andromeda'
      case 'm13':
        return 'Hercules Cluster'
      default:
        return 'Crescent Nebula'
    }
  }

  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const update = (patch: Props) => onPropsChange ? onPropsChange(patch) : setLocal(current => ({ ...current, ...patch }))
  const horizon = getDemoHorizon(String(values.horizon))
  const moonSamples = getMoonSamples(String(values.moon ?? 'gibbous'))
  const targetId = String(values.target)
  const targetName = targetLabel()

  return (
    <div className="vela-sky-path-specimen">
      <p className="vela-sky-path-specimen__caption">Sample night · imaginary observing site</p>
      <SkyPath
        samples={values.empty ? [] : getSkySamples(targetId)}
        targetName={targetName}
        {...(moonSamples ? { moonSamples } : {})}
        selectedIndex={Number(values.selectedIndex)}
        onSelectedIndexChange={selectedIndex => update({ selectedIndex })}
        nowIndex={18}
        {...(horizon ? { horizon } : {})}
        marginDegrees={Number(values.marginDegrees)}
        onMarginDegreesChange={marginDegrees => update({ marginDegrees })}
        compact={Boolean(values.compact)}
      />
    </div>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'sky-path',
  componentName: 'Sky path',
  id: 'sky-path-primitive',
  name: 'Primitive anatomy',
  description: 'Overhead target path, linked time selection and an optional horizon. Generated sample geometry contains no private observing-site data.',
  controls: {
    target: { type: 'select', label: 'Target', options: ['andromeda', 'm13', 'crescent', 'low-target'] },
    moon: {
      type: 'select',
      label: 'Sample Moon',
      options: ['gibbous', 'crescent', 'waning', 'full', 'new', 'unavailable', 'none']
    },
    horizon: { type: 'select', label: 'Horizon profile', options: ['none', 'local', 'incomplete', 'uncalibrated'] },
    selectedIndex: { type: 'text', label: 'Time sample (0–48)' },
    marginDegrees: { type: 'text', label: 'Silhouette margin (degrees)' },
    compact: { type: 'boolean', label: 'Compact presentation' },
    empty: { type: 'boolean', label: 'Path unavailable' },
  },
  defaultProps: {
    target: 'andromeda',
    moon: 'gibbous',
    horizon: 'none',
    selectedIndex: 18,
    marginDegrees: 3,
    compact: false,
    empty: false
  },
  render: (props, onPropsChange) => <SkyPathPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
