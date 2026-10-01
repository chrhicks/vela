import type { SavedImageView, SavedImagesView } from '@vela/model/web'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { isSavedImageView, isSavedImagesView } from '../capture/validation'

/** Collection reads never prepare previews or depend on a connected camera. */
export function useSavedImages(rigId: string) {
  const [view, setView] = useState<SavedImagesView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    async function load() {
      try {
        const result = await api(`web/rigs/${encodeURIComponent(rigId)}/saved-images`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        })

        if (!isSavedImagesView(result, rigId)) throw new Error('Invalid saved images')

        if (!controller.signal.aborted) setView(result)
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof ApiError && cause.status === 404
            ? 'This rig could not be found.'
            : 'Photographs could not be loaded. Check that the Vela server is reachable, then try again.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => controller.abort()
  }, [rigId, attempt])

  const refresh = useCallback(() => setAttempt(value => value + 1), [])

  return { view: view?.rigId === rigId ? view : null, loading, error, refresh }
}

/** An explicit selection remains authoritative, independently of collection reads. */
export function useSavedImage(rigId: string, imageId: string | undefined) {
  const [result, setResult] = useState<{
    rigId: string
    imageId: string
    view: SavedImageView | null
    loading: boolean
    error: string | null
  } | null>(null)

  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!imageId) return

    const selectedId = imageId
    const controller = new AbortController()
    const selection = { rigId, imageId: selectedId }
    setResult({ ...selection, view: null, loading: true, error: null })

    async function load() {
      try {
        const view = await api(
          `web/rigs/${encodeURIComponent(rigId)}/saved-images/${encodeURIComponent(selectedId)}`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) },
        )

        if (!isSavedImageView(view, rigId) || view.image.id !== selectedId)
          throw new Error('Invalid saved image')

        if (!controller.signal.aborted)
          setResult({ ...selection, view, loading: false, error: null })
      } catch (cause) {
        if (!controller.signal.aborted)
          setResult({
            ...selection,
            view: null,
            loading: false,
            error: cause instanceof ApiError && cause.status === 404
              ? 'This saved image or rig could not be found.'
              : 'The selected photograph could not be loaded. Check that the Vela server is reachable, then try again.',
          })
      }
    }

    void load()

    return () => controller.abort()
  }, [rigId, imageId, attempt])

  const current = result?.rigId === rigId && result.imageId === imageId ? result : null
  const refresh = useCallback(() => setAttempt(value => value + 1), [])

  return {
    view: current?.view ?? null,
    loading: Boolean(imageId) && (current?.loading ?? true),
    error: current?.error ?? null,
    refresh,
  }
}
