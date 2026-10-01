import { z } from 'zod'
import { equipmentRig } from './equipment'
import type { AlignmentView } from '@vela/model/web'
import { reviewTimezone, type ReviewResponse } from './tonight'

import { alignmentResource } from './resources'

export { alignmentResource } from './resources'

export const alignmentScenes = [
  'alignment-phone-adjusting',
  'alignment-phone-read-interrupted',
  'appearance-phone-light',
  'appearance-phone-dark',
  'alignment-setup',
  'alignment-unavailable',
  'alignment-loading',
  'alignment-baseline-homing',
  'alignment-baseline-moving',
  'alignment-baseline-exposing',
  'alignment-baseline-solving',
  'alignment-baseline-no-solution',
  'alignment-offline',
  'alignment-image-failed',
  'alignment-stop-pending',
  'alignment-stop-unconfirmed',
  'alignment-stopped',
  'alignment-finished',
  'alignment-enlarged-baseline',
] as const

export type AlignmentScene = (typeof alignmentScenes)[number]

type ReviewPayload = ReviewResponse['json']

interface ReviewCommand {
  stepSize?: number
  offsetSteps?: number
  exposureSeconds?: number
}

type Command = 'start' | 'stop' | 'finish'

const imageUrl = '/api/rigs/fra400/alignment/images/review-solve-1'

export const alignmentMeasuredAt = '2026-10-01T01:02:14.000Z'

export const alignmentMeasurement: NonNullable<AlignmentView['measurement']> = {
  capturedAtSource: 'server-estimate',
  altitudeArcsec: -30,
  azimuthArcsec: -23,
  totalArcsec: Math.hypot(30, 23),
  imageUrl,
  imageWidth: 1600,
  imageHeight: 1200,
  // Illustrative projected coordinates in a north-up 1-degree-high field.
  // Preserve the real viewport math; never copy Paper's decorative reticle positions.
  targetX: 799.5 + 23 / 3,
  targetY: 599.5 - 30 / 3,
  fieldHeightDegrees: 1,
}

export const alignmentAdjusting: AlignmentView = {
  mode: 'physical',
  cameraName: 'Review simulator image · not a physical exposure',
  rigId: 'fra400',
  rigName: 'Askar FRA 400',
  enabled: true,
  unavailableReason: null,
  phase: 'adjusting',
  activity: 'waiting',
  active: true,
  position: 3,
  solvedPositions: 3,
  exposureSeconds: 2,
  exposureStartedAt: null,
  measuredAt: alignmentMeasuredAt,
  warning: null,
  error: null,
  measurement: alignmentMeasurement,
  preview: null,
}

