import type { CaptureView, NavigationView, RigDetailView, TargetView } from '@vela/model/web'

export const reviewTime = '2026-09-30T01:43:44.000Z'

export const reviewTimezone = 'America/New_York'

export const referenceImage = {
  path: 'packages/ui/src/drafts/target-framing/crescent.jpg',
  sha256: '84e71f8578a39f3104f929c6013c1c76bb7fa953f64c6ca4ef9055247f203664',
}

export const reviewRoute = '/rigs/fra400/observe/capture'

export const subject = { targetId: 'ngc6888', name: 'The Crescent Nebula', catalog: 'NGC 6888' }

export const reviewCapture: CaptureView = {
  rigId: 'fra400',
  rigName: 'Askar FRA 400',
  camera: { name: 'ASI2600MC Pro' },
  enabled: true,
  unavailableReason: null,
  phase: 'exposing',
  captureReadState: 'current',
  active: true,
  repeat: true,
  saveFrames: true,
  savedImageCount: 12,
  completedCount: 12,
  subject,
  savedCount: 12,
  integrationSeconds: 2160,
  exposureSeconds: 180,
  elapsedSeconds: 96,
  error: null,
  latestImage: {
    id: 'review-frame-12',
    subject,
    imageUrl: '/api/rigs/fra400/capture/images/review-frame-12',
    fitImageUrl: '/api/rigs/fra400/capture/images/review-frame-12/fit',
    width: 1280,
    height: 1224,
    exposureSeconds: 180,
    capturedAt: '2026-09-30T01:39:08.000Z',
    receivedAt: '2026-09-30T01:42:08.000Z',
    cameraName: 'Reference image · mock exposure',
    color: 'color',
    statistics: { detectedStars: 842, medianHfrPixels: 2.1 },
    saved: true,
  },
  cooling: {
    state: 'on',
    canSetTemperature: true,
    sensorTemperatureC: -10,
    setpointC: -10,
    powerPercent: 38,
  },
}

export const reviewRig: RigDetailView = {
  id: 'fra400',
  name: 'Askar FRA 400',
  state: 'reachable',
  endpoint: { host: 'review.invalid', port: 11111 },
  addedAt: reviewTime,
  lastInventoryAt: reviewTime,
  refreshedAt: reviewTime,
  connections: { total: 3, connected: 3, disconnected: 0, unavailable: 0 },
  capabilities: ['forget'],
  devices: [
    {
      id: 'camera',
      configuredName: 'ASI2600MC Pro',
      name: 'ASI2600MC Pro',
      kind: 'camera',
      connection: 'connected',
      observedAt: reviewTime,
      status: {
        availability: 'complete',
        activity: 'exposing',
        sensorTemperatureC: -10,
        cooling: { state: 'on', powerPercent: 38 },
      },
    },
    {
      id: 'focuser',
      configuredName: 'ZWO EAF',
      name: 'ZWO EAF',
      kind: 'focuser',
      connection: 'connected',
      observedAt: reviewTime,
      status: { availability: 'complete', activity: 'idle', position: 32842 },
    },
    {
      id: 'mount',
      configuredName: 'AM5',
      name: 'AM5',
      kind: 'telescope',
      connection: 'connected',
      observedAt: reviewTime,
      status: {
        availability: 'complete',
        activity: 'tracking',
        tracking: 'on',
        parking: 'unparked',
        home: 'away',
      },
    },
  ],
}

const start = Date.parse('2026-09-29T23:00:00.000Z')

export const reviewTarget: TargetView = {
  id: subject.targetId,
  name: subject.name,
  catalog: subject.catalog,
  constellation: 'Cygnus',
  kind: 'Emission nebula',
  raDegrees: 303.027,
  decDegrees: 38.355,
  sizeArcminutes: 18,
  minorSizeArcminutes: 12,
  thumbnailUrl: '/api/rigs/fra400/capture/images/review-frame-12/fit',
  sky: {
    observedAt: reviewTime,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 6 * 3600000).toISOString(),
    currentAzimuthDegrees: 270,
    currentMoonSeparationDegrees: 112,
    currentAltitudeDegrees: 68,
    highestAltitudeDegrees: 74,
    aboveHorizonDuringDarkness: [
      {
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + 6 * 3600000).toISOString(),
      },
    ],
    samples: Array.from({ length: 25 }, (_, index) => ({
      at: new Date(start + index * 900000).toISOString(),
      altitudeDegrees: 18 + 56 * Math.sin((index / 24) * Math.PI),
      azimuthDegrees: (180 + index * 7.5) % 360,
      sunAltitudeDegrees: -22,
      moon: {
        altitudeDegrees: -20,
        azimuthDegrees: 30,
        illuminationFraction: 0.3,
        waxing: true,
      },
    })),
  },
}

