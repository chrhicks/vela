// Source identities only: private image bytes and generated derivatives stay ignored.
export const corpus = [
  {
    key: 'starfield',
    id: 'production-wide-position-1',
    label: 'Ordinary starfield · 2 s',
    source: 'alignment-diagnostics/production-wide-2026-09-10T02-30-42.975Z/position-1.fits',
    note: 'Real polar-region field, September 10. Filter identity not recorded; not a broadband color reference.',
  },
  {
    key: 'prefocus',
    id: '7e323d80-4151-48d8-b12c-21502f4f23fb',
    label: 'Veil · before filter focus · 180 s',
    note: 'September 15, 03:00 UTC. Before the recorded L-Ultimate autofocus; compare stellar discs at native scale.',
  },
  {
    key: 'warm',
    id: 'd4442483-0b69-40c0-a14b-948251fadc37',
    label: 'Veil · after focus, warm · 180 s',
    note: '03:13 UTC: first eligible focused frame. Cooler was subsequently discovered off; no temperature embedded in FITS.',
  },
  {
    key: 'cooled',
    id: '47d1a817-c7a6-4498-b064-ab29fb80e5ec',
    label: 'Veil · L-Ultimate, cooled · 180 s',
    note: '03:32 UTC. Observing log reports 5.0–5.1°C. Ha/OIII emission must retain relative source color; no gray-world gains.',
  },
  {
    key: 'dark',
    id: '37afe1c9-db83-49ad-b26a-1d33d7b47f39',
    label: 'Dark · 180 s',
    note: 'September 15 dark acquisition, 15:07 UTC. The display stretches noise; a neutral background is not additional sky signal.',
  },
  {
    key: 'trails',
    id: '684efeca-fe53-47ac-a352-d9c59afb3567',
    label: 'Veil · long trails · 180 s',
    note: '06:09 UTC. Excluded from published stacks in the observing audit. Retained original remains useful for judging visible defects.',
  },
]
