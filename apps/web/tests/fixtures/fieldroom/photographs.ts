import type { NavigationView, SavedImage, SavedImagesView, SavedImageView } from '@vela/model/web'
import { referenceImage, reviewRig, reviewTimezone, subject, type ReviewResponse } from './tonight'

export const photographsScenes = [
  'photographs-light', 'photographs-dark', 'photographs-legacy', 'photographs-fallback',
  'photographs-empty', 'photographs-selected-missing', 'photographs-collection-failed',
  'photographs-preparing', 'photographs-detail-failed', 'photographs-fit-failed',
  'photographs-native-failed', 'photographs-native-missing', 'photographs-many-dates',
  'photographs-older-link', 'photographs-rig-switch',
] as const

export type PhotographsScene = (typeof photographsScenes)[number]

export const photographsTime = '2026-10-01T01:43:44.000Z'

export const photographsBase = '/rigs/fra400/observe/saved-images'

const collectionPath = '/api/web/rigs/fra400/saved-images'

const artifactPath = '/api/rigs/fra400/saved-images'

type Rendering = 'current' | 'legacy' | 'unavailable'

type PreviewKind = 'fit' | 'native'

function withRendering(image: SavedImage, rendering: Rendering): SavedImage {
  const base = `${artifactPath}/${encodeURIComponent(image.id)}`
  const preview = rendering === 'current' ? `${base}/previews/background-v1` : base

  return {
    ...image,
    imageUrl: `${preview}/preview`,
    fitImageUrl: `${preview}/fit`,
    previewDownloadUrl: `${preview}/download-preview`,
    previewRendering: rendering === 'current'
      ? { status: 'current', version: 'background-v1' }
      : { status: rendering },
  }
}

/** Source's six visible times are 186 seconds apart; older rows continue that illustrative cadence. */
function photograph(index: number, total: number, manyDates: boolean): SavedImage {
  const day = manyDates ? Math.floor(index / 6) : 0
  const withinDay = manyDates ? index % 6 : index
  const captured = Date.parse('2026-10-01T01:39:08.000Z') - day * 86_400_000 - withinDay * 186_000
  const id = `review-saved-${total - index}`
  const base = `${artifactPath}/${id}`

  return withRendering({
    id, rigId: 'fra400', subject,
    imageUrl: `${base}/preview`,
    width: 1280, height: 1224, exposureSeconds: 180,
    capturedAt: new Date(captured).toISOString(),
    capturedAtSource: 'camera',
    receivedAt: new Date(captured + 180_000).toISOString(),
    savedAt: new Date(captured + 181_000).toISOString(),
    cameraName: 'Reference image · Mock saved exposure',
    color: 'color', statistics: { detectedStars: 842, medianHfrPixels: 2.1 },
    saved: true, fitsUrl: `${base}/fits`, previewDownloadUrl: `${base}/download-preview`,
  }, 'current')
}