export const tonightScenes = [
  'tonight-light',
  'tonight-dark',
  'tonight-idle',
  'tonight-interrupted',
  'tonight-camera-retry',
  'tonight-save-failed',
  'tonight-preview-failed',
] as const

export type TonightScene = (typeof tonightScenes)[number]

export type ReviewResponse = { status: number; json?: unknown; image?: true; resource?: string }

/** Each review session owns its counters and commands. Unknown endpoints never hit hardware. */
export function createTonightScene(name: TonightScene) {
  let capture = structuredClone(reviewCapture)
  let captureReads = 0

  if (name === 'tonight-idle')
    capture = {
      ...capture,
      active: false,
      phase: 'idle',
      latestImage: null,
      completedCount: 0,
      savedCount: 0,
      integrationSeconds: 0,
      subject: null,
    }

  if (name === 'tonight-camera-retry') capture.captureReadState = 'retrying'

  if (name === 'tonight-save-failed')
    capture = {
      ...capture,
      active: false,
      phase: 'failed',
      error: 'The image could not be saved. Capture stopped.',
      latestImage: { ...capture.latestImage!, saved: false },
    }

  return {
    name,
    route: reviewRoute,
    time: reviewTime,
    timezone: reviewTimezone,
    appearance: name === 'tonight-dark' ? 'dark' : 'light',
    respond(
      method: string,
      pathname: string,
      body?: {
        exposureSeconds?: number
        repeat?: boolean
        saveFrames?: boolean
        targetId?: string
      },
    ): ReviewResponse {
      if (name === 'tonight-interrupted' && captureReads > 2) return { status: 503, json: { error: 'Review connection interrupted' } }

      if (method === 'GET' && pathname === '/api/web/navigation') {
        const navigation: NavigationView = {
          rigs: [{ id: 'fra400', name: 'Askar FRA 400' }],
          captures: [{ rigId: capture.rigId, rigName: capture.rigName, phase: capture.phase, active: capture.active, captureReadState: capture.captureReadState, completedCount: capture.completedCount, elapsedSeconds: capture.elapsedSeconds, exposureSeconds: capture.exposureSeconds, error: capture.error }],
        }

        return { status: 200, json: navigation }
      }

      if (method === 'GET' && pathname === '/api/web/rigs/fra400')
        return { status: 200, json: reviewRig }

      if (method === 'GET' && pathname === '/api/web/rigs/fra400/targets/ngc6888')
        return { status: 200, json: reviewTarget }

      if (method === 'GET' && pathname === '/api/web/rigs/fra400/capture') {
        captureReads++

        if (name === 'tonight-interrupted' && captureReads > 2)
          return { status: 503, json: { error: 'Review connection interrupted' } }

        return { status: 200, json: capture }
      }

      if (
        method === 'GET' &&
        /^\/api\/rigs\/fra400\/capture\/images\/review-frame-12(?:\/fit)?$/.test(pathname)
      )
        return name === 'tonight-preview-failed'
          ? { status: 503, json: { error: 'Review preview unavailable' } }
          : { status: 200, image: true }

      if (method === 'POST' && pathname === '/api/rigs/fra400/capture/stop') {
        capture = { ...capture, active: false, phase: 'stopped' }

        return { status: 200, json: capture }
      }

      if (method === 'POST' && pathname === '/api/rigs/fra400/capture/start') {
        capture = {
          ...capture,
          active: true,
          phase: 'exposing',
          exposureSeconds: Number(body?.exposureSeconds ?? 180),
          elapsedSeconds: 0,
          repeat: body?.repeat === true,
          saveFrames: body?.saveFrames === true,
          completedCount: 0,
          savedCount: 0,
          integrationSeconds: 0,
          subject: body?.targetId === subject.targetId ? subject : null,
        }

        return { status: 200, json: capture }
      }

      return {
        status: 404,
        json: { error: `Review scene has no response for ${method} ${pathname}` },
      }
    },
  }
}