export function createAlignmentScene(name: AlignmentScene) {
  let view = structuredClone(alignmentAdjusting)
  const interrupted = name === 'alignment-phone-read-interrupted'
  const time = interrupted ? '2026-10-01T01:02:59.000Z' : '2026-10-01T01:02:16.000Z'
  let readFailure: number | null = null
  let offlineAfter: number | null = name === 'alignment-offline' ? 2 : null
  let reads = 0
  let delayMs = name === 'alignment-loading' ? 8000 : 0
  const imageFailures = new Map<string, number>()
  const imageUrls = new Set([imageUrl])

  const outcomes: Partial<
    Record<Command, 'confirmed' | 'unconfirmed' | 'unconfirmed-active' | 'rejected' | 'pending'>
  > = {}

  const unknownRequests: string[] = []

  const writes: Array<{
    method: string
    pathname: string
    body: unknown
  }> = []

  if (
    name === 'alignment-setup' ||
    name === 'alignment-unavailable' ||
    name === 'alignment-loading'
  ) {
    view = {
      ...view,
      phase: 'setup',
      activity: 'idle',
      active: false,
      position: 0,
      solvedPositions: 0,
      measuredAt: null,
      measurement: null,
    }
  }

  if (name === 'alignment-unavailable') {
    view.enabled = false
    view.unavailableReason = 'The imaging camera is not connected.'
  }

  if (name.includes('baseline')) {
    const activity = name.replace('alignment-baseline-', '')
    view = {
      ...view,
      phase: 'baseline',
      activity: 'solving',
      position: 2,
      solvedPositions: 1,
      measurement: null,
      measuredAt: null,
      preview: {
        imageUrl,
        imageWidth: 1600,
        imageHeight: 1200,
        capturedAt: alignmentMeasuredAt,
        capturedAtSource: 'server-estimate',
        position: 2,
      },
    }

    if (activity === 'homing' || activity === 'moving' || activity === 'exposing') {
      view.activity = activity
      view.preview = null
    }

    if (activity === 'homing') {
      view.position = 0
      view.solvedPositions = 0
    }

    if (activity === 'exposing') view.exposureStartedAt = alignmentMeasuredAt

    if (name === 'alignment-baseline-no-solution') {
      view.activity = 'waiting'
      view.warning = 'This exposure could not be solved. Taking another exposure at this position.'
    }
  }

  if (interrupted) {
    view.activity = 'retrying'
    view.warning = 'Device connection interrupted. Retrying automatically.'
  }

  if (name === 'alignment-image-failed') imageFailures.set(imageUrl, 503)

  if (name === 'alignment-stop-pending') outcomes.stop = 'pending'

  if (name === 'alignment-stop-unconfirmed') outcomes.stop = 'unconfirmed-active'

  if (name === 'alignment-stopped' || name === 'alignment-finished') {
    view = {
      ...view,
      phase: name === 'alignment-stopped' ? 'stopped' : 'finished',
      active: false,
      activity: 'idle',
    }
  }

  function result(status = 200, json: ReviewPayload = view): ReviewResponse {
    const response: ReviewResponse = { status, json: structuredClone(json) }

    if (delayMs) response.delayMs = delayMs

    return response
  }

  return {
    name,
    route: '/rigs/fra400/observe/alignment',
    time,
    timezone: reviewTimezone,
    appearance: name.startsWith('appearance-') ? ('system' as const) : ('light' as const),
    colorScheme: name === 'appearance-phone-dark' ? ('dark' as const) : ('light' as const),
    unknownRequests,
    writes,
    get reads() {
      return reads
    },
    snapshot: () => structuredClone(view),
    setView(next: AlignmentView) {
      view = structuredClone(next)

      if (next.measurement) imageUrls.add(next.measurement.imageUrl)

      if (next.preview) imageUrls.add(next.preview.imageUrl)
    },
    setReadFailure(status: number | null) {
      readFailure = status
      offlineAfter = null
    },
    setImageFailure(url: string, status: number | null) {
      if (status === null) imageFailures.delete(url)
      else imageFailures.set(url, status)
    },
    setCommandOutcome(command: Command, outcome: NonNullable<(typeof outcomes)[Command]>) {
      outcomes[command] = outcome
    },
    setDelay(ms: number) {
      delayMs = Number.isFinite(ms) ? Math.max(0, Math.min(60000, ms)) : 0
    },
    respond(method: string, pathname: string, body?: ReviewCommand): ReviewResponse {
      if (method === 'GET' && pathname === '/api/web/rigs/fra400')
        return { status: 200, json: structuredClone(equipmentRig) }

      if (method === 'GET' && pathname === '/api/web/rigs/fra400/observe')
        return {
          status: 200,
          json: {
            rig: structuredClone(equipmentRig),
            connectionPreparation: { state: 'available', capabilities: ['connect-devices'] },
          },
        }

      if (method === 'GET' && pathname === '/api/web/navigation')
        return {
          status: 200,
          json: {
            rigs: [{ id: 'fra400', name: view.rigName }],
            captures: [],
          },
        }

      if (method === 'GET' && pathname === '/api/web/rigs/fra400/alignment') {
        reads++
        const failure = readFailure ?? (offlineAfter !== null && reads > offlineAfter ? 503 : null)

        return failure ? result(failure, { error: 'review-alignment-read-unavailable' }) : result()
      }

      if (method === 'GET' && imageUrls.has(pathname)) {
        const failure = imageFailures.get(pathname)

        return failure
          ? { status: failure, json: { error: 'review-image-unavailable' } }
          : { status: 200, resource: alignmentResource.resource }
      }

      const command = pathname.slice('/api/rigs/fra400/alignment/'.length)

      if (
        method === 'POST' &&
        pathname === `/api/rigs/fra400/alignment/${command}` &&
        (command === 'start' || command === 'stop' || command === 'finish')
      ) {
        writes.push({ method, pathname, body: structuredClone(body) })

        if (!z.strictObject({}).safeParse(body).success)
          return result(400, { error: 'Expected an empty JSON object' })

        if (
          outcomes[command] === 'rejected' ||
          (command === 'start' && (view.active || !view.enabled))
        )
          return result(409, { error: 'Review command rejected' })

        if (command === 'start')
          view = {
            ...view,
            phase: 'baseline',
            activity: 'homing',
            active: true,
            position: 0,
            solvedPositions: 0,
            measurement: null,
            preview: null,
            measuredAt: null,
            exposureStartedAt: null,
            warning: null,
            error: null,
          }
        else if (outcomes[command] === 'pending' || outcomes[command] === 'unconfirmed-active')
          view = { ...view, activity: 'stopping' }
        else
          view = {
            ...view,
            phase: command === 'finish' ? 'finished' : 'stopped',
            activity: 'idle',
            active: false,
            warning: null,
            exposureStartedAt: null,
          }

        return outcomes[command] === 'unconfirmed' || outcomes[command] === 'unconfirmed-active'
          ? result(503, { error: 'review-command-response-lost' })
          : result()
      }

      unknownRequests.push(`${method} ${pathname}`)

      return { status: 501, json: { error: 'unmapped-alignment-review-request', method, pathname } }
    },
  }
}
