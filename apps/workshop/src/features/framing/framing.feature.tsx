import {
  FrameContextPreview,
  type FrameContextInitialState,
} from '../../../../../packages/ui/src/drafts/Panel.frame-context.specimen'
import { defineDesign, defineFeature } from '../../feature-workspace/definitions'

const skyContext = defineDesign<FrameContextInitialState>({
  id: 'sky-context',
  label: 'Sky beside the heading',
  intent: 'Keep night context easy to reach while composing a frame, with framing details beside the result and optics inside composition controls.',
  component: FrameContextPreview,
  defaultScenario: 'frame-checked',
  scenarios: [
    {
      id: 'ready',
      label: 'Ready to frame',
      description: 'A desired composition before its first simulated framing check.',
      tryThis: 'Move the camera frame, then choose Slew & check to see the simulated result.',
      initialState: { state: 'Ready' },
    },
    {
      id: 'frame-checked',
      label: 'Frame checked',
      description: 'A simulated solve places the frame 1.2′ from the desired center.',
      tryThis: 'Inspect framing details, then adjust the composition and check the frame again.',
      initialState: { state: 'Checked' },
    },
    {
      id: 'through-the-night',
      label: 'Through the night',
      description: 'The checked frame with its sky-path dialog open.',
      tryThis: 'Explore the target and Moon positions over the night, then close the dialog to return to framing.',
      initialState: { state: 'Checked', skyOpen: true },
    },
  ],
})

export const feature = defineFeature({
  id: 'framing',
  label: 'Framing',
  description: 'Compose a frame, check its result, and keep the night in view.',
  collection: 'current',
  thumbnail: {
    src: new URL('./thumbnail.png', import.meta.url).href,
    alt: 'Framing preview with the North America Nebula composition and simulated checked result',
  },
  defaultDesign: 'sky-context',
  designs: [skyContext],
})
