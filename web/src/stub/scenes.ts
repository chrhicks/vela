export interface Scene {
  readonly label: string
  readonly to: string
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
    root: '/',
    scenes: [
      { label: 'No run', to: '/' },
      { label: 'First frames', to: '/?scene=starting' },
      { label: 'Capturing', to: '/?scene=capturing' },
      { label: 'Alert', to: '/?scene=alert' },
      { label: 'Night over', to: '/?scene=over' },
    ],
  },
]
