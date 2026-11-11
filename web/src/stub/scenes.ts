export interface Scene {
  readonly label: string
  readonly to: string
  readonly phoneOnly?: boolean
}

interface Section {
  readonly root: string
  readonly scenes: ReadonlyArray<Scene>
}

export const sections: ReadonlyArray<Section> = [
  {
    root: '/launch',
    scenes: [
      { label: 'Set up', to: '/launch/set-up' },
      { label: 'Bring-up', to: '/launch/bring-up' },
      { label: 'All set', to: '/launch/bring-up?scene=set' },
      { label: 'Align', to: '/launch/align' },
      { label: 'Moved', to: '/launch/align?scene=moved' },
      { label: 'Good', to: '/launch/align?scene=good' },
      { label: 'Filter', to: '/launch/filter' },
      { label: 'Focus', to: '/launch/focus' },
      { label: 'Ready', to: '/launch/ready' },
    ],
  },
  {
    root: '/controls',
    scenes: [
      { label: 'All', to: '/controls' },
      { label: 'Shut down?', to: '/controls?ask=shut-down' },
      { label: 'Mount', to: '/controls/mount', phoneOnly: true },
      { label: 'Guiding', to: '/controls/guiding', phoneOnly: true },
      { label: 'Focus', to: '/controls/focus', phoneOnly: true },
      { label: 'Camera', to: '/controls/camera', phoneOnly: true },
      { label: 'Dew heater', to: '/controls/dew', phoneOnly: true },
      { label: 'Calibration', to: '/controls/calibration', phoneOnly: true },
      { label: 'System', to: '/controls/system', phoneOnly: true },
    ],
  },
  {
    root: '/',
    scenes: [
      { label: 'No run', to: '/' },
      { label: 'Pick target', to: '/?scene=ready' },
      { label: 'First frames', to: '/?scene=starting' },
      { label: 'Capturing', to: '/?scene=capturing' },
      { label: 'Alert', to: '/?scene=alert' },
      { label: 'Night over', to: '/?scene=over' },
    ],
  },
]
