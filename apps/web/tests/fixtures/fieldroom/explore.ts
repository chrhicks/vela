import type {
  CaptureView, FramingView, ImagingCameraView, NavigationView,
  RigDetailView, RigObservationView, TargetCatalogView, TargetDiscoveryItem, TargetDiscoveryView,
} from '@vela/model/web'
import { reviewCapture, reviewRig, reviewTarget, reviewTime, reviewTimezone, subject, type ReviewResponse } from './tonight'
import { reviewResource } from './resources'

export const exploreScenes = [
  'explore-light', 'explore-dark', 'explore-no-rig', 'explore-no-site',
  'explore-no-darkness', 'explore-empty', 'explore-thumbnail-failed', 'explore-expired', 'explore-offline',
  'framing-light', 'framing-dark', 'framing-unsolved', 'framing-interrupted',
  'framing-preview-failed', 'framing-read-retrying', 'framing-obsolete', 'framing-centering',
  'preparation-light', 'preparation-dark', 'preparation-camera-save-failed',
  'preparation-start-uncertain', 'preparation-cooling-uncertain', 'preparation-unframed',
] as const

export type ExploreScene = (typeof exploreScenes)[number]

interface ReviewCommand {
  id?: string
  name?: string
  targetId?: string
  checkId?: string
  raDegrees?: number
  decDegrees?: number
  exposureSeconds?: number
  repeat?: boolean
  saveFrames?: boolean
  coolerOn?: boolean
  setpointC?: number
}

const base = '/rigs/fra400/observe'

const opportunity = {
  startsAt: reviewTime,
  endsAt: '2026-09-30T05:00:00.000Z',
  usefulMinutes: 196,
  bestAt: '2026-09-30T02:00:00.000Z',
  bestAltitudeDegrees: 74,
  currentAltitudeDegrees: 68,
}

export const exploreTargets: TargetDiscoveryItem[] = [
  { ...reviewTarget, thumbnailUrl: '/api/review/images/crescent', category: 'emission',
    filterChoice: 'dual-band', filterReason: 'The L-Ultimate isolates Hα and O III emission. Filter advice does not detect an installed filter.', opportunity },
  { ...reviewTarget, id: 'ngc0224', name: 'Andromeda Galaxy', catalog: 'M31 · NGC 224',
    constellation: 'Andromeda', kind: 'Galaxy', raDegrees: 10.68479167, decDegrees: 41.26905556,
    sizeArcminutes: 177.8, minorSizeArcminutes: 69.7, thumbnailUrl: '/api/review/images/andromeda',
    category: 'galaxy', filterChoice: 'broadband', filterReason: 'Broadband preserves the galaxy’s starlight. Filter advice does not detect an installed filter.', opportunity },
  { ...reviewTarget, id: 'ngc6205', name: 'Great Hercules Cluster', catalog: 'M13 · NGC 6205',
    constellation: 'Hercules', kind: 'Globular cluster', raDegrees: 250.42345833, decDegrees: 36.46130556,
    sizeArcminutes: 16.6, minorSizeArcminutes: null, thumbnailUrl: '/api/review/images/m13',
    category: 'cluster', filterChoice: 'broadband', filterReason: 'Broadband preserves the cluster’s starlight. Filter advice does not detect an installed filter.', opportunity },
]

export const reviewFraming: FramingView = {
  rigId: 'fra400', rigName: 'Askar FRA 400', enabled: true, unavailableReason: null,
  observedAt: reviewTime, focalLengthMm: 400,
  camera: { name: 'ASI2600MC Pro', width: 6248, height: 4176,
    fieldWidthDegrees: 3.36, fieldHeightDegrees: 2.24 },
  phase: 'checked', captureReadState: 'current', active: false, pointingSide: 'east',
  centering: null, desired: { raDegrees: reviewTarget.raDegrees, decDegrees: reviewTarget.decDegrees },
  targetId: subject.targetId,
  actual: {
    raDegrees: reviewTarget.raDegrees - 0.003,
    decDegrees: reviewTarget.decDegrees,
    checkId: 'review-solved-check-1', capturedAt: '2026-09-30T01:42:32.000Z',
    rotationDegrees: 0, offsetArcminutes: 0.2,
    corners: [
      { raDegrees: 300.88, decDegrees: 37.23 }, { raDegrees: 305.17, decDegrees: 37.23 },
      { raDegrees: 305.17, decDegrees: 39.47 }, { raDegrees: 300.88, decDegrees: 39.47 },
    ],
  },
  preview: {
    id: 'review-test-1', rigId: 'fra400', targetId: subject.targetId,
    width: 1280, height: 1224, exposureSeconds: 2,
    cameraName: 'Reference image · mock framing exposure', capturedAt: '2026-09-30T01:42:32.000Z',
    capturedAtSource: 'camera', checkId: 'review-solved-check-1',
    previewUrl: '/api/web/rigs/fra400/framing/previews/review-test-1/fit.png',
    nativePreviewUrl: '/api/web/rigs/fra400/framing/previews/review-test-1/native.png',
    statistics: null,
  },
  error: null, exposureSeconds: 2, canCenter: true, checkCurrent: true,
}

