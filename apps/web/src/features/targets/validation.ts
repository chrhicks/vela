import type { FramingView, TargetPosition, TargetSkyPath, TargetView, TargetsView } from '@vela/model/web'

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const optionalText = (v: unknown) => v === null || typeof v === 'string'
export function isPosition(v: unknown): v is TargetPosition {
  return record(v) && finite(v.raDegrees) && v.raDegrees >= 0 && v.raDegrees < 360 && finite(v.decDegrees) && Math.abs(v.decDegrees) <= 90
}
function isHorizontal(v: unknown): boolean {
  return record(v) && finite(v.azimuthDegrees) && v.azimuthDegrees >= 0 && v.azimuthDegrees < 360
    && finite(v.altitudeDegrees) && Math.abs(v.altitudeDegrees) <= 90
}
function isMoon(v: unknown): boolean {
  return record(v) && isHorizontal(v) && finite(v.illuminationFraction) && v.illuminationFraction >= 0 && v.illuminationFraction <= 1 && typeof v.waxing === 'boolean'
}
function isSky(v: unknown): v is TargetSkyPath {
  if (!record(v) || !date(v.observedAt) || !date(v.startsAt) || !date(v.endsAt)
    || !finite(v.currentAltitudeDegrees) || !finite(v.highestAltitudeDegrees)
    || !Array.isArray(v.samples) || v.samples.length < 2) return false
  const start = Date.parse(v.startsAt)
  const duration = Date.parse(v.endsAt) - start
  const interval = duration / (v.samples.length - 1)
  if (duration <= 0) return false
  return v.samples.every((sample, index) => record(sample) && date(sample.at)
    && isHorizontal(sample) && isMoon(sample.moon) && finite(sample.sunAltitudeDegrees)
    && Math.abs(Date.parse(sample.at) - (start + index * interval)) < 1)
    && Array.isArray(v.aboveHorizonDuringDarkness)
    && v.aboveHorizonDuringDarkness.every(window => record(window) && date(window.startsAt) && date(window.endsAt))
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
