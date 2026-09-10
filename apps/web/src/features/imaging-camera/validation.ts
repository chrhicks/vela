import { z } from 'zod'
import type { ImagingCameraView } from '@vela/model/web'

const text = z.string().refine(value => value.trim().length > 0)

const imagingCamera = z.object({
  rigId: z.string(),
  editable: z.boolean(),
  state: z.enum(['unselected', 'ready', 'missing', 'changed', 'unavailable']),
  selected: z.object({ id: text, name: text }).nullable(),
  cameras: z.array(z.object({ id: text, configuredName: text, name: text.nullable() })),
}).refine(value => new Set(value.cameras.map(camera => camera.id)).size === value.cameras.length)

export function isImagingCameraView(value: unknown, rigId: string): value is ImagingCameraView {
  const result = imagingCamera.safeParse(value)

  return result.success && result.data.rigId === rigId
}