/** Static retained artifacts; only a selected detail read can publish its illustrative refreshed treatment. */
export function createPhotographsScene(name: PhotographsScene) {
  const manyDates = name === 'photographs-many-dates' || name === 'photographs-older-link'
  const total = name === 'photographs-empty' ? 0 : manyDates ? 24 : 12
  let images = Array.from({ length: total }, (_, index) => photograph(index, total, manyDates))
  const publishedCurrent = new Set(images.map(image => image.id))

  let selectedId = images[0]?.id

  if (name === 'photographs-selected-missing') selectedId = 'missing-saved-image'

  if (name === 'photographs-older-link') selectedId = images[19]!.id

  let collectionFailed = name === 'photographs-collection-failed'
  const detailDelays = new Map<string, number>()
  const detailFailures = new Map<string, number>()
  const previewFailures = new Map<string, number>()
  const unknownRequests: string[] = []
  const detailReads: string[] = []
  const fileReads: string[] = []

  if (name === 'photographs-legacy') {
    images = images.map(image => withRendering(image, 'legacy'))
    publishedCurrent.clear()
  }

  if (name === 'photographs-fallback') {
    images = images.map(image => withRendering(image, 'unavailable'))
    publishedCurrent.clear()
  }

  if (selectedId) {
    if (name === 'photographs-preparing') detailDelays.set(selectedId, 8000)

    if (name === 'photographs-detail-failed') detailFailures.set(selectedId, 503)

    if (name === 'photographs-fit-failed') previewFailures.set(`${selectedId}:fit`, 503)

    if (name === 'photographs-native-failed') previewFailures.set(`${selectedId}:native`, 503)

    if (name === 'photographs-native-missing') previewFailures.set(`${selectedId}:native`, 404)
  }

  const rig = { ...structuredClone(reviewRig), refreshedAt: photographsTime }
  const navigation: NavigationView = { rigs: [{ id: rig.id, name: rig.name }], captures: [] }

  if (name === 'photographs-rig-switch') navigation.rigs.push({ id: 'seestar', name: 'Seestar review rig' })
  const direct = !['photographs-light', 'photographs-dark', 'photographs-empty', 'photographs-many-dates'].includes(name)

  function respond(method: string, pathname: string, _body?: Record<string, never>): ReviewResponse {
    if (method === 'GET' && pathname === '/api/web/navigation') return { status: 200, json: navigation }

    if (name === 'photographs-rig-switch' && method === 'GET') {
      if (pathname === '/api/web/rigs/seestar') return { status: 200, json: { ...rig, id: 'seestar', name: 'Seestar review rig' } }

      if (pathname === '/api/web/rigs/seestar/saved-images') {
        const view: SavedImagesView = { rigId: 'seestar', rigName: 'Seestar review rig', images: [] }

        return { status: 200, json: view }
      }
    }

    // Rig telemetry is deliberately independent from retained collection/detail availability.
    if (method === 'GET' && pathname === '/api/web/rigs/fra400')
      return name === 'photographs-collection-failed'
        ? { status: 503, json: { error: 'Review rig telemetry unavailable' } }
        : { status: 200, json: rig }

    if (method === 'GET' && pathname === collectionPath) {
      if (collectionFailed) return { status: 503, json: { error: 'Review collection unavailable' } }
      const view: SavedImagesView = { rigId: rig.id, rigName: rig.name, images: structuredClone(images) }

      return { status: 200, json: view }
    }

    const requestedImage = images.find(image => pathname === `${collectionPath}/${encodeURIComponent(image.id)}`)

    if (method === 'GET' && pathname.startsWith(`${collectionPath}/`)) {
      const id = requestedImage?.id ?? pathname.slice(collectionPath.length + 1)
      detailReads.push(id)

      if (!requestedImage) return { status: 404, json: { error: 'Review selected image not found' } }
      const failure = detailFailures.get(id)

      if (failure) return { status: failure, json: { error: 'Review selected detail unavailable' } }

      const image = requestedImage.previewRendering?.status === 'legacy'
        ? withRendering(requestedImage, 'current')
        : structuredClone(requestedImage)

      if (image.previewRendering?.status === 'current') publishedCurrent.add(id)
      images = images.map(item => item.id === id ? image : item)
      const view: SavedImageView = { rigId: rig.id, rigName: rig.name, image }
      const delayMs = detailDelays.get(id)

      return delayMs ? { status: 200, json: view, delayMs } : { status: 200, json: view }
    }

    for (const image of images) {
      const base = `${artifactPath}/${encodeURIComponent(image.id)}`

      if (method === 'GET' && pathname === image.fitsUrl) {
        fileReads.push(pathname)

        return { status: 200, resource: 'photographs-fits' }
      }

      const prefixes = publishedCurrent.has(image.id) ? [base, `${base}/previews/background-v1`] : [base]

      for (const prefix of prefixes) {
        const kind = pathname === `${prefix}/fit` ? 'fit'
          : pathname === `${prefix}/preview` || pathname === `${prefix}/download-preview` ? 'native'
            : null

        if (method !== 'GET' || !kind) continue
        fileReads.push(pathname)
        const failure = previewFailures.get(`${image.id}:${kind}`)

        return failure
          ? { status: failure, json: { error: 'Review display preview unavailable; original FITS retained' } }
          : { status: 200, resource: 'crescent' }
      }
    }

    unknownRequests.push(`${method} ${pathname}`)

    return { status: 404, json: { error: `No Photographs fixture for ${method} ${pathname}` } }
  }

  return {
    name, time: photographsTime, timezone: reviewTimezone, image: referenceImage,
    appearance: name === 'photographs-dark' ? 'dark' : 'light',
    route: direct && selectedId ? `${photographsBase}/${selectedId}` : photographsBase,
    selectedId, detailReads, fileReads, unknownRequests, respond,
    images: () => structuredClone(images),
    setCollectionFailure: (failed: boolean) => { collectionFailed = failed },
    setDetailDelay: (id: string, milliseconds: number) => {
      if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 60_000)
        throw new RangeError('Review detail delay must be from 0 through 60000 milliseconds')
      detailDelays.set(id, milliseconds)
    },
    setDetailFailure: (id: string, status: number | null) => {
      if (status === null) detailFailures.delete(id)
      else detailFailures.set(id, status)
    },
    setPreviewFailure: (id: string, kind: PreviewKind, status: number | null) => {
      if (status === null) previewFailures.delete(`${id}:${kind}`)
      else previewFailures.set(`${id}:${kind}`, status)
    },
    setRendering: (id: string, rendering: Rendering) => {
      images = images.map(image => image.id === id ? withRendering(image, rendering) : image)

      if (rendering === 'current') publishedCurrent.add(id)
    },
  }
}
