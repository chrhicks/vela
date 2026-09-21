import { z } from 'zod'
import type { RigDeviceConnectionSummary } from '@vela/model/rig'
import type { HomeView, RigDetailView } from '@vela/model/web'

const text = z.string().refine(value => value.trim().length > 0)

const canonicalText = text.refine(value => value === value.trim())

const isoDate = z.string().refine(value => {
  const date = new Date(value)

  return !Number.isNaN(date.getTime()) && date.toISOString() === value
})

export const deviceKindSchema = z.enum([
  'camera',
  'cover-calibrator',
  'dome',
  'filter-wheel',
  'focuser',
  'observing-conditions',
  'rotator',
  'safety-monitor',
  'switch',
  'telescope',
  'unknown',
])

const capabilities = z.array(z.literal('forget'))

const count = z.number().refine(Number.isInteger).nonnegative()

const connections = z
  .object({
    total: count,
    connected: count,
    disconnected: count,
    unavailable: count,
  })
  .refine(value => value.total === value.connected + value.disconnected + value.unavailable)

const endpoint = z.object({
  host: canonicalText,
  port: z.number().refine(Number.isInteger).min(1).max(65535),
})

const availability = z.enum(['complete', 'partial'])

const percentage = z.number().min(0).max(100)

const cameraStatus = z.object({
  availability,
  activity: z.enum(['idle', 'waiting', 'exposing', 'reading', 'downloading', 'error', 'unknown']),
  sensorTemperatureC: z.number().optional(),
  cooling: z
    .object({ state: z.enum(['on', 'off']), powerPercent: percentage.optional() })
    .optional(),
})

const telescopeStatus = z.object({
  availability,
  activity: z.enum(['idle', 'tracking', 'slewing', 'parked', 'unknown']),
  tracking: z.enum(['on', 'off', 'unknown']),
  parking: z.enum(['parked', 'unparked', 'unknown']),
  home: z.enum(['at-home', 'away', 'unknown']),
})

const focuserStatus = z.object({
  availability,
  activity: z.enum(['idle', 'moving', 'unknown']),
  position: count.optional(),
  temperatureC: z.number().optional(),
})

const filterWheelStatus = z.object({
  availability,
  activity: z.enum(['idle', 'moving', 'unknown']),
  position: z.number().refine(Number.isInteger).min(-1).optional(),
  filterName: text.optional(),
})

const conditionsStatus = z.object({
  availability,
  activity: z.enum(['reporting', 'unknown']),
  temperatureC: z.number().optional(),
  humidityPercent: percentage.optional(),
  dewPointC: z.number().optional(),
})

const switchStatus = z.object({
  availability,
  activity: z.enum(['reporting', 'unknown']),
  channels: z
    .array(
      z.object({
        id: count,
        name: text,
        on: z.boolean().optional(),
        value: z.number().optional(),
      }),
    )
    .refine(channels => new Set(channels.map(channel => channel.id)).size === channels.length)
    .optional(),
})

const identity = z.object({ id: canonicalText, name: text, configuredName: text })

const connected = identity.extend({ connection: z.literal('connected'), observedAt: isoDate })

const unavailableStatus = z.object({ availability: z.literal('unavailable') })

const device = z.union([
  identity.extend({
    kind: deviceKindSchema,
    connection: z.literal('disconnected'),
    observedAt: isoDate,
    status: unavailableStatus,
  }),
  identity.extend({
    kind: deviceKindSchema,
    connection: z.literal('unavailable'),
    observedAt: isoDate.optional(),
    status: unavailableStatus,
  }),
  connected.extend({
    kind: deviceKindSchema,
    status: z.object({ availability: z.literal('unsupported') }),
  }),
  connected.extend({ kind: z.literal('camera'), status: cameraStatus }),
  connected.extend({ kind: z.literal('telescope'), status: telescopeStatus }),
  connected.extend({ kind: z.literal('focuser'), status: focuserStatus }),
  connected.extend({ kind: z.literal('filter-wheel'), status: filterWheelStatus }),
  connected.extend({ kind: z.literal('observing-conditions'), status: conditionsStatus }),
  connected.extend({ kind: z.literal('switch'), status: switchStatus }),
])

function allConnectionsUnavailable(summary: RigDeviceConnectionSummary): boolean {
  return (
    summary.connected === 0 && summary.disconnected === 0 && summary.unavailable === summary.total
  )
}

export const rigDetailSchema = z
  .object({
    id: canonicalText,
    name: text,
    state: z.enum(['reachable', 'offline', 'needs-attention']),
    endpoint,
    addedAt: isoDate,
    lastInventoryAt: isoDate,
    refreshedAt: isoDate,
    connections,
    devices: z.array(device),
    capabilities,
  })
  .refine(value => {
    const summary = value.connections

    return (
      new Set(value.devices.map(item => item.id)).size === value.devices.length &&
      summary.total === value.devices.length &&
      summary.connected === value.devices.filter(item => item.connection === 'connected').length &&
      summary.disconnected ===
        value.devices.filter(item => item.connection === 'disconnected').length &&
      summary.unavailable ===
        value.devices.filter(item => item.connection === 'unavailable').length &&
      (value.state !== 'offline' || allConnectionsUnavailable(summary))
    )
  })

const rig = z
  .object({
    id: canonicalText,
    name: text,
    reachability: z.enum(['reachable', 'unreachable', 'unknown']),
    lastSeenAt: isoDate.optional(),
    connections,
    capabilities,
  })
  .refine(
    value => value.reachability === 'reachable' || allConnectionsUnavailable(value.connections),
  )

const home = z
  .object({ rigs: z.array(rig), refreshedAt: isoDate })
  .refine(value => new Set(value.rigs.map(item => item.id)).size === value.rigs.length)

export function isHomeView(value: unknown): value is HomeView {
  return home.safeParse(value).success
}

export function isRigDetailView(value: unknown): value is RigDetailView {
  return rigDetailSchema.safeParse(value).success
}
