import type { NavigationView } from '@vela/model/web'

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function isNavigationView(value: unknown): value is NavigationView {
  if (!record(value) || !Array.isArray(value.rigs) || !Array.isArray(value.captures)) return false
  const rigs = value.rigs
  if (!rigs.every(rig => record(rig) && text(rig.id) && text(rig.name))) return false
  if (new Set(rigs.map(rig => rig.id)).size !== rigs.length) return false
  if (new Set(value.captures.map(capture => record(capture) ? capture.rigId : null)).size !== value.captures.length) return false
  return value.captures.every(capture => {
    if (!record(capture) || !rigs.some((rig: { id: string; name: string }) => rig.id === capture.rigId && rig.name === capture.rigName)) return false
    if (!['idle', 'exposing', 'reading', 'saving', 'stopping', 'complete', 'stopped', 'failed'].includes(String(capture.phase))) return false
    if (capture.active !== ['exposing', 'reading', 'saving', 'stopping'].includes(String(capture.phase))) return false
    return Number.isSafeInteger(capture.completedCount) && Number(capture.completedCount) >= 0
      && finite(capture.elapsedSeconds) && capture.elapsedSeconds >= 0
      && finite(capture.exposureSeconds) && capture.exposureSeconds >= (capture.active ? .1 : 0) && capture.exposureSeconds <= 600
      && (capture.error === null || text(capture.error))
  })
}
