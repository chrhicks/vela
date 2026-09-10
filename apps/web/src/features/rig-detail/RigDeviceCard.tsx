import type { RigDeviceDetailView, RigSwitchChannelView } from '@vela/model/web'
import { Badge, Panel } from '@vela/ui'
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

export function RigDeviceCard({
  device,
  stale,
}: {
  readonly device: RigDeviceDetailView
  readonly stale: boolean
}) {
  const connection = connectionPresentation(device, stale)
  const presentation = devicePresentation(device)

  const noDetails = presentation.metrics.length === 0
    && (presentation.channels === undefined || presentation.channels.length === 0)

  return (
    <Panel
      action={(
        <Badge marker={<i />} size="small" tone={connection.tone}>
          {connection.label}
        </Badge>
      )}
      className="vela-rig-device"
      data-connection={stale ? 'last-known' : device.connection}
      description={device.configuredName !== device.name
        ? `${kindLabels[device.kind]} · ${device.configuredName}`
        : kindLabels[device.kind]}
      elevation="raised"
      title={device.name}
    >
      <div className="vela-rig-device__state">
        <span className="vela-rig-device__icon"><DeviceIcon kind={device.kind} /></span>
        <p>
          <small>STATUS</small>
          <strong>{presentation.activity}</strong>
          <span>{presentation.note}</span>
        </p>
      </div>

      {presentation.metrics.length > 0 ? (
        <dl className="vela-rig-device__metrics">
          {presentation.metrics.map((metric) => (
            <div data-tone={metric.tone ?? 'normal'} key={metric.label}>
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {presentation.channels && presentation.channels.length > 0 ? (
        <div className="vela-rig-device__channels">
          {presentation.channels.map((channel) => (
            <span key={channel.id}>
              <small>{channel.name}</small>
              {channel.value === undefined ? null : <strong>{formatNumber(channel.value)}</strong>}
              {channel.on === undefined ? null : <em>{channel.on ? 'On' : 'Off'}</em>}
            </span>
          ))}
        </div>
      ) : null}

      {noDetails ? (
        <p className="vela-rig-device__empty">Detailed status is not available from this device.</p>
      ) : null}
    </Panel>
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
  if (device.status.availability === 'unavailable') {
    return {
      activity: device.connection === 'disconnected' ? 'Disconnected' : 'Status unavailable',
      note: device.connection === 'disconnected'
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
        note: device.status.availability === 'partial'
          ? 'Some values could not be read'
          : cameraNote(device.status.activity),
        metrics: [
          optionalMetric('Sensor', device.status.sensorTemperatureC, formatTemperature),
          device.status.cooling === undefined
            ? undefined
            : {
                label: 'Cooler',
                value: device.status.cooling.state === 'on' ? 'On' : 'Off',
                tone: device.status.cooling.state === 'off' ? 'muted' as const : 'normal' as const,
              },
          optionalMetric('Power', device.status.cooling?.powerPercent, formatPercentage),
        ].filter(isMetric),
      }
    case 'telescope':
      return {
        activity: titleCase(device.status.activity),
        note: device.status.availability === 'partial'
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
        note: device.status.availability === 'partial'
          ? 'Some values could not be read'
          : device.status.position === undefined ? 'Position unavailable' : 'Absolute position',
        metrics: [
          optionalMetric('Position', device.status.position, formatInteger),
          optionalMetric('Temperature', device.status.temperatureC, formatTemperature),
        ].filter(isMetric),
      }
    case 'filter-wheel':
      return {
        activity: titleCase(device.status.activity),
        note: device.status.availability === 'partial'
          ? 'Some values could not be read'
          : device.status.filterName === undefined ? 'Selection unavailable' : 'Filter selected',
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
        note: device.status.availability === 'partial'
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
        note: device.status.availability === 'partial'
          ? 'Some channels could not be read'
          : 'Generic channel values',
        metrics: [],
      }

      if (device.status.channels === undefined) return presentation

      return { ...presentation, channels: device.status.channels }
    }

    default:
      return { activity: 'Limited status', note: 'Detailed status is not available', metrics: [] }
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

function telescopeNote(tracking: 'on' | 'off' | 'unknown', home: 'at-home' | 'away' | 'unknown'): string {
  const trackingLabel = { on: 'Tracking', off: 'Not tracking', unknown: 'Tracking unknown' }[tracking]
  const homeLabel = { 'at-home': 'At home', away: 'Away from home', unknown: 'Home unknown' }[home]

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
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} °C`
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
  return value === 'unknown' ? 'Status unknown' : `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
