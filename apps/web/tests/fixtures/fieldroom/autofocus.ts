import { z } from 'zod'
import { equipmentRig } from './equipment'
import type { AutofocusView } from '@vela/model/web'
import { previewAutofocusWindow } from '../../../src/features/autofocus/window'
import { reviewTimezone, type ReviewResponse } from './tonight'

export const autofocusScenes = [
  'autofocus-ready',
  'autofocus-running',
  'autofocus-phone-running',
  'autofocus-interrupted',
  'autofocus-result',
  'autofocus-restored',
  'autofocus-invalid-window',
  'autofocus-restore-unconfirmed',
  'autofocus-offline',
  'autofocus-moving',
  'autofocus-measuring',
  'autofocus-fitting',
  'autofocus-confirming',
  'autofocus-no-stars',
  'autofocus-stop-pending',
  'autofocus-restoring',
  'autofocus-stop-unconfirmed',
] as const

export type AutofocusScene = (typeof autofocusScenes)[number]

type ReviewPayload = ReviewResponse['json']

interface ReviewCommand {
  stepSize?: number
  offsetSteps?: number
  exposureSeconds?: number
}

type Command = 'start' | 'stop'

type Outcome = 'confirmed' | 'unconfirmed' | 'unconfirmed-active' | 'rejected' | 'pending'

export const autofocusTime = '2026-10-01T01:03:12.000Z'

export const autofocusSetup: AutofocusView = {
  rigId: 'fra400',
  rigName: 'Askar FRA 400',
  enabled: true,
  unavailableReason: null,
  cameraName: 'ZWO ASI2600MC Pro',
  focuserName: 'ZWO EAF',
  phase: 'setup',
  activity: 'idle',
  captureReadState: 'current',
  active: false,
  startPosition: null,
  currentPosition: 32842,
  maxStep: 60000,
  stepSize: 50,
  offsetSteps: 4,
  exposureSeconds: 2,
  elapsedSeconds: 0,
  exposureStartedAt: null,
  samples: [],
  fit: null,
  restoredStart: false,
  error: null,
}

// Design values expanded to complete API facts. No camera or focuser observations.
const measuredPairs = [
  [33042, 5.1],
  [32992, 4.4],
  [32942, 3.65],
  [32892, 2.95],
  [32842, 2.45],
  [32792, 2.1],
  [32742, 2.6],
  [32692, 3.3],
  [32642, 4.2],
] as const

export const autofocusSamples: AutofocusView['samples'] = measuredPairs.map(
  ([position, hfrPixels], index) => ({
    position,
    hfrPixels,
    detectedStars: 84,
    capturedAt: new Date(Date.parse('2026-10-01T01:02:54.000Z') + index * 4000).toISOString(),
  }),
)

export const autofocusWalking: AutofocusView = {
  ...autofocusSetup,
  phase: 'walking',
  activity: 'exposing',
  active: true,
  startPosition: 32842,
  currentPosition: 32792,
  elapsedSeconds: 1,
  exposureStartedAt: '2026-10-01T01:03:11.000Z',
  samples: autofocusSamples.slice(0, 5),
}

export const autofocusResult: AutofocusView = {
  ...autofocusWalking,
  phase: 'complete',
  activity: 'idle',
  active: false,
  currentPosition: 32788,
  exposureStartedAt: null,
  elapsedSeconds: 0,
  samples: autofocusSamples,
  fit: { position: 32788, p: 32788.2, a: 2.08, b: 105, rSquared: 0.97, minSamplePosition: 32792 },
}

