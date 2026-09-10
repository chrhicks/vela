import type { ConnectRigDevicesResult, RigObservationView } from '@vela/model/web'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { connectDevices, loadObservation } from './observation-api'

interface ObservationState {
  view?: RigObservationView
  result?: ConnectRigDevicesResult
  refreshing: boolean
  connecting: boolean
  interrupted: boolean
  commandUnconfirmed: boolean
  error?: 'not-found' | 'unavailable'
  completedCommands: number
}

const initialState: ObservationState = {
  refreshing: false,
  connecting: false,
  interrupted: false,
  commandUnconfirmed: false,
  completedCommands: 0,
}

// Each mounted observation page owns one request at a time. A read can never
// overwrite a newer command result, and an unmounted page cannot publish state.
export function useObservation(rigId: string) {
  const [state, setState] = useState(initialState)
  const request = useRef<AbortController | undefined>(undefined)

  const refresh = useCallback(async (explicit = false) => {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setState((current) => ({ ...current, refreshing: true }))

    try {
      const view = await loadObservation(rigId, controller.signal)

      if (controller.signal.aborted) return
      const reconciled = explicit && ['available', 'complete'].includes(view.connectionPreparation.state)
      setState((current) => ({
        ...current, view, interrupted: false, error: undefined,
        result: reconciled ? undefined : current.result,
        commandUnconfirmed: reconciled ? false : current.commandUnconfirmed,
      }))
    } catch (error) {
      if (controller.signal.aborted) return
      setState((current) => error instanceof ApiError && error.status === 404
        ? { ...initialState, error: 'not-found' }
        : { ...current, interrupted: current.view !== undefined, error: 'unavailable' })
    } finally {
      if (request.current === controller) {
        request.current = undefined
        setState((current) => ({ ...current, refreshing: false }))
      }
    }
  }, [rigId])

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0)

    return () => {
      clearTimeout(timer)
      request.current?.abort()
      request.current = undefined
    }
  }, [refresh])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    if (!state.refreshing && !state.connecting && state.error !== 'not-found' && document.visibilityState === 'visible') {
      timer = setTimeout(() => void refresh(), 5_000)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
      else clearTimeout(timer)
    }

    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh, state.refreshing, state.connecting, state.error])

  const canConnect = state.view?.connectionPreparation.capabilities.some((capability) => capability === 'connect-devices') === true
    && !state.interrupted && !state.commandUnconfirmed && state.result?.outcome !== 'uncertain'
    && !state.refreshing && !state.connecting

  async function connect() {
    if (!canConnect || request.current) return
    const controller = new AbortController()
    request.current = controller
    setState((current) => ({ ...current, connecting: true, result: undefined, commandUnconfirmed: false }))
    let reconcile = false

    try {
      const result = await connectDevices(rigId, controller.signal)

      if (controller.signal.aborted) return
      setState((current) => ({ ...current, result, view: result.view, interrupted: false, error: undefined }))
    } catch (error) {
      if (controller.signal.aborted) return

      if (error instanceof ApiError && error.status === 404) {
        setState({ ...initialState, error: 'not-found' })
      } else {
        // A missing/invalid response says nothing about whether the write landed.
        // Reconcile with a read; never replay the command.
        setState((current) => ({ ...current, commandUnconfirmed: true, interrupted: true }))
        reconcile = true
      }
    } finally {
      if (request.current === controller) {
        request.current = undefined
        setState((current) => ({ ...current, connecting: false, completedCommands: current.completedCommands + 1 }))

        if (reconcile) void refresh()
      }
    }
  }

  return { ...state, canConnect, connect, refresh: () => refresh(true) }
}
