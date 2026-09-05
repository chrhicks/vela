import { useEffect, useRef, useState } from 'react'
import type { SimulatorState } from '../src/runtime'

export function useSimulator() {
  const [state, setState] = useState<SimulatorState>()
  const [available, setAvailable] = useState(false)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('Connecting to simulator…')
  const [observedAt, setObservedAt] = useState<number>()
  const generation = useRef(0)
  const writing = useRef(false)

  function accept(next: SimulatorState) {
    setState(next)
    setAvailable(true)
    setObservedAt(Date.now())
  }

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function observe() {
      const current = generation.current
      if (!writing.current) {
        try {
          const next = await request('/simulator/state', { signal: controller.signal })
          if (!stopped && current === generation.current) accept(next)
        } catch {
          if (!stopped && current === generation.current) setAvailable(false)
        }
      }
      if (!stopped) timer = setTimeout(observe, 1000)
    }
    void observe()
    return () => {
      stopped = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [])

  async function command(path: string, method: string, body: object, success: string) {
    if (writing.current) return
    generation.current++
    writing.current = true
    setPending(true)
    setNotice('Applying change…')
    try {
      accept(await request(path, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }))
      setNotice(success)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Change was not confirmed.')
      // Inspect once after an uncertain response. Never repeat the write.
      try { accept(await request('/simulator/state')) }
      catch { setAvailable(false) }
    } finally {
      writing.current = false
      setPending(false)
    }
  }
  return { state, available, pending, notice, observedAt, command }
}

async function request(path: string, init: RequestInit = {}): Promise<SimulatorState> {
  const response = await fetch(path, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) })
  if (!response.ok) {
    const error = await response.json().catch(() => undefined)
    throw new Error(typeof error?.error === 'string' ? error.error : 'Change was not confirmed. Check the current rig state.')
  }
  const value: unknown = await response.json()
  if (!isState(value)) throw new Error('Simulator returned an invalid state. Change was not confirmed.')
  return value
}

function isState(value: unknown): value is SimulatorState {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  return ['altitudeArcsec', 'azimuthArcsec', 'raAxisDegrees', 'raRateDegreesPerSecond',
    'rightAscensionHours', 'declinationDegrees'].every(key => typeof state[key] === 'number' && Number.isFinite(state[key]))
    && ['obscured', 'cameraConnected', 'telescopeConnected', 'imageReady', 'tracking'].every(key => typeof state[key] === 'boolean')
    && ['idle', 'exposing'].includes(String(state.cameraActivity))
}
