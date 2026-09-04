import type { ConnectRigDevicesResult, RigObservationView } from '@vela/model/web'
import { isRigDetailView } from '../../lib/view-validation'

export function isRigObservationView(value: unknown): value is RigObservationView {
  if (!record(value) || !isRigDetailView(value.rig) || !record(value.connectionPreparation)) return false
  const { state, capabilities } = value.connectionPreparation
  if (!Array.isArray(capabilities)) return false
  return state === 'available'
    ? capabilities.length === 1 && capabilities[0] === 'connect-devices' && value.rig.state !== 'offline'
    : ['complete', 'in-progress', 'unavailable'].includes(String(state)) && capabilities.length === 0
      && (value.rig.state !== 'offline' || state !== 'complete')
}

export function isConnectRigDevicesResult(value: unknown): value is ConnectRigDevicesResult {
  if (!record(value) || !isRigObservationView(value.view)) return false
  if (value.outcome === 'unavailable') {
    return ['device-state-unavailable', 'identity-conflict', 'offline'].includes(String(value.reason))
  }
  const { confirmedConnected, notAttempted } = value
  if (!devices(confirmedConnected)) return false
  if (value.outcome === 'complete') {
    return value.command === 'not-needed' ? confirmedConnected.length === 0
      : value.command === 'completed' && confirmedConnected.length > 0
  }
  if (!devices(notAttempted)) return false
  const confirmedIds = confirmedConnected.map((item) => item.id)
  const remainingIds = notAttempted.map((item) => item.id)
  if (remainingIds.some((id) => confirmedIds.includes(id))) return false

  if (value.outcome === 'uncertain') {
    return !('failed' in value) && !('stoppedAfter' in value)
      && device(value.uncertain)
      && ['cancelled', 'verification-timeout', 'verification-unavailable', 'write-outcome-unknown'].includes(String(value.uncertain.reason))
      && ![...confirmedIds, ...remainingIds].includes(value.uncertain.id)
  }
  if (value.outcome !== 'failed' && value.outcome !== 'partial') return false
  if ('uncertain' in value) return false
  if ((value.outcome === 'failed') !== (confirmedConnected.length === 0)) return false
  if (device(value.failed)) {
    return !('stoppedAfter' in value)
      && ['connection-check-failed', 'device-not-found', 'rejected', 'remained-disconnected'].includes(String(value.failed.reason))
      && ![...confirmedIds, ...remainingIds].includes(value.failed.id)
  }
  return value.outcome === 'partial' && !('failed' in value)
    && device(value.stoppedAfter) && confirmedIds.includes(value.stoppedAfter.id)
    && notAttempted.length > 0
}

function devices(value: unknown): value is Array<Record<string, unknown> & { id: string }> {
  return Array.isArray(value) && value.every(device)
    && new Set(value.map((item) => item.id)).size === value.length
}

function device(value: unknown): value is Record<string, unknown> & { id: string } {
  return record(value) && text(value.id) && text(value.name)
    && ['camera', 'cover-calibrator', 'dome', 'filter-wheel', 'focuser', 'observing-conditions',
      'rotator', 'safety-monitor', 'switch', 'telescope', 'unknown'].includes(String(value.kind))
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim()
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
