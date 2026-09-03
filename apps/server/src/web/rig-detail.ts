import type {
  AlpacaDeviceInspection,
  AlpacaDeviceTelemetry,
} from '@vela/alpaca'
import type { DeviceKind } from '@vela/model/device'
import type {
  RigCameraStatus,
  RigDeviceDetailView,
  RigFilterWheelStatus,
  RigFocuserStatus,
  RigObservingConditionsStatus,
  RigSwitchStatus,
  RigTelescopeStatus,
} from '@vela/model/web'
import type { ObservedDeviceRecord } from '../rig/contracts.js'

interface DeviceIdentity {
  readonly id: string
  readonly name: string
  readonly configuredName: string
}

interface ConnectedDeviceViewBase extends DeviceIdentity {
  readonly connection: 'connected'
  readonly observedAt: string
}

type UnavailableDeviceViewBase = DeviceIdentity & (
  | { readonly connection: 'disconnected'; readonly observedAt: string }
  | { readonly connection: 'unavailable'; readonly observedAt?: string }
)

export function currentDeviceView(
  rigId: string,
  inspection: AlpacaDeviceInspection,
  observedAt: string,
): RigDeviceDetailView {
  const identity = {
    id: `${rigId}-${inspection.providerDeviceId}`,
    name: inspection.name,
    configuredName: inspection.configuredName,
  }
  if (inspection.connection !== 'connected') {
    return unavailableDeviceForKind(inspection.kind, {
      ...identity,
      connection: inspection.connection,
      observedAt,
    })
  }

  const base = {
    ...identity,
    connection: 'connected',
    observedAt,
  } satisfies ConnectedDeviceViewBase
  if (
    !supportsRigDetail(inspection.kind)
    || inspection.telemetry.availability === 'unavailable'
  ) {
    return unsupportedDeviceForKind(inspection.kind, base)
  }

  const values = inspection.telemetry.values
  switch (inspection.kind) {
    case 'camera':
      return {
        ...base,
        kind: 'camera',
        status: cameraStatus(inspection.telemetry.availability, values),
      }
    case 'telescope':
      return {
        ...base,
        kind: 'telescope',
        status: telescopeStatus(inspection.telemetry.availability, values),
      }
    case 'focuser':
      return {
        ...base,
        kind: 'focuser',
        status: focuserStatus(inspection.telemetry.availability, values),
      }
    case 'filter-wheel':
      return {
        ...base,
        kind: 'filter-wheel',
        status: filterWheelStatus(inspection.telemetry.availability, values),
      }
    case 'observing-conditions':
      return {
        ...base,
        kind: 'observing-conditions',
        status: conditionsStatus(inspection.telemetry.availability, values),
      }
    case 'switch':
      return {
        ...base,
        kind: 'switch',
        status: switchStatus(inspection.telemetry.availability, values),
      }
    default:
      return { ...base, kind: inspection.kind, status: { availability: 'unsupported' } }
  }
}

function cameraStatus(
  availability: 'complete' | 'partial',
  telemetry: AlpacaDeviceTelemetry | undefined,
): RigCameraStatus | { readonly availability: 'unsupported' } {
  if (telemetry?.kind !== 'camera') {
    return availability === 'complete'
      ? { availability: 'unsupported' }
      : { availability: 'partial', activity: 'unknown' }
  }
  const usefulCooling = telemetry.cooling !== undefined
    && (telemetry.cooling.state === 'on'
      || telemetry.cooling.setpointControl === true
      || telemetry.cooling.powerReporting === true)
  return {
    availability,
    activity: telemetry.activity ?? 'unknown',
    ...(telemetry.sensorTemperatureC === undefined
      ? {}
      : { sensorTemperatureC: telemetry.sensorTemperatureC }),
    ...(!usefulCooling || telemetry.cooling === undefined
      ? {}
      : {
          cooling: {
            state: telemetry.cooling.state,
            ...(telemetry.cooling.powerPercent === undefined
              ? {}
              : { powerPercent: telemetry.cooling.powerPercent }),
          },
        }),
  }
}

function telescopeStatus(
  availability: 'complete' | 'partial',
  telemetry: AlpacaDeviceTelemetry | undefined,
): RigTelescopeStatus | { readonly availability: 'unsupported' } {
  if (telemetry?.kind !== 'telescope') {
    return availability === 'complete'
      ? { availability: 'unsupported' }
      : {
          availability: 'partial',
          activity: 'unknown',
          tracking: 'unknown',
          parking: 'unknown',
          home: 'unknown',
        }
  }
  return {
    availability,
    activity: telescopeActivity(telemetry),
    tracking: telemetry.tracking === undefined ? 'unknown' : telemetry.tracking ? 'on' : 'off',
    parking: telemetry.parked === undefined ? 'unknown' : telemetry.parked ? 'parked' : 'unparked',
    home: telemetry.atHome === undefined ? 'unknown' : telemetry.atHome ? 'at-home' : 'away',
  }
}

function telescopeActivity(
  telemetry: Extract<AlpacaDeviceTelemetry, { readonly kind: 'telescope' }>,
): RigTelescopeStatus['activity'] {
  if (telemetry.parked === true) return 'parked'
  if (telemetry.slewing === true) return 'slewing'
  if (telemetry.tracking === true) return 'tracking'
  if (
    telemetry.parked === false
    && telemetry.slewing === false
    && telemetry.tracking === false
  ) return 'idle'
  return 'unknown'
}

