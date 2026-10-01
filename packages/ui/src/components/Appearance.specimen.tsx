import { useState } from 'react'
import { Appearance } from './Appearance'
import type { AppearancePreference } from './Appearance'
import { Button } from './Button'
import type { ComponentSpecimen } from '../themes'
import './Appearance.specimen.css'

function AppearancePreview({ props, onPropsChange }: {
  props: Record<string, string | number | boolean>
  onPropsChange: ((patch: Record<string, string | number | boolean>) => void) | undefined
}) {
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryValue, setGalleryValue] = useState<AppearancePreference>('system')
  const [outsideCount, setOutsideCount] = useState(0)
  const preference = props.preference === 'light' || props.preference === 'dark' ? props.preference : 'system'

  return (
    <div className="vela-appearance-specimen">
      <header>
        <span>Appearance anatomy</span>
        <Appearance
          onOpenChange={open => onPropsChange ? onPropsChange({ open }) : setGalleryOpen(open)}
          onValueChange={value => onPropsChange ? onPropsChange({ preference: value }) : setGalleryValue(value)}
          open={onPropsChange ? Boolean(props.open) : galleryOpen}
          persistence={props.persistence === 'visit' ? 'visit' : 'saved'}
          systemMode={props.systemMode === 'dark' ? 'dark' : 'light'}
          value={onPropsChange ? preference : galleryValue}
        />
      </header>
      <div className="vela-appearance-specimen__background">
        <p>The surrounding view remains usable while Appearance is open.</p>
        <Button onClick={() => setOutsideCount(count => count + 1)}>Outside action</Button>
        <output>Outside actions: {outsideCount}</output>
      </div>
    </div>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'appearance',
  componentName: 'Appearance',
  id: 'appearance-primitive',
  name: 'Preference popover',
  description: 'Controlled, non-modal appearance selection. Browser persistence and palette resolution belong to the consuming app.',
  controls: {
    open: { type: 'boolean', label: 'Open' },
    preference: { type: 'select', label: 'Preference', options: ['system', 'light', 'dark'] },
    systemMode: { type: 'select', label: 'System resolves to', options: ['light', 'dark'] },
    persistence: { type: 'select', label: 'Preference storage', options: ['saved', 'visit'] },
  },
  defaultProps: { open: false, preference: 'system', systemMode: 'light', persistence: 'saved' },
  render: (props, onPropsChange) => <AppearancePreview props={props} onPropsChange={onPropsChange} />,
}
