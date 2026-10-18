import { Exit, Schema } from 'effect'
import type { ReadingOf } from '@cria/primitives'
import { EquipmentError } from '@vela/equipment'
import type { Device } from '@cria/wire'

type Readings = Readonly<Record<string, ReadingOf<unknown> | undefined>>

type ValueSchema = Schema.Top & { readonly DecodingServices: never }

export class DeviceReadings {
  private incomplete = false
  private readonly measurements: number[] = []

  constructor(readonly device: Device, readonly readings: Readings = device.readings) {}

  get partial() { return this.incomplete }

  private required<S extends ValueSchema>(key: string, schema: S): S['Type'] {
    const reading = this.readings[key]

    if (reading?.status !== 'fresh')
      throw new EquipmentError(`Cria's ${this.device.name} has no fresh ${key}`, { reason: 'transport', endpoint: 'Cria' })
    const decoded = Schema.decodeUnknownExit(schema)(reading.value)

    if (Exit.isFailure(decoded)) throw this.invalid(key)
    this.measurements.push(reading.observedAt)

    return decoded.value
  }

  private optional<S extends ValueSchema>(key: string, schema: S): S['Type'] | undefined {
    const reading = this.readings[key]

    if (reading?.status === 'fresh') return this.required(key, schema)

    if (!(reading?.status === 'unavailable' && reading.reason === 'unsupported')) this.incomplete = true

    return undefined
  }

  number(key: string): number { return this.required(key, Schema.Number) }

  integer(key: string): number { return this.required(key, Schema.Int) }

  boolean(key: string): boolean { return this.required(key, Schema.Boolean) }

  optionalNumber(key: string) { return this.optional(key, Schema.Number) }

  supportedNumber(key: string) {
    const reading = this.readings[key]

    if (reading?.status === 'unavailable' && reading.reason === 'unsupported') return undefined

    return this.number(key)
  }

  /**
   * A tracking-rate offset the driver cannot set is zero while the mount tracks at the sidereal
   * rate. A stale or unreachable reading, or a non-sidereal rate, still fails.
   */
  trackingOffset(key: string, trackingRate: string) {
    const reading = this.readings[key]

    if (reading?.status === 'unavailable' && reading.reason === 'unsupported' && trackingRate === 'sidereal') return 0

    return this.number(key)
  }

  optionalInteger(key: string) { return this.optional(key, Schema.Int) }

  optionalBoolean(key: string) { return this.optional(key, Schema.Boolean) }

  optionalString(key: string) { return this.optional(key, Schema.String) }

  include(channel: DeviceReadings) {
    this.incomplete ||= channel.partial
    this.measurements.push(...channel.measurements)
  }

  coordinateSystem(required = false): 'topocentric' | 'j2000' | 'unknown' {
    const frame = Schema.Literals(['topocentric', 'j2000'])

    return required ? this.required('coordinateSystem', frame) : this.optional('coordinateSystem', frame) ?? 'unknown'
  }

  trackingRate() { return this.required('trackingRate', Schema.Literals(['sidereal', 'lunar', 'solar'])) }

  pierSide() {
    const reading = this.readings.pierSide

    if (reading?.status === 'unavailable' && reading.reason === 'unsupported') return 'unknown'

    return this.required('pierSide', Schema.Literals(['east', 'west', 'unknown']))
  }

  observedAt(keys?: ReadonlyArray<string>): string {
    const times = keys ? keys.flatMap(key => {
      const reading = this.readings[key]

      return reading?.status === 'fresh' ? [reading.observedAt] : []
    }) : this.measurements

    if (!times.length || keys && times.length !== keys.length) throw this.invalid('measurement timestamp')

    return new Date(Math.min(...times)).toISOString()
  }

  private invalid(key: string) {
    return new EquipmentError(`Cria returned an invalid ${key} for ${this.device.name}`, { reason: 'invalid-response', endpoint: 'Cria' })
  }
}
