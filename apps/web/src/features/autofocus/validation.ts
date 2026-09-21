import { z } from 'zod'
import type { AutofocusView } from '@vela/model/web'

const text = z.string().refine(value => value.trim().length > 0)

const sample = z
  .object({
    position: z.number().int(),
    detectedStars: z.number().int().nonnegative(),
    hfrPixels: z.number().positive().nullable(),
    capturedAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
  })
  .refine(value =>
    value.detectedStars === 0 ? value.hfrPixels === null : value.hfrPixels !== null,
  )

const fit = z.object({
  position: z.number().int(),
  p: z.number(),
  a: z.number().positive(),
  b: z.number().positive(),
  rSquared: z.number(),
  minSamplePosition: z.number().int(),
})

const autofocus = z.object({
  rigId: z.string(),
  rigName: text,
  enabled: z.boolean(),
  unavailableReason: text.nullable(),
  cameraName: text.nullable(),
  focuserName: text.nullable(),
  phase: z.enum(['setup', 'walking', 'fitting', 'confirming', 'complete', 'stopped', 'failed']),
  activity: z.enum(['idle', 'moving', 'exposing', 'measuring', 'fitting', 'restoring', 'stopping']),
  active: z.boolean(),
  captureReadState: z.enum(['current', 'retrying']),
  startPosition: z.number().int().nullable(),
  currentPosition: z.number().int().nullable(),
  maxStep: z.number().int().nullable(),
  stepSize: z.number().int().positive(),
  offsetSteps: z.number().int().positive(),
  exposureSeconds: z.number().min(0).max(30),
  elapsedSeconds: z.number().nonnegative(),
  exposureStartedAt: z
    .string()
    .refine(value => Number.isFinite(Date.parse(value)))
    .nullable(),
  samples: z.array(sample),
  fit: fit.nullable(),
  restoredStart: z.boolean(),
  error: text.nullable(),
})

export function isTravelLimitError(error: string | null) {
  return (
    !!error &&
    (error.includes('already at a mechanical limit') ||
      error.includes('would approach 0 or MaxStep'))
  )
}

export function isAutofocusView(value: unknown, rigId: string): value is AutofocusView {
  const result = autofocus.safeParse(value)

  if (!result.success) return false
  const view = result.data

  const running =
    view.phase === 'walking' || view.phase === 'fitting' || view.phase === 'confirming'

  return view.rigId === rigId && view.active === running
}
