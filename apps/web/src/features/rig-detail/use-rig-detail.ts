import type { RigDetailView } from '@vela/model/web'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { loadRigDetail } from './load-rig-detail'

const refreshIntervalMs = 5_000

type InitialError = 'not-found' | 'unavailable'

interface RigDetailState {
  readonly view?: RigDetailView
  readonly refreshing: boolean
  readonly interrupted: boolean
  readonly initialError?: InitialError
}

export interface RigDetailResult extends RigDetailState {
  refresh(): Promise<void>
}

const initialState: RigDetailState = {
  refreshing: false,
  interrupted: false,
}

export function useRigDetail(rigId: string): RigDetailResult {
  const [state, setState] = useState<RigDetailState>(initialState)
  const inFlight = useRef(false)
  const controller = useRef<AbortController | undefined>(undefined)
  const requestGeneration = useRef(0)

  const refresh = useCallback(async () => {
    if (inFlight.current) return

    inFlight.current = true
    const generation = ++requestGeneration.current
    const nextController = new AbortController()
    controller.current = nextController
    setState((current) => ({ ...current, refreshing: true }))

    try {
      const view = await loadRigDetail(rigId, nextController.signal)

      if (requestGeneration.current !== generation) return
      setState({ view, refreshing: true, interrupted: false })
    } catch (error) {
      if (nextController.signal.aborted || requestGeneration.current !== generation) return

      if (error instanceof ApiError && error.status === 404) {
        setState({ refreshing: true, interrupted: false, initialError: 'not-found' })

        return
      }

      setState((current) =>
        current.view === undefined
          ? { refreshing: true, interrupted: false, initialError: 'unavailable' }
          : { ...current, refreshing: true, interrupted: true },
      )
    } finally {
      if (requestGeneration.current === generation) {
        inFlight.current = false
        controller.current = undefined
        setState((current) => ({ ...current, refreshing: false }))
      }
    }
  }, [rigId])

  useEffect(() => {
    requestGeneration.current += 1
    inFlight.current = false
    controller.current?.abort()
    controller.current = undefined
    setState(initialState)
    const initialRefresh = setTimeout(() => void refresh(), 0)

    return () => {
      clearTimeout(initialRefresh)
      requestGeneration.current += 1
      inFlight.current = false
      controller.current?.abort()
      controller.current = undefined
    }
  }, [refresh])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }

    const schedule = () => {
      clearTimer()

      if (!state.refreshing && document.visibilityState === 'visible') {
        timer = setTimeout(() => void refresh(), refreshIntervalMs)
      }
    }

    const visibilityChanged = () => {
      if (document.visibilityState === 'visible') void refresh()
      else clearTimer()
    }

    document.addEventListener('visibilitychange', visibilityChanged)
    schedule()

    return () => {
      clearTimer()
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [refresh, state.refreshing])

  return { ...state, refresh }
}
