import type { DeviceKind } from '@vela/model/device'
import type { RigDeviceConnectionSummary, RigView } from '@vela/model/rig'
import type { HomeView, RigDetailView, RigDeviceDetailView } from '@vela/model/web'

const deviceKinds = new Set<string>([
  'camera',
  'cover-calibrator',
  'dome',
  'filter-wheel',
  'focuser',
  'observing-conditions',
  'rotator',
  'safety-monitor',
  'switch',
  'telescope',
  'unknown',
] satisfies ReadonlyArray<DeviceKind>)

const supportedDeviceKinds = new Set<DeviceKind>([
  'camera',
  'telescope',
  'focuser',
  'filter-wheel',
  'observing-conditions',
  'switch',
])

export function isHomeView(value: unknown): value is HomeView {
  return isRecord(value)
    && Array.isArray(value.rigs)
    && value.rigs.every(isRigView)
    && hasUniqueValues(value.rigs.map((rig) => rig.id))
    && isIsoDateTime(value.refreshedAt)
}

export function isRigDetailView(value: unknown): value is RigDetailView {
  return isRecord(value)
    && isCanonicalNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && isOneOf(value.state, ['reachable', 'offline', 'needs-attention'])
    && isEndpoint(value.endpoint)
    && isIsoDateTime(value.addedAt)
    && isIsoDateTime(value.lastInventoryAt)
    && isIsoDateTime(value.refreshedAt)
    && isConnectionSummary(value.connections)
    && Array.isArray(value.devices)
    && value.devices.every(isRigDetailDevice)
    && hasUniqueValues(value.devices.map((device) => device.id))
    && isCapabilities(value.capabilities)
    && connectionsMatchDevices(value.connections, value.devices)
    && (value.state !== 'offline' || allConnectionsUnavailable(value.connections))
}

function connectionsMatchDevices(
  summary: RigDeviceConnectionSummary,
  devices: ReadonlyArray<RigDeviceDetailView>,
): boolean {
  const connected = devices.filter((device) => device.connection === 'connected').length
  const disconnected = devices.filter((device) => device.connection === 'disconnected').length
  const unavailable = devices.filter((device) => device.connection === 'unavailable').length

  return summary.total === devices.length
    && summary.connected === connected
    && summary.disconnected === disconnected
    && summary.unavailable === unavailable
}

function isRigView(value: unknown): value is RigView {
  return isRecord(value)
    && isCanonicalNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && isOneOf(value.reachability, ['reachable', 'unreachable', 'unknown'])
    && (value.lastSeenAt === undefined || isIsoDateTime(value.lastSeenAt))
    && isConnectionSummary(value.connections)
    && isCapabilities(value.capabilities)
    && (value.reachability === 'reachable' || allConnectionsUnavailable(value.connections))
}

function isRigDetailDevice(value: unknown): value is RigDeviceDetailView {
  if (
    !isRecord(value)
    || !isCanonicalNonEmptyString(value.id)
    || !isNonEmptyString(value.name)
    || !isNonEmptyString(value.configuredName)
    || typeof value.kind !== 'string'
    || !deviceKinds.has(value.kind)
    || !isRecord(value.status)
  ) return false

  if (value.connection === 'disconnected') {
    return isIsoDateTime(value.observedAt)
      && value.status.availability === 'unavailable'
  }

  if (value.connection === 'unavailable') {
    return (value.observedAt === undefined || isIsoDateTime(value.observedAt))
      && value.status.availability === 'unavailable'
  }

  if (value.connection !== 'connected' || !isIsoDateTime(value.observedAt)) return false

  if (value.status.availability === 'unsupported') return true

  if (!supportedDeviceKinds.has(value.kind as DeviceKind)) return false

  if (!isOneOf(value.status.availability, ['complete', 'partial'])) return false

  switch (value.kind) {
    case 'camera':
      return isCameraStatus(value.status)
    case 'telescope':
      return isTelescopeStatus(value.status)
    case 'focuser':
      return isFocuserStatus(value.status)
    case 'filter-wheel':
      return isFilterWheelStatus(value.status)
    case 'observing-conditions':
      return isConditionsStatus(value.status)
    case 'switch':
      return isSwitchStatus(value.status)
    default:
      return false
  }
}

