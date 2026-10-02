import { defineDesign, type WorkshopDesign } from './definitions'

function FramingPreview({ initialState }: { initialState: { offset: number } }) {
  return <span>{initialState.offset}</span>
}

// Included by the workshop tsconfig; this file is never imported by the app.
export const typedDesign: WorkshopDesign = defineDesign({
  id: 'framing',
  label: 'Framing',
  intent: 'Inspect the offset',
  component: FramingPreview,
  defaultScenario: 'solved',
  scenarios: [
    { id: 'solved', label: 'Solved', initialState: { offset: 2.4 } },
    {
      id: 'invalid',
      label: 'Invalid fixture',
      // @ts-expect-error The component requires a numeric offset.
      initialState: { offset: '2.4' },
    },
    {
      id: 'missing',
      label: 'Missing field',
      // @ts-expect-error The fixture must supply the component's initial state.
      initialState: {},
    },
  ],
})
