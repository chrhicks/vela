import { z } from 'zod'
import type { ConnectRigDevicesResult, RigObservationView } from '@vela/model/web'
import { deviceKindSchema, rigDetailSchema } from '../../lib/view-validation'

const observation = z.object({
  rig: rigDetailSchema,
  connectionPreparation: z.discriminatedUnion('state', [
    z.object({ state: z.literal('available'), capabilities: z.tuple([z.literal('connect-devices')]) }),
    z.object({ state: z.enum(['complete', 'in-progress', 'unavailable']), capabilities: z.tuple([]) }),
  ]),
}).refine(value => value.rig.state !== 'offline' || !['available', 'complete'].includes(value.connectionPreparation.state))

export function isRigObservationView(value: unknown): value is RigObservationView {
  return observation.safeParse(value).success
}

const canonicalText = z.string().refine(value => value.trim().length > 0 && value === value.trim())

const device = z.object({ id: canonicalText, name: canonicalText, kind: deviceKindSchema })

const devices = z.array(device).refine(value => new Set(value.map(item => item.id)).size === value.length)

const failedDevice = device.extend({ reason: z.enum(['connection-check-failed', 'device-not-found', 'rejected', 'remained-disconnected']) })

const uncertainDevice = device.extend({ reason: z.enum(['cancelled', 'verification-timeout', 'verification-unavailable', 'write-outcome-unknown']) })

const resultSchema = z.union([
  z.object({ outcome: z.literal('unavailable'), reason: z.enum(['device-state-unavailable', 'identity-conflict', 'offline']), view: observation }),
  z.object({ outcome: z.literal('complete'), command: z.literal('not-needed'), confirmedConnected: devices.length(0), view: observation }),
  z.object({ outcome: z.literal('complete'), command: z.literal('completed'), confirmedConnected: devices.min(1), view: observation }),
  z.object({ outcome: z.literal('failed'), confirmedConnected: devices.length(0), notAttempted: devices, failed: failedDevice, uncertain: z.never().optional(), stoppedAfter: z.never().optional(), view: observation }),
  z.object({ outcome: z.literal('partial'), confirmedConnected: devices.min(1), notAttempted: devices, failed: failedDevice, uncertain: z.never().optional(), stoppedAfter: z.never().optional(), view: observation }),
  z.object({ outcome: z.literal('partial'), confirmedConnected: devices.min(1), notAttempted: devices.min(1), stoppedAfter: device, failed: z.never().optional(), uncertain: z.never().optional(), view: observation }),
  z.object({ outcome: z.literal('uncertain'), confirmedConnected: devices, notAttempted: devices, uncertain: uncertainDevice, failed: z.never().optional(), stoppedAfter: z.never().optional(), view: observation }),
]).refine(value => {
  if (value.outcome === 'complete' || value.outcome === 'unavailable') return true
  const confirmedIds = value.confirmedConnected.map(item => item.id)
  const remainingIds = value.notAttempted.map(item => item.id)

  if (remainingIds.some(id => confirmedIds.includes(id))) return false

  if (value.outcome === 'uncertain') return !('failed' in value) && !('stoppedAfter' in value) && ![...confirmedIds, ...remainingIds].includes(value.uncertain.id)

  if ('uncertain' in value) return false

  if (value.failed) return !('stoppedAfter' in value) && ![...confirmedIds, ...remainingIds].includes(value.failed.id)

  return !('failed' in value) && value.stoppedAfter !== undefined && confirmedIds.includes(value.stoppedAfter.id)
})

export function isConnectRigDevicesResult(value: unknown): value is ConnectRigDevicesResult {
  return resultSchema.safeParse(value).success
}
