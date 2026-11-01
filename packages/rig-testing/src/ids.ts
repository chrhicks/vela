import { imageId } from '@vela/rig-events'

export const imageIdOf = (index: number) => imageId(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
