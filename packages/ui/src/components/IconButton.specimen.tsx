import type { ReactNode } from 'react'
import type { ComponentSpecimen } from '../themes'
import { IconButton } from './IconButton'

function CaptureIcon(): ReactNode {
  return (
    <svg fill="none" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="3.25" />
      <path d="M3.5 7.25h2l1.15-2h6.7l1.15 2h2v8.25h-13z" />
    </svg>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'icon-button',
  componentName: 'IconButton',
  id: 'icon-button-capture',
  name: 'Capture action',
  description: 'A compact, named action using caller-provided icon content.',
  controls: {
    label: { type: 'text', label: 'Label' },
    tone: { type: 'select', label: 'Tone', options: ['neutral', 'accent', 'quiet'] },
    size: { type: 'select', label: 'Size', options: ['small', 'medium', 'large'] },
    disabled: { type: 'boolean', label: 'Disabled' },
  },
  defaultProps: { label: 'Start exposure', tone: 'neutral', size: 'medium', disabled: false },
  render: (props) => (
    <IconButton
      disabled={Boolean(props.disabled)}
      icon={<CaptureIcon />}
      label={String(props.label)}
      size={String(props.size) as 'small' | 'medium' | 'large'}
      tone={String(props.tone) as 'neutral' | 'accent' | 'quiet'}
    />
  ),
}
