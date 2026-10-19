import { z } from 'zod'

/** The parts of Vela's HTTP views that replay and scenarios read. */

const statistics = z.object({ detectedStars: z.number(), medianHfrPixels: z.number().nullable() }).nullable()

export const captureView = z.object({
  phase: z.string(),
  active: z.boolean(),
  completedCount: z.number(),
  error: z.string().nullable(),
})

export type CaptureView = z.infer<typeof captureView>

export const alertsView = z.object({
  watching: z.boolean(),
  alerts: z.array(z.object({ id: z.string(), level: z.enum(['warn', 'critical']), message: z.string() })),
})

export type AlertsView = z.infer<typeof alertsView>

export const savedFrame = z.object({
  id: z.string(),
  capturedAt: z.string(),
  width: z.number(),
  height: z.number(),
  exposureSeconds: z.number(),
  statistics,
  fitsUrl: z.string(),
})

export type SavedFrame = z.infer<typeof savedFrame>

export const savedImagesView = z.object({ images: z.array(savedFrame) })

/** A line of Vela's frame record file (`apps/server/src/capture/frame-records.ts`). */
export const attempt = z.object({
  attempt: z.number(),
  outcome: z.string(),
  message: z.string().nullable(),
  statistics,
})

export type Attempt = z.infer<typeof attempt>

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
