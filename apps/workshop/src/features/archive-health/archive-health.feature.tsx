import { defineDesign, defineFeature } from '../../feature-workspace/definitions'
import { ArchiveHealthPreview, type ArchiveHealthState } from './ArchiveHealthPreview'

const beside = defineDesign<ArchiveHealthState>({
  id: 'beside-capture',
  label: 'Preservation beside capture',
  intent: 'Say whether originals are safely preserved right under the capture they come from, with counts, causes and the next step one disclosure away. A returned preview is not proof of a verified archive.',
  component: ArchiveHealthPreview,
  defaultScenario: 'unavailable-while-capturing',
  scenarios: [
    {
      id: 'preserved',
      label: 'Preserved while capturing',
      description: 'Every original so far is verified in the Vela archive and confirmed by Cria. Figures are illustrative fixtures from the real projection contract.',
      tryThis: 'Open Archive details to see where originals stand, both disks and the measured estimate.',
      initialState: { scenario: 'preserved', capturing: true, afterCheck: 'preserved' },
    },
    {
      id: 'arriving',
      label: 'Original arriving',
      description: 'The newest original is being preserved by the capture itself; it is not counted as backlog.',
      tryThis: 'Open Archive details and find the arriving original.',
      initialState: { scenario: 'arriving', capturing: true, afterCheck: 'preserved' },
    },
    {
      id: 'acknowledgement-pending',
      label: 'Waiting for Cria to confirm',
      description: 'A receipt response was lost. The copy is verified; Vela resends the same receipt.',
      tryThis: 'Choose Check archive now to watch the simulated resend complete.',
      initialState: { scenario: 'acknowledgement', capturing: true, afterCheck: 'preserved' },
    },
    {
      id: 'unavailable-while-capturing',
      label: 'Archive unavailable while capturing',
      description: 'Intent is still recorded, so capture continues and pixels arrive, but originals cannot be written. Cria keeps them and refuses captures once its own capacity is full.',
      tryThis: 'Read the summary, then choose Check archive now after imagining the disk has been freed.',
      initialState: { scenario: 'unavailable', capturing: true, afterCheck: 'preserved' },
    },
    {
      id: 'capacity-full',
      label: 'Cria capacity full',
      description: 'The archive disk is unmounted and Cria has reached its configured capacity, so it refuses new captures. Free space is measured where the archive path now leads and labelled as an estimate.',
      tryThis: 'Open Archive details and compare the two disks.',
      initialState: { scenario: 'capacityFull', capturing: false, afterCheck: 'capacityFull' },
    },
    {
      id: 'intent-refused',
      label: 'Capture not started',
      description: 'The archive could not record what an exposure was for, so Vela refused the capture before sending any request.',
      tryThis: 'Compare this notice with the archive-unavailable scenario, where capture continued.',
      initialState: { scenario: 'intentRefused', capturing: false, afterCheck: 'intentRefused' },
    },
    {
      id: 'attention',
      label: 'Originals need attention',
      description: 'Cria quarantined an unverifiable file and one archived copy differs from its source. Nothing is replaced or cleared.',
      tryThis: 'Open Archive details and read each original and its next step.',
      initialState: { scenario: 'attention', capturing: false, afterCheck: 'attention' },
    },
    {
      id: 'cria-unreachable',
      label: 'Cria unreachable',
      description: 'Cria could not be read; last-known totals stay visible with their age and nothing claims preservation is current.',
      tryThis: 'Open Archive details and find when Cria was last read.',
      initialState: { scenario: 'stale', capturing: true, afterCheck: 'stale' },
    },
    {
      id: 'server-interrupted',
      label: 'Vela server interrupted',
      description: 'The browser lost contact with the Vela server; the last view stays visible and is marked with its age.',
      tryThis: 'Notice the interruption line under the summary.',
      initialState: { scenario: 'preserved', capturing: true, afterCheck: 'preserved', interrupted: true },
    },
  ],
})

export const feature = defineFeature({
  id: 'archive-health',
  label: 'Archive health',
  description: 'Know whether each original is preserved while the rig captures, and what to do when it is not.',
  collection: 'current',
  thumbnail: {
    src: new URL('./thumbnail.png', import.meta.url).href,
    alt: 'Preservation panel reporting an unavailable archive while capture continues',
  },
  defaultDesign: 'beside-capture',
  designs: [beside],
})
