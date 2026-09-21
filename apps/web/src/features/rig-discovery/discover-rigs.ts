import { z } from 'zod'
import type { DiscoveryResultView } from '@vela/model/rig'
import { api, ApiError } from '../../lib/api'

export type DiscoverRigsRequest =
  | { mode: 'scan' }
  | { mode: 'manual'; host: string; port: number }

export class DiscoverRigsError extends Error {
  constructor(readonly reason: 'invalid-request') {
    super('The discovery request is invalid')
    this.name = 'DiscoverRigsError'
  }
}

export async function discoverRigs(
  request: DiscoverRigsRequest,
  signal: AbortSignal,
): Promise<DiscoveryResultView> {
  try {
    const response = await api('rigs/discovery', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal,
    })

    if (!isDiscoveryResult(response)) throw new Error('Invalid discovery response')

    return response
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      throw new DiscoverRigsError('invalid-request')
    }

    throw error
  }
}

const endpoint = z.object({
  host: z.string().refine(value => value.trim().length > 0 && value === value.trim()),
  port: z.number().refine(Number.isInteger).min(1).max(65535),
})

const isoDate = z.string().refine(value => {
  const date = new Date(value)

  return !Number.isNaN(date.getTime()) && date.toISOString() === value
})

const discoveryResult = z.object({
  candidates: z.array(z.object({
    endpoint,
    server: z.object({
      name: z.string().optional(),
      manufacturer: z.string().optional(),
      manufacturerVersion: z.string().optional(),
      location: z.string().optional(),
    }).optional(),
    inspectedAt: isoDate,
    devices: z.array(z.object({
      kind: z.enum([
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
      ]),
      name: z.string(),
    })),
    disposition: z.discriminatedUnion('state', [
      z.object({ state: z.literal('new') }),
      z.object({ state: z.literal('conflict') }),
      z.object({ state: z.literal('ineligible'), reason: z.literal('no-stable-device-id') }),
      z.object({
        state: z.literal('already-added'),
        rigId: z.string().refine(value => value.trim().length > 0),
      }),
    ]),
  })),
  failures: z.array(z.object({
    endpoint: endpoint.optional(),
    reason: z.enum(['scan-failed', 'unreachable', 'invalid-response', 'protocol-error']),
  })),
})

function isDiscoveryResult(value: unknown): value is DiscoveryResultView {
  return discoveryResult.safeParse(value).success
}
