import type { RigDeviceDetailView, RigSwitchChannelView } from '@vela/model/web'
import { IconButton } from '@vela/ui'
import { useId, useState } from 'react'
import { DeviceIcon } from './DeviceIcon'

interface Metric {
  readonly label: string
  readonly value: string
  readonly tone?: 'normal' | 'muted' | 'warning'
}

interface DevicePresentation {
  readonly activity: string
  readonly note: string
  readonly metrics: ReadonlyArray<Metric>
  readonly channels?: ReadonlyArray<RigSwitchChannelView>
}

const kindLabels = {
  camera: 'Camera',
  'cover-calibrator': 'Cover calibrator',
  dome: 'Dome',
  'filter-wheel': 'Filter wheel',
  focuser: 'Focuser',
  'observing-conditions': 'Observing conditions',
  rotator: 'Rotator',
  'safety-monitor': 'Safety monitor',
  switch: 'Switch',
  telescope: 'Telescope',
  unknown: 'Device',
} as const

export function RigDeviceRow({ device, stale, imagingCamera = false }: {
  readonly device: RigDeviceDetailView
  readonly stale: boolean
  readonly imagingCamera?: boolean
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const connection = connectionPresentation(device, stale)
  const presentation = devicePresentation(device)
  let role: string = kindLabels[device.kind]

  if (device.kind === 'camera') role = imagingCamera ? 'Camera · Main camera' : 'Other camera · Not used for imaging'
  else if (device.kind === 'telescope') role = 'Mount'

  let summary = device.connection === 'connected'
    ? presentation.metrics.slice(0, 2).map(metric => `${metric.label === 'Sensor' ? '' : `${metric.label} `}${metric.value}`).join(' · ') || presentation.activity
    : 'No current readings'

  if (device.connection === 'connected') {
    role += ` · ${presentation.activity}`

    if (device.kind === 'telescope' && device.status.availability !== 'unsupported') {
      if (device.status.parking !== 'unknown') role += device.status.parking === 'parked' ? ' · Parked' : ' · Not parked'
      summary = presentation.activity
    } else if (device.kind === 'focuser' && device.status.availability !== 'unsupported' && device.status.position !== undefined) {
      role = `Focuser · Position ${formatInteger(device.status.position)}`
      summary = presentation.activity
    }
  }

  const detailsAvailable = presentation.metrics.length > 0 || !!presentation.channels?.length

  return (
    <section className="equipment__device" aria-label={device.name} data-connection={stale ? 'last-known' : device.connection}>
      <div className="equipment__row">
        <DeviceIcon kind={device.kind} />
        <div className="equipment__name">
          <h3>{device.name}</h3>
          <p>{role}</p>
        </div>
        <p className="equipment__summary">{summary}</p>
        <p className="equipment__connection" data-tone={connection.tone}>
          <span aria-hidden="true">{device.connection === 'connected' && !stale ? '●' : '○'} </span>{connection.label}
        </p>
        <IconButton
          tone="quiet"
          label={`${open ? 'Hide' : 'Show'} ${device.name} details`}
          aria-expanded={open}
          aria-controls={id}
          icon={<span aria-hidden="true">{open ? '⌃' : '⌄'}</span>}
          onClick={() => setOpen(value => !value)}
        />
      </div>
      <div id={id} hidden={!open} className="equipment__device-details">
        {stale && <p>Last known measurements; live updates are interrupted.</p>}
        <p>{presentation.note}</p>
        {device.configuredName !== device.name && <p>Configured as {device.configuredName}</p>}
        {presentation.metrics.length > 0 && (
          <dl>{presentation.metrics.map(metric => (
            <div data-tone={metric.tone ?? 'normal'} key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>
          ))}</dl>
        )}
        {!!presentation.channels?.length && (
          <dl>{presentation.channels.map(channel => (
            <div key={channel.id}>
              <dt>{channel.name}</dt>
              <dd>{channel.value === undefined ? 'Value unavailable' : formatNumber(channel.value)}{channel.on === undefined ? '' : ` · ${channel.on ? 'On' : 'Off'}`}</dd>
            </div>
          ))}</dl>
        )}
        {!detailsAvailable && <p>Detailed status is not available from this device.</p>}
      </div>
    </section>
  )
}

function connectionPresentation(device: RigDeviceDetailView, stale: boolean) {
  if (stale) return { label: 'Last known', tone: 'warning' as const }

  if (device.connection === 'connected') return { label: 'Connected', tone: 'positive' as const }

  if (device.connection === 'disconnected') {
    return { label: 'Disconnected', tone: 'warning' as const }
  }

  return { label: 'Unavailable', tone: 'danger' as const }
}

function devicePresentation(device: RigDeviceDetailView): DevicePresentation {
  if (device.connection !== 'connected') {
    return {
      activity: device.connection === 'disconnected' ? 'Disconnected' : 'Status unavailable',
      note:
        device.connection === 'disconnected'
          ? 'Live status requires a device connection'
          : 'No live information from this device',
      metrics: [],
    }
  }

  if (device.status.availability === 'unsupported') {
    return {
      activity: 'Limited status',
      note: 'Detailed status is not available',
      metrics: [],
    }
  }

  switch (device.kind) {
    case 'camera':
      return {
        activity: titleCase(device.status.activity),
        note:
          device.status.availability === 'partial'
            ? 'Some values could not be read'
            : cameraNote(device.status.activity),
        metrics: [
          optionalMetric('Sensor', device.status.sensorTemperatureC, formatTemperature),
          device.status.cooling === undefined
            ? undefined
            : {
                label: 'Cooler',
                value: device.status.cooling.state === 'on' ? 'On' : 'Off',
                tone:
                  device.status.cooling.state === 'off' ? ('muted' as const) : ('normal' as const),
              },
          optionalMetric('Power', device.status.cooling?.powerPercent, formatPercentage),
        ].filter(isMetric),
      }
    case 'telescope':
      return {
        activity: titleCase(device.status.activity),
        note:
          device.status.availability === 'partial'
            ? 'Some values could not be read'
            : telescopeNote(device.status.tracking, device.status.home),
        metrics: [
          stateMetric('Tracking', device.status.tracking, { on: 'On', off: 'Off' }),
          stateMetric('Parked', device.status.parking, { parked: 'Yes', unparked: 'No' }),
          stateMetric('Home', device.status.home, { 'at-home': 'At home', away: 'Away' }),
        ],
      }
    case 'focuser':
      return {
        activity: titleCase(device.status.activity),
        note:
          device.status.availability === 'partial'
            ? 'Some values could not be read'
            : device.status.position === undefined
              ? 'Position unavailable'
              : 'Absolute position',
        metrics: [
          optionalMetric('Position', device.status.position, formatInteger),
          optionalMetric('Temperature', device.status.temperatureC, formatTemperature),
        ].filter(isMetric),
      }
    case 'filter-wheel':
      return {
        activity: titleCase(device.status.activity),
        note:
          device.status.availability === 'partial'
            ? 'Some values could not be read'
            : device.status.filterName === undefined
              ? 'Selection unavailable'
              : 'Filter selected',
        metrics: [
          device.status.filterName === undefined
            ? optionalMetric(
                'Position',
                device.status.position !== undefined && device.status.position >= 0
                  ? device.status.position
                  : undefined,
                formatInteger,
              )
            : { label: 'Filter', value: device.status.filterName },
        ].filter(isMetric),
      }
    case 'observing-conditions':
      return {
        activity: titleCase(device.status.activity),
        note:
          device.status.availability === 'partial'
            ? 'Some values could not be read'
            : 'Environment at the Rig',
        metrics: [
          optionalMetric('Temperature', device.status.temperatureC, formatTemperature),
          optionalMetric('Humidity', device.status.humidityPercent, formatPercentage),
          optionalMetric('Dew point', device.status.dewPointC, formatTemperature),
        ].filter(isMetric),
      }
    case 'switch': {
      const presentation: DevicePresentation = {
        activity: titleCase(device.status.activity),
        note:
          device.status.availability === 'partial'
            ? 'Some channels could not be read'
            : 'Generic channel values',
        metrics: [],
      }

      if (device.status.channels === undefined) return presentation

      return { ...presentation, channels: device.status.channels }
    }

    default:
      return {
        activity: 'Limited status',
        note: 'Detailed status is not available',
        metrics: [],
      }
  }
}

function cameraNote(activity: string): string {
  switch (activity) {
    case 'idle':
      return 'Ready for an exposure'
    case 'waiting':
      return 'Waiting to begin'
    case 'exposing':
      return 'Exposure in progress'
    case 'reading':
      return 'Reading the sensor'
    case 'downloading':
      return 'Downloading the exposure'
    case 'error':
      return 'The camera reported an error'
    default:
      return 'Current activity unavailable'
  }
}

function telescopeNote(
  tracking: 'on' | 'off' | 'unknown',
  home: 'at-home' | 'away' | 'unknown',
): string {
  const trackingLabel = {
    on: 'Tracking',
    off: 'Not tracking',
    unknown: 'Tracking unknown',
  }[tracking]

  const homeLabel = {
    'at-home': 'At home',
    away: 'Away from home',
    unknown: 'Home unknown',
  }[home]

  return `${trackingLabel} · ${homeLabel}`
}

function stateMetric(
  label: string,
  state: string,
  labels: Readonly<Record<string, string>>,
): Metric {
  const value = labels[state] ?? 'Unknown'

  return {
    label,
    value,
    tone: state === 'unknown' || value === 'Off' || value === 'Away' ? 'muted' : 'normal',
  }
}

function optionalMetric(
  label: string,
  value: number | undefined,
  format: (value: number) => string,
): Metric | undefined {
  return value === undefined ? undefined : { label, value: format(value) }
}

function isMetric(value: Metric | undefined): value is Metric {
  return value !== undefined
}

function formatTemperature(value: number): string {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })} °C`
}

function formatPercentage(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function formatInteger(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

function titleCase(value: string): string {
  return value === 'unknown'
    ? 'Status unknown'
    : `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
