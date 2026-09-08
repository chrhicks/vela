import type { FramingView, TargetPosition, TargetSkyPath, TargetView, TargetsView } from '@vela/model/web'

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const optionalText = (v: unknown) => v === null || typeof v === 'string'
export function isPosition(v: unknown): v is TargetPosition {
  return record(v) && finite(v.raDegrees) && v.raDegrees >= 0 && v.raDegrees < 360 && finite(v.decDegrees) && Math.abs(v.decDegrees) <= 90
}
function isSky(v: unknown): v is TargetSkyPath {
  return record(v) && date(v.observedAt) && date(v.startsAt) && date(v.endsAt) && Date.parse(v.endsAt) > Date.parse(v.startsAt)
    && finite(v.currentAltitudeDegrees) && finite(v.highestAltitudeDegrees) && Array.isArray(v.samples) && v.samples.length > 1
    && v.samples.every(s => record(s) && date(s.at) && finite(s.altitudeDegrees) && Math.abs(s.altitudeDegrees) <= 90 && finite(s.sunAltitudeDegrees))
    && Array.isArray(v.aboveHorizonDuringDarkness) && v.aboveHorizonDuringDarkness.every(w => record(w) && date(w.startsAt) && date(w.endsAt))
}
export function isTarget(v: unknown): v is TargetView {
  return record(v) && isPosition(v) && ['id', 'name', 'catalog', 'kind'].every(k => typeof (v as unknown as Record<string, unknown>)[k] === 'string')
    && record(v) && (v.sizeArcminutes === null || finite(v.sizeArcminutes)) && typeof v.thumbnailUrl === 'string' && v.thumbnailUrl.startsWith('/api/') && (v.sky === null || isSky(v.sky))
}
export function isTargets(v: unknown, rigId: string): v is TargetsView {
  return record(v) && v.rigId === rigId && typeof v.rigName === 'string' && Array.isArray(v.targets) && v.targets.every(isTarget)
    && finite(v.total) && v.total >= 0 && optionalText(v.siteUnavailableReason)
    && (v.site === null || record(v.site) && finite(v.site.latitudeDegrees) && finite(v.site.longitudeDegrees))
}
export function isFramingView(v: unknown, rigId: string): v is FramingView {
  if (!record(v) || v.rigId !== rigId || typeof v.rigName !== 'string' || typeof v.enabled !== 'boolean' || typeof v.active !== 'boolean' || typeof v.canCenter !== 'boolean' || typeof v.checkCurrent !== 'boolean'
    || !date(v.observedAt) || !optionalText(v.error) || !optionalText(v.unavailableReason) || !optionalText(v.targetId) || !finite(v.exposureSeconds)
    || !['idle','slewing','exposing','solving','checked','stopping','stopped','failed'].includes(String(v.phase))) return false
  return (v.focalLengthMm === null || finite(v.focalLengthMm) && v.focalLengthMm > 0)
    && (v.desired === null || isPosition(v.desired))
    && (v.camera === null || record(v.camera) && typeof v.camera.name === 'string' && ['width','height','fieldWidthDegrees','fieldHeightDegrees'].every(k => finite((v.camera as Record<string, unknown>)[k]) && Number((v.camera as Record<string, unknown>)[k]) > 0))
    && (v.actual === null || record(v.actual) && isPosition(v.actual) && record(v.actual) && typeof v.actual.checkId === 'string' && v.actual.checkId.length > 0 && date(v.actual.capturedAt) && finite(v.actual.rotationDegrees) && finite(v.actual.offsetArcminutes) && Array.isArray(v.actual.corners) && v.actual.corners.length === 4 && v.actual.corners.every(isPosition))
}
