import type { RigEvent } from '@vela/rig-events'
import type { Site } from '@vela/rig-sky'

export type Input = { readonly event: RigEvent; readonly site: Site }
