import type { Reading } from '../../components/Readings.tsx'

interface RigReady {
  readonly at: string
  readonly summary: ReadonlyArray<Reading>
}

export const rigReady: RigReady = {
  at: '18:42',
  summary: [
    { label: 'Checklist', value: '8 OF 8' },
    { label: 'Devices', value: '6 OF 6' },
    { label: 'Align', value: '0.8′' },
    { label: 'Filter', value: 'IN' },
    { label: 'Focus', value: '2.8 px' },
  ],
}
