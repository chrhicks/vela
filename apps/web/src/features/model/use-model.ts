import type { RigModelView } from '@vela/model/web'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { api } from '../../lib/api'

const position = z.object({ raDegrees: z.number(), decDegrees: z.number() })

const fix = z.object({
  imageId: z.string(),
  at: z.number(),
  solvedJ2000: position,
  reportedJ2000: position,
  errorArcmin: z.object({ east: z.number(), north: z.number(), total: z.number() }),
  timeTrust: z.enum(['camera', 'server-estimate']),
})

const snapshot = z.object({
  observedAt: z.number().nullable(),
  position: z.object({
    state: z.enum(['known', 'uncertain', 'unknown', 'moving']),
    since: z.number(),
    reason: z.string(),
  }),
  lastFix: fix.nullable(),
  fixes: z.array(fix).max(30),
  fixCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
})

const modelView = z.object({
  rigId: z.string(),
  checkedAt: z.number(),
  local: snapshot.nullable(),
  shadow: z.object({
    state: z.enum(['available', 'unavailable']),
    checkpointAt: z.number().nullable(),
    snapshot: snapshot.nullable(),
  }),
})

type Reading =
  | { state: 'loading' }
  | { state: 'current' | 'interrupted'; view: RigModelView }
  | { state: 'unavailable' }

export function useModel(rigId: string) {
  const [reading, setReading] = useState<Reading>({ state: 'loading' })

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined

    async function poll() {
      if (!active || document.hidden || request) return
      const controller = new AbortController()
      request = controller

      try {
        const value = modelView.parse(await api(`web/rigs/${encodeURIComponent(rigId)}/model`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]),
        }))

        if (value.rigId !== rigId) throw new Error('Wrong rig')

        if (active && !controller.signal.aborted) setReading({ state: 'current', view: value })
      } catch {
        if (active && !controller.signal.aborted) {
          setReading(previous => 'view' in previous
            ? { state: 'interrupted', view: previous.view }
            : { state: 'unavailable' })
        }
      } finally {
        if (request === controller) request = undefined

        if (active && !document.hidden) timer = setTimeout(() => void poll(), 5000)
      }
    }

    function visibility() {
      clearTimeout(timer)

      if (document.hidden) {
        request?.abort()
        setReading(previous => 'view' in previous ? { state: 'interrupted', view: previous.view } : previous)
      } else if (!request) {
        timer = setTimeout(() => void poll(), 5000)
      }
    }

    document.addEventListener('visibilitychange', visibility)
    void poll()

    return () => {
      active = false
      clearTimeout(timer)
      request?.abort()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [rigId])

  return reading
}