export function createAutofocusScene(name: AutofocusScene) {
  let view = structuredClone(autofocusWalking)
  let reads = 0
  let readFailure: number | null = null
  let offlineAfter: number | null = name === 'autofocus-offline' ? 2 : null
  let delayMs = 0
  const outcomes: Record<Command, Outcome> = { start: 'confirmed', stop: 'confirmed' }
  const unknownRequests: string[] = []

  const writes: Array<{
    method: string
    pathname: string
    body: unknown
  }> = []

  let time = autofocusTime

  if (name === 'autofocus-ready' || name === 'autofocus-invalid-window')
    view = structuredClone(autofocusSetup)

  if (name === 'autofocus-invalid-window') view.currentPosition = 150

  if (name === 'autofocus-interrupted') view.captureReadState = 'retrying'

  if (
    name === 'autofocus-result' ||
    name === 'autofocus-fitting' ||
    name === 'autofocus-confirming'
  ) {
    view = structuredClone(autofocusResult)
    time = '2026-10-01T01:03:34.000Z'

    if (name === 'autofocus-fitting')
      view = {
        ...view,
        phase: 'fitting',
        activity: 'fitting',
        active: true,
        fit: null,
        currentPosition: 32642,
      }

    if (name === 'autofocus-confirming')
      view = {
        ...view,
        phase: 'confirming',
        activity: 'exposing',
        active: true,
        exposureStartedAt: '2026-10-01T01:03:33.000Z',
        elapsedSeconds: 1,
      }
  }

  if (name === 'autofocus-restored')
    view = {
      ...view,
      phase: 'stopped',
      activity: 'idle',
      active: false,
      restoredStart: true,
      currentPosition: 32842,
      exposureStartedAt: null,
      elapsedSeconds: 0,
    }

  if (name === 'autofocus-restore-unconfirmed')
    view = {
      ...view,
      phase: 'failed',
      activity: 'idle',
      active: false,
      exposureStartedAt: null,
      error:
        'Could not confirm return to the start position. Check the focuser before starting again.',
    }

  if (name === 'autofocus-moving')
    view = {
      ...view,
      activity: 'moving',
      exposureStartedAt: null,
      elapsedSeconds: 0,
    }

  if (name === 'autofocus-measuring') view.activity = 'measuring'

  if (name === 'autofocus-restoring')
    view = {
      ...view,
      activity: 'restoring',
      exposureStartedAt: null,
      elapsedSeconds: 0,
    }

  if (name === 'autofocus-no-stars') {
    view.samples.push({
      position: 32792,
      detectedStars: 0,
      hfrPixels: null,
      capturedAt: '2026-10-01T01:03:14.000Z',
    })
    view = {
      ...view,
      phase: 'failed',
      activity: 'idle',
      active: false,
      currentPosition: 32842,
      restoredStart: true,
      exposureStartedAt: null,
      error: 'No measurable stars in the last exposure. Returned to the start position.',
    }
    time = '2026-10-01T01:03:18.000Z'
  }

  if (name === 'autofocus-stop-pending') outcomes.stop = 'pending'

  if (name === 'autofocus-stop-unconfirmed') outcomes.stop = 'unconfirmed-active'

  function result(status = 200, json: ReviewPayload = view): ReviewResponse {
    const response: ReviewResponse = { status, json: structuredClone(json) }

    if (delayMs) response.delayMs = delayMs

    return response
  }

  return {
    name,
    route: '/rigs/fra400/observe/autofocus',
    time,
    timezone: reviewTimezone,
    appearance: 'light' as const,
    colorScheme: 'light' as const,
    unknownRequests,
    writes,
    get reads() {
      return reads
    },
    snapshot: () => structuredClone(view),
    setView(next: AutofocusView) {
      view = structuredClone(next)
    },
    setReadFailure(status: number | null) {
      readFailure = status
      offlineAfter = null
    },
    setCommandOutcome(command: Command, outcome: Outcome) {
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

      if (method === 'GET' && pathname === '/api/web/rigs/fra400/autofocus') {
        reads++
        const failure = readFailure ?? (offlineAfter !== null && reads > offlineAfter ? 503 : null)

        return failure ? result(failure, { error: 'review-autofocus-read-unavailable' }) : result()
      }

      const command = pathname.slice('/api/rigs/fra400/autofocus/'.length)

      if (
        method === 'POST' &&
        pathname === `/api/rigs/fra400/autofocus/${command}` &&
        (command === 'start' || command === 'stop')
      ) {
        writes.push({ method, pathname, body: structuredClone(body) })

        if (outcomes[command] === 'rejected')
          return result(409, { error: 'Review command rejected' })

        if (command === 'start') {
          const parsed = z
            .strictObject({
              stepSize: z.number().int().min(1).max(2000).optional(),
              offsetSteps: z.number().int().min(1).max(10).optional(),
              exposureSeconds: z.number().min(0.1).max(30).optional(),
            })
            .safeParse(body)

          if (!parsed.success) return result(400, { error: 'Invalid autofocus settings' })
          const stepSize = parsed.data.stepSize ?? view.stepSize
          const offsetSteps = parsed.data.offsetSteps ?? view.offsetSteps
          const exposureSeconds = parsed.data.exposureSeconds ?? view.exposureSeconds

          if (
            view.active ||
            !view.enabled ||
            !previewAutofocusWindow(view.currentPosition, stepSize, offsetSteps, view.maxStep).fit
          )
            return result(409, { error: 'Autofocus window would approach 0 or MaxStep' })
          view = {
            ...view,
            startPosition: view.currentPosition,
            stepSize,
            offsetSteps,
            exposureSeconds,
            phase: 'walking',
            activity: 'moving',
            active: true,
            captureReadState: 'current',
            samples: [],
            fit: null,
            restoredStart: false,
            error: null,
            exposureStartedAt: null,
            elapsedSeconds: 0,
          }
        } else {
          if (!z.strictObject({}).safeParse(body).success)
            return result(400, { error: 'Expected an empty JSON object' })

          if (outcomes.stop === 'pending' || outcomes.stop === 'unconfirmed-active')
            view = { ...view, activity: 'stopping', captureReadState: 'current' }
          else
            view = {
              ...view,
              phase: 'stopped',
              activity: 'idle',
              active: false,
              restoredStart: view.startPosition !== null,
              currentPosition: view.startPosition ?? view.currentPosition,
              captureReadState: 'current',
              exposureStartedAt: null,
              elapsedSeconds: 0,
            }
        }

        return outcomes[command] === 'unconfirmed' || outcomes[command] === 'unconfirmed-active'
          ? result(503, { error: 'review-command-response-lost' })
          : result()
      }

      unknownRequests.push(`${method} ${pathname}`)

      return { status: 501, json: { error: 'unmapped-autofocus-review-request', method, pathname } }
    },
  }
}