function focuserStatus(
  availability: 'complete' | 'partial',
  telemetry: AlpacaDeviceTelemetry | undefined,
): RigFocuserStatus | { readonly availability: 'unsupported' } {
  if (telemetry?.kind !== 'focuser') {
    return availability === 'complete'
      ? { availability: 'unsupported' }
      : { availability: 'partial', activity: 'unknown' }
  }
  return {
    availability,
    activity: telemetry.moving === undefined ? 'unknown' : telemetry.moving ? 'moving' : 'idle',
    ...(telemetry.position === undefined ? {} : { position: telemetry.position }),
    ...(telemetry.temperatureC === undefined ? {} : { temperatureC: telemetry.temperatureC }),
  }
}

function filterWheelStatus(
  availability: 'complete' | 'partial',
  telemetry: AlpacaDeviceTelemetry | undefined,
): RigFilterWheelStatus | { readonly availability: 'unsupported' } {
  if (telemetry?.kind !== 'filter-wheel') {
    return availability === 'complete'
      ? { availability: 'unsupported' }
      : { availability: 'partial', activity: 'unknown' }
  }
  return {
    availability,
    activity: telemetry.moving === undefined ? 'unknown' : telemetry.moving ? 'moving' : 'idle',
    ...(telemetry.position === undefined ? {} : { position: telemetry.position }),
    ...(telemetry.filterName === undefined ? {} : { filterName: telemetry.filterName }),
  }
}

function conditionsStatus(
  availability: 'complete' | 'partial',
  telemetry: AlpacaDeviceTelemetry | undefined,
): RigObservingConditionsStatus | { readonly availability: 'unsupported' } {
  if (telemetry?.kind !== 'observing-conditions') {
    return availability === 'complete'
      ? { availability: 'unsupported' }
      : { availability: 'partial', activity: 'unknown' }
  }
  const reporting = telemetry.temperatureC !== undefined
    || telemetry.humidityPercent !== undefined
    || telemetry.dewPointC !== undefined
  if (!reporting && availability === 'complete') return { availability: 'unsupported' }
  return {
    availability,
    activity: reporting ? 'reporting' : 'unknown',
    ...(telemetry.temperatureC === undefined ? {} : { temperatureC: telemetry.temperatureC }),
    ...(telemetry.humidityPercent === undefined
      ? {}
      : { humidityPercent: telemetry.humidityPercent }),
    ...(telemetry.dewPointC === undefined ? {} : { dewPointC: telemetry.dewPointC }),
  }
}

function switchStatus(
  availability: 'complete' | 'partial',
  telemetry: AlpacaDeviceTelemetry | undefined,
): RigSwitchStatus | { readonly availability: 'unsupported' } {
  if (telemetry?.kind !== 'switch') {
    return availability === 'complete'
      ? { availability: 'unsupported' }
      : { availability: 'partial', activity: 'unknown' }
  }
  if (telemetry.channels === undefined && availability === 'complete') {
    return { availability: 'unsupported' }
  }
  return {
    availability,
    activity: telemetry.channels === undefined ? 'unknown' : 'reporting',
    ...(telemetry.channels === undefined
      ? {}
      : {
          channels: telemetry.channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            ...(channel.on === undefined ? {} : { on: channel.on }),
            ...(channel.value === undefined ? {} : { value: channel.value }),
          })),
        }),
  }
}

function supportsRigDetail(kind: DeviceKind): boolean {
  return kind === 'camera'
    || kind === 'telescope'
    || kind === 'focuser'
    || kind === 'filter-wheel'
    || kind === 'observing-conditions'
    || kind === 'switch'
}

export function unavailableDeviceView(
  rigId: string,
  device: ObservedDeviceRecord,
): RigDeviceDetailView {
  return unavailableDeviceForKind(device.kind, {
    id: `${rigId}-${device.uniqueId}`,
    name: device.name,
    configuredName: device.name,
    connection: 'unavailable',
  })
}

function unavailableDeviceForKind(
  kind: DeviceKind,
  base: UnavailableDeviceViewBase,
): RigDeviceDetailView {
  const status = { availability: 'unavailable' } as const
  switch (kind) {
    case 'camera':
      return { ...base, kind, status }
    case 'telescope':
      return { ...base, kind, status }
    case 'focuser':
      return { ...base, kind, status }
    case 'filter-wheel':
      return { ...base, kind, status }
    case 'observing-conditions':
      return { ...base, kind, status }
    case 'switch':
      return { ...base, kind, status }
    default:
      return { ...base, kind, status }
  }
}

function unsupportedDeviceForKind(
  kind: DeviceKind,
  base: ConnectedDeviceViewBase,
): RigDeviceDetailView {
  const status = { availability: 'unsupported' } as const
  switch (kind) {
    case 'camera':
      return { ...base, kind, status }
    case 'telescope':
      return { ...base, kind, status }
    case 'focuser':
      return { ...base, kind, status }
    case 'filter-wheel':
      return { ...base, kind, status }
    case 'observing-conditions':
      return { ...base, kind, status }
    case 'switch':
      return { ...base, kind, status }
    default:
      return { ...base, kind, status }
  }
}
