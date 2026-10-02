import { useState } from 'react'
import { Button } from '@vela/ui'
import { defineDesign, defineFeature } from '../feature-workspace/definitions'

interface InitialState {
  offsetArcmin: number
}

function FeaturePreview({ initialState }: { initialState: InitialState }) {
  const [offsetArcmin, setOffsetArcmin] = useState(initialState.offsetArcmin)

  return (
    <section aria-label="Illustrative framing preview">
      <h1>Framing</h1>
      <p aria-live="polite">Simulated offset: {offsetArcmin.toFixed(1)}′</p>
      <Button onClick={() => setOffsetArcmin(offset => Math.max(0, offset - 0.5))}>
        Adjust frame
      </Button>
    </section>
  )
}

const design = defineDesign<InitialState>({
  id: 'offset-beside-frame',
  label: 'Offset beside the frame',
  intent: 'Keep the remaining offset visible while adjusting the frame.',
  component: FeaturePreview,
  defaultScenario: 'off-center',
  scenarios: [
    {
      id: 'off-center',
      label: 'Off center',
      description: 'An illustrative frame that needs adjustment.',
      tryThis: 'Choose Adjust frame, then Reset in the workshop toolbar to restore the starting offset.',
      initialState: { offsetArcmin: 2.5 },
    },
    {
      id: 'centered',
      label: 'Centered',
      tryThis: 'Check the settled state, then return to Off center to try the interaction.',
      initialState: { offsetArcmin: 0 },
    },
  ],
})

// Copy to src/features/<feature-id>.feature.tsx and replace this example's identity and content.
export const feature = defineFeature({
  id: 'replace-with-feature-id',
  label: 'Replace with feature name',
  description: 'Replace with the capability or change being explored.',
  collection: 'current',
  thumbnail: {
    // Replace with a captured preview under public/ or an imported local image.
    src: '/replace-with-captured-preview.webp',
    alt: 'Replace with a description of the captured preview',
  },
  defaultDesign: 'offset-beside-frame',
  designs: [design],
})