function isCameraStatus(status: Record<string, unknown>): boolean {
  return isOneOf(status.activity, [
    'idle',
    'waiting',
    'exposing',
    'reading',
    'downloading',
    'error',
    'unknown',
  ])
    && isOptionalFinite(status.sensorTemperatureC)
    && (status.cooling === undefined || (
      isRecord(status.cooling)
      && isOneOf(status.cooling.state, ['on', 'off'])
      && isOptionalPercentage(status.cooling.powerPercent)
    ))
}

function isTelescopeStatus(status: Record<string, unknown>): boolean {
  return isOneOf(status.activity, ['idle', 'tracking', 'slewing', 'parked', 'unknown'])
    && isOneOf(status.tracking, ['on', 'off', 'unknown'])
    && isOneOf(status.parking, ['parked', 'unparked', 'unknown'])
    && isOneOf(status.home, ['at-home', 'away', 'unknown'])
}

function isFocuserStatus(status: Record<string, unknown>): boolean {
  return isOneOf(status.activity, ['idle', 'moving', 'unknown'])
    && (status.position === undefined
      || (Number.isInteger(status.position) && Number(status.position) >= 0))
    && isOptionalFinite(status.temperatureC)
}

function isFilterWheelStatus(status: Record<string, unknown>): boolean {
  return isOneOf(status.activity, ['idle', 'moving', 'unknown'])
    && (status.position === undefined
      || (Number.isInteger(status.position) && Number(status.position) >= -1))
    && (status.filterName === undefined || isNonEmptyString(status.filterName))
}

function isConditionsStatus(status: Record<string, unknown>): boolean {
  return isOneOf(status.activity, ['reporting', 'unknown'])
    && isOptionalFinite(status.temperatureC)
    && isOptionalPercentage(status.humidityPercent)
    && isOptionalFinite(status.dewPointC)
}

function isSwitchStatus(status: Record<string, unknown>): boolean {
  return isOneOf(status.activity, ['reporting', 'unknown'])
    && (status.channels === undefined || (
      Array.isArray(status.channels)
      && status.channels.every((channel) =>
        isRecord(channel)
          && Number.isInteger(channel.id)
          && Number(channel.id) >= 0
          && isNonEmptyString(channel.name)
          && (channel.on === undefined || typeof channel.on === 'boolean')
          && isOptionalFinite(channel.value))
      && hasUniqueValues(status.channels.map((channel) => channel.id))
    ))
}

function isEndpoint(value: unknown): boolean {
  return isRecord(value)
    && isCanonicalNonEmptyString(value.host)
    && Number.isInteger(value.port)
    && Number(value.port) >= 1
    && Number(value.port) <= 65535
}

function isConnectionSummary(value: unknown): value is RigDeviceConnectionSummary {
  if (!isRecord(value)) return false
  const counts = [value.total, value.connected, value.disconnected, value.unavailable]

  return counts.every((count) => Number.isInteger(count) && Number(count) >= 0)
    && value.total === Number(value.connected) + Number(value.disconnected) + Number(value.unavailable)
}

function allConnectionsUnavailable(summary: RigDeviceConnectionSummary): boolean {
  return summary.connected === 0
    && summary.disconnected === 0
    && summary.unavailable === summary.total
}

function hasUniqueValues(values: ReadonlyArray<unknown>): boolean {
  return new Set(values).size === values.length
}

function isCapabilities(value: unknown): boolean {
  return Array.isArray(value) && value.every((capability) => capability === 'forget')
}

function isOptionalFinite(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isOptionalPercentage(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const date = new Date(value)

  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

function isCanonicalNonEmptyString(value: unknown): value is string {
  return isNonEmptyString(value) && value === value.trim()
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isOneOf<const Value extends string>(
  value: unknown,
  options: ReadonlyArray<Value>,
): value is Value {
  return typeof value === 'string' && options.includes(value as Value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
