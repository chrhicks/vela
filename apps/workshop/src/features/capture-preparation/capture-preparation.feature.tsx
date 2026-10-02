import { defineDesign, defineFeature } from '../../feature-workspace/definitions'
import { CapturePreparation, type CapturePreparationState } from './CapturePreparation'

const preparation = defineDesign<CapturePreparationState>({
  id: 'tools-and-readiness',
  label: 'Preparation within reach',
  intent: 'Keep optional alignment and focus together beside the subject, and explain capture readiness at the Start capture action.',
  component: CapturePreparation,
  defaultScenario: 'ready',
  scenarios: [
    {
      id: 'ready',
      label: 'Ready to capture',
      description: 'A checked frame and connected rig, with optional preparation tools within reach. All readings and actions are illustrative.',
      tryThis: 'Find Polar alignment and Autofocus, change capture settings, and try Start capture. Reset restores all local choices.',
      initialState: { connection: 'ready', exposureSeconds: 180, repeat: true, saveFrames: true },
    },
    {
      id: 'devices-disconnected',
      label: 'Devices disconnected',
      description: 'The last test exposure stays visible while the rig devices are disconnected.',
      tryThis: 'Change exposure time, then Connect devices beside Start capture. The simulated connection keeps your settings and enables capture.',
      initialState: { connection: 'disconnected', exposureSeconds: 180, repeat: true, saveFrames: true },
    },
    {
      id: 'connection-unconfirmed',
      label: 'Connection unconfirmed',
      description: 'A connection command has an unknown outcome; another command must not be sent blindly.',
      tryThis: 'Choose Check state to inspect the simulated devices without replaying the connection request. Reset restores the uncertain outcome.',
      initialState: { connection: 'unconfirmed', exposureSeconds: 180, repeat: true, saveFrames: true },
    },
  ],
})

export const feature = defineFeature({
  id: 'capture-preparation',
  label: 'Capture preparation',
  description: 'Prepare the rig and understand what is needed to start capturing.',
  collection: 'current',
  thumbnail: {
    src: new URL('./thumbnail.png', import.meta.url).href,
    alt: 'Crescent Nebula capture preparation with alignment and autofocus beside the subject',
  },
  defaultDesign: 'tools-and-readiness',
  designs: [preparation],
})
