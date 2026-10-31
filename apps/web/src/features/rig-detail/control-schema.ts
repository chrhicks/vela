import { z } from 'zod'

// What the server says about the mount and dew controls. Kept apart from the fetch client so the
// rig-detail validator, and the tests that import it in node, don't pull in `lib/api`.

const availability = z.object({ enabled: z.boolean(), reason: z.string().nullable() })

export const mountControlSchema = z.object({
  serverInstanceId: z.uuid(),
  unpark: availability,
  trackingOn: availability,
  trackingOff: availability,
  home: availability,
  stop: availability,
  canStop: z.boolean(),
  homeConfirmedAt: z.string().nullable(),
  command: z.object({
    requestId: z.uuid(),
    action: z.enum(['unpark', 'tracking-on', 'tracking-off', 'home']),
    state: z.enum(['pending', 'confirmed', 'failed', 'uncertain']),
    message: z.string().nullable(),
  }).nullable(),
})

export const dewControlSchema = z.object({
  serverInstanceId: z.uuid(),
  auto: z.object({ on: z.boolean().nullable(), set: availability }).nullable(),
  channels: z.array(z.object({
    id: z.int(),
    name: z.string(),
    minimum: z.number(),
    maximum: z.number(),
    step: z.number().positive(),
    dutyPercent: z.number().nullable(),
    set: availability,
  })),
  command: z.object({
    requestId: z.uuid(),
    action: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('auto'), on: z.boolean() }),
      z.object({ kind: z.literal('duty'), channelId: z.int(), percent: z.number() }),
    ]),
    state: z.enum(['pending', 'confirmed', 'failed', 'uncertain']),
    message: z.string().nullable(),
  }).nullable(),
})