/** Named review states use actual routes and production contracts, never hardware. */
export function createExploreScene(name: ExploreScene) {
  const rigless = name === 'explore-no-rig'

  let capture: CaptureView = { ...structuredClone(reviewCapture), active: false, phase: 'idle',
    completedCount: 0, savedCount: 0, integrationSeconds: 0, latestImage: null, subject: null, elapsedSeconds: 0 }

  let framing = structuredClone(reviewFraming)

  let camera: ImagingCameraView = {
    rigId: 'fra400', selected: { id: 'camera', name: 'ASI2600MC Pro' }, selectedDeviceId: 'camera',
    cameras: [ { id: 'camera', name: 'ASI2600MC Pro', configuredName: 'ASI2600MC Pro' },
      { id: 'guide-camera', name: 'ASI220MM Mini', configuredName: 'ASI220MM Mini' } ],
    state: 'ready', editable: true,
  }

  let reads = 0
  let acquisition = 1
  let startUncertain = false
  let coolingUncertain = false
  const commands: Array<{ method: string; pathname: string; body: unknown }> = []
  const unknownRequests: string[] = []

  const rig: RigDetailView = {
    ...structuredClone(reviewRig),
    devices: reviewRig.devices.map(device => device.kind === 'camera' && device.connection === 'connected'
      ? { ...device, status: { availability: 'complete', activity: 'idle', sensorTemperatureC: -8.6, cooling: { state: 'on', powerPercent: 62 } } }
      : structuredClone(device)),
  }

  const observation: RigObservationView = { rig, connectionPreparation: { state: 'complete', capabilities: [] } }

  if (name === 'framing-unsolved') framing = { ...framing, phase: 'needs-check', checkCurrent: false, canCenter: false,
    error: 'This exposure could not be solved. Your composition is kept.',
    preview: { ...framing.preview!, id: 'review-test-2', checkId: null,
      capturedAt: '2026-09-30T01:43:32.000Z',
      previewUrl: '/api/web/rigs/fra400/framing/previews/review-test-2/fit.png',
      nativePreviewUrl: '/api/web/rigs/fra400/framing/previews/review-test-2/native.png' } }

  if (name === 'framing-preview-failed') framing.preview = { ...framing.preview!, previewUrl: null, nativePreviewUrl: null }

  if (name === 'framing-obsolete') framing = { ...framing, canCenter: false, checkCurrent: false }

  if (name === 'framing-read-retrying') framing = { ...framing, active: true, phase: 'exposing', captureReadState: 'retrying', checkCurrent: false, canCenter: false }

  if (name === 'framing-centering') framing = { ...framing, active: true, phase: 'settling', checkCurrent: false, canCenter: false,
    centering: { toleranceArcminutes: 0.5, maxCorrections: 4, correction: 1, outcome: 'working', measurements: [
      { correction: 0, checkId: framing.actual!.checkId, capturedAt: framing.actual!.capturedAt,
        offsetArcminutes: 4.2, rotationDegrees: 0, pointingSide: 'east', pointingSideChanged: false, trend: 'starting' },
    ] } }

  if (name.startsWith('preparation')) {
    const capturedAt = '2026-09-30T01:06:18.000Z'
    framing = { ...framing, checkCurrent: false, canCenter: false,
      actual: { ...framing.actual!, capturedAt },
      preview: { ...framing.preview!, exposureSeconds: 10, capturedAt,
        cameraName: 'Reference image · mock exposure',
        statistics: { detectedStars: 842, medianHfrPixels: 2.1 } } }
    capture = { ...capture, cooling: { ...capture.cooling!, sensorTemperatureC: -8.6, setpointC: -10, powerPercent: 62 } }
  }

  if (name === 'preparation-unframed') framing = { ...framing, phase: 'idle', actual: null, preview: null, checkCurrent: false, canCenter: false }

  const json = <Body>(value: Body): ReviewResponse => ({ status: 200, json: value })
  const failure = (status: number, error: string): ReviewResponse => ({ status, json: { error } })

  return {
    name,
    route: rigless ? '/explore' : name.startsWith('explore') ? `${base}/targets` :
      name.startsWith('framing') ? `${base}/targets/${subject.targetId}` : `${base}?target=${subject.targetId}`,
    time: reviewTime, timezone: reviewTimezone, appearance: name.endsWith('-dark') ? 'dark' : 'light',
    commands, unknownRequests,
    respond(method: string, requestUrl: string, body?: ReviewCommand): ReviewResponse {
      const url = new URL(requestUrl, 'http://review.invalid')
      const pathname = url.pathname

      if (method !== 'GET') commands.push({ method, pathname, body })

      if (method === 'GET' && pathname === '/api/web/navigation') {
        const navigation: NavigationView = { rigs: rigless ? [] : [{ id: 'fra400', name: rig.name }],
          captures: rigless ? [] : [{ rigId: 'fra400', rigName: rig.name, phase: capture.phase,
            active: capture.active, captureReadState: capture.captureReadState, completedCount: capture.completedCount,
            elapsedSeconds: capture.elapsedSeconds, exposureSeconds: capture.exposureSeconds, error: capture.error }] }

        return json(navigation)
      }

      if (method === 'GET' && pathname.startsWith('/api/review/images/')) {
        const resource = pathname.slice('/api/review/images/'.length)

        return name === 'explore-thumbnail-failed' ? failure(503, 'Reference image unavailable') :
          reviewResource(resource) ? { status: 200, resource } : failure(404, 'Missing review image')
      }

      if (method === 'GET' && pathname.startsWith('/api/survey/dss2/')) {
        const resource = `survey:${pathname.slice('/api/survey/dss2/'.length)}`

        return reviewResource(resource) ? { status: 200, resource } : failure(404, 'This DSS tile is not in the pinned review region')
      }

      if (method === 'GET' && (pathname === '/api/web/target-catalog' || pathname === '/api/web/rigs/fra400/target-discovery')) {
        reads++

        if (name === 'explore-offline' && reads > 2) return failure(503, 'Catalog connection interrupted')

        if (name === 'explore-expired' && url.searchParams.has('snapshot')) return failure(410, 'This saved calculation is no longer available. Refresh to calculate from now.')
        const query = url.searchParams.get('q') ?? ''
        const categories = ['all', 'emission', 'reflection-dark', 'galaxy', 'cluster', 'planetary', 'other'] as const
        const filters = ['all', 'dual-band', 'broadband', 'uncertain'] as const
        const category = categories.find(value => value === (url.searchParams.get('category') ?? 'all'))
        const filter = filters.find(value => value === (url.searchParams.get('filter') ?? 'all'))
        const pageSize = Number(url.searchParams.get('pageSize') ?? 12)
        const offset = Number(url.searchParams.get('offset') ?? 0)

        if (!category || !filter || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 12 || !Number.isInteger(offset) || offset < 0)
          return failure(400, 'Invalid catalog request')

        const matches = name === 'explore-empty' || (name === 'explore-no-darkness' && !query) ? [] : exploreTargets.filter(target =>
          `${target.name} ${target.catalog} ${target.kind}`.toLowerCase().includes(query.toLowerCase()) &&
          (category === 'all' || category === target.category) && (filter === 'all' || filter === target.filterChoice))

        const pageOffset = matches.length ? Math.min(offset, Math.floor((matches.length - 1) / pageSize) * pageSize) : 0

        const common = { query, category, filter, pageSize, offset: pageOffset, total: matches.length,
          targets: matches.slice(pageOffset, pageOffset + pageSize) }

        if (pathname === '/api/web/target-catalog') {
          const catalog: TargetCatalogView = { ...common,
            targets: common.targets.map(({ sky: _sky, opportunity: _opportunity, ...target }) => target) }

          return json(catalog)
        }

        const noSite = name === 'explore-no-site'

        const discovery: TargetDiscoveryView = { ...common, rigId: 'fra400', rigName: rig.name,
          snapshotId: '00000000-0000-0000-0000-000000000001', calculatedAt: reviewTime,
          status: noSite ? 'site-unavailable' : name === 'explore-no-darkness' ? 'no-darkness' : 'available',
          night: noSite || name === 'explore-no-darkness' ? null : { startsAt: '2026-09-29T23:00:00.000Z', endsAt: '2026-09-30T05:00:00.000Z', kind: 'current-night' },
          site: noSite ? null : { latitudeDegrees: 40, longitudeDegrees: -75 }, siteUnavailableReason: noSite ? 'Mount location is unavailable.' : null,
          targets: common.targets.map(target => noSite ? { ...target, sky: null, opportunity: null } : target) }

        return json(discovery)
      }

      if (rigless) return failure(404, 'No rig exists in this review scene')

      if (method === 'GET' && pathname === '/api/web/rigs/fra400') return json(rig)

      if (method === 'GET' && pathname === '/api/web/rigs/fra400/observe') return json(observation)

      if (method === 'GET' && pathname.startsWith('/api/web/rigs/fra400/targets/')) {
        const target = exploreTargets.find(item => item.id === pathname.split('/').at(-1))

        return target ? json(target) : failure(404, 'Unknown target')
      }

      if (method === 'GET' && pathname === '/api/web/rigs/fra400/imaging-camera') return json(camera)

      if (method === 'PUT' && pathname === '/api/rigs/fra400/imaging-camera') {
        if (name === 'preparation-camera-save-failed') return failure(409, 'Camera selection could not be saved')
        const selected = camera.cameras.find(item => item.id === body?.id && item.name === body?.name)

        if (!selected?.name) return failure(400, 'Unknown imaging camera')
        camera = { ...camera, selected: { id: selected.id, name: selected.name }, selectedDeviceId: selected.id }
        capture = { ...capture, camera: { name: selected.name } }

        return json(camera)
      }

      if (method === 'GET' && pathname === '/api/web/rigs/fra400/capture')
        return startUncertain || coolingUncertain ? failure(503, 'Camera state is still unavailable') : json(capture)

      if (method === 'POST' && pathname === '/api/rigs/fra400/capture/start') {
        if (name === 'preparation-start-uncertain') { startUncertain = true;

 return failure(503, 'Start response interrupted') }

        capture = { ...capture, active: true, phase: 'exposing', exposureSeconds: Number(body?.exposureSeconds),
          repeat: body?.repeat === true, saveFrames: body?.saveFrames === true,
          subject: body?.targetId === subject.targetId ? subject : null }

        return json(capture)
      }

      if (method === 'POST' && pathname === '/api/rigs/fra400/capture/cooling') {
        if (name === 'preparation-cooling-uncertain') { coolingUncertain = true;

 return failure(503, 'The cooler command could not be confirmed. Check camera cooling before assuming it changed.') }

        const cooling = { ...capture.cooling! }

        if (body?.coolerOn !== undefined) cooling.state = body.coolerOn ? 'on' : 'off'

        if (body?.setpointC !== undefined) cooling.setpointC = body.setpointC
        capture = { ...capture, cooling }

        return json(capture)
      }

      if (method === 'GET' && pathname === '/api/web/rigs/fra400/framing') {
        reads++

        return name === 'framing-interrupted' && reads > 2 ? failure(503, 'Framing read interrupted') : json(framing)
      }

      if (method === 'GET' && /^\/api\/web\/rigs\/fra400\/framing\/previews\/review-test-\d+\/(fit|native)\.png$/.test(pathname))
        return { status: 200, resource: 'crescent' }

      if (method === 'POST' && /^\/api\/rigs\/fra400\/framing\/(start|check|center|stop)$/.test(pathname)) {
        if (pathname.endsWith('/stop')) { framing = { ...framing, active: false, phase: 'stopped', captureReadState: 'current' };

 return json(framing) }

        acquisition++
        framing = { ...framing, active: false, phase: 'checked', checkCurrent: true, canCenter: true, error: null,
          desired: { raDegrees: Number(body?.raDegrees), decDegrees: Number(body?.decDegrees) },
          actual: { ...framing.actual!, checkId: `review-solved-check-${acquisition}` },
          preview: { ...reviewFraming.preview!, id: `review-test-${acquisition}`, checkId: `review-solved-check-${acquisition}`,
            previewUrl: `/api/web/rigs/fra400/framing/previews/review-test-${acquisition}/fit.png`,
            nativePreviewUrl: `/api/web/rigs/fra400/framing/previews/review-test-${acquisition}/native.png` } }

        return json(framing)
      }

      unknownRequests.push(`${method} ${pathname}`)

      return failure(404, `Review scene has no response for ${method} ${pathname}`)
    },
  }
}
