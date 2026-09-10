import { z } from 'zod'
import type { NavigationView } from '@vela/model/web'

const text = z.string().refine(value => value.trim().length > 0)

const capture = z.object({
  rigId: text, rigName: text,
  phase: z.enum(['idle', 'exposing', 'reading', 'saving', 'stopping', 'complete', 'stopped', 'failed']),
  active: z.boolean(),
  completedCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  elapsedSeconds: z.number().nonnegative(),
  exposureSeconds: z.number().min(0).max(600),
  error: text.nullable(),
}).refine(value => value.active === ['exposing', 'reading', 'saving', 'stopping'].includes(value.phase)
  && (!value.active || value.exposureSeconds >= 0.1))

const navigation = z.object({ rigs: z.array(z.object({ id: text, name: text })), captures: z.array(capture) })
  .refine(value => new Set(value.rigs.map(rig => rig.id)).size === value.rigs.length
    && new Set(value.captures.map(item => item.rigId)).size === value.captures.length
    && value.captures.every(item => value.rigs.some(rig => rig.id === item.rigId && rig.name === item.rigName)))

export function isNavigationView(value: unknown): value is NavigationView {
  return navigation.safeParse(value).success
}
