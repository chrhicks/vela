import { z } from 'zod'
import { EquipmentError } from '@vela/equipment'
import type { CriaClient, CriaDevice, ObservedState } from '@vela/cria'

const frames = ['other', 'topocentric', 'j2000', 'j2050', 'b1950'] as const

const trackingRates = ['sidereal', 'lunar', 'solar', 'king'] as const

/** Validates the facts one capability actually needs, without promoting its neighbours. */
export class DeviceReadings {
  private incomplete = false
  private readonly measurements: number[] = []

  get partial() {
    return this.incomplete
  }

  constructor(
    readonly client: CriaClient,
    readonly snapshot: ObservedState,
    readonly device: CriaDevice,
  ) {}

  number(key: string, minimum: number, maximum: number, metadata = false): number {
    const parsed = z.number().finite().min(minimum).max(maximum).safeParse(
      this.client.reading(this.snapshot, this.device, key, { metadata }),
    )

    if (!parsed.success) throw this.invalid(key)

    this.recordMeasurement(key, metadata)

    return parsed.data
  }

  integer(key: string, minimum: number, maximum: number, metadata = false): number {
    const value = this.number(key, minimum, maximum, metadata)

    if (!Number.isInteger(value)) throw this.invalid(key)

    return value
  }

  boolean(key: string, metadata = false): boolean {
    const parsed = z.boolean().safeParse(
      this.client.reading(this.snapshot, this.device, key, { metadata }),
    )

    if (!parsed.success) throw this.invalid(key)
    this.recordMeasurement(key, metadata)

    return parsed.data
  }

  optionalNumber(key: string, minimum: number, maximum: number, metadata = false) {
    return this.optional(key, z.number().finite().min(minimum).max(maximum), metadata)
  }

  optionalInteger(key: string, minimum: number, maximum: number, metadata = false) {
    return this.optional(key, z.number().int().min(minimum).max(maximum), metadata)
  }

  optionalBoolean(key: string, metadata = false) {
    return this.optional(key, z.boolean(), metadata)
  }

  optionalString(key: string, metadata = false) {
    return this.optional(key, z.string(), metadata)
  }

  private optional<T>(key: string, schema: z.ZodType<T>, metadata: boolean): T | undefined {
    const parsed = schema.safeParse(
      this.client.optionalReading(this.snapshot, this.device, key, { metadata }),
    )

    if (!parsed.success) {
      if (this.device.fields[key]?.status !== 'unsupported') this.incomplete = true

      return undefined
    }

    this.recordMeasurement(key, metadata)

    return parsed.data
  }

  private recordMeasurement(key: string, metadata: boolean) {
    if (metadata) return
    const timestamp = this.device.fields[key]?.observedAt

    if (timestamp !== undefined && timestamp !== null) this.measurements.push(timestamp)
  }

  include(channel: DeviceReadings) {
    this.incomplete ||= channel.partial
    this.measurements.push(...channel.measurements)
  }

  coordinateSystem() {
    const value = this.optionalInteger('coordinateSystem', 0, 4, true)

    return value === undefined ? 'unknown' : frames[value] ?? 'unknown'
  }

  trackingRate() {
    const value = this.optionalInteger('trackingRate', 0, 3)

    return value === undefined ? undefined : trackingRates[value]
  }

  pierSide(): 'east' | 'west' | 'unknown' {
    const value = this.optionalInteger('pierSide', -1, 1)

    if (value === 0) return 'east'

    if (value === 1) return 'west'

    return 'unknown'
  }

  observedAt(keys?: ReadonlyArray<string>): string {
    const times = keys ? keys.map(key => this.device.fields[key]?.observedAt) : this.measurements
    const known = times.filter(time => time !== undefined && time !== null)

    if (known.length !== times.length || known.length === 0)
      throw this.invalid('measurement timestamp')

    return new Date(Math.min(...known)).toISOString()
  }

  private invalid(key: string) {
    return new EquipmentError(`Cria returned an invalid ${key} for ${this.device.expectedName}`, {
      reason: 'invalid-response',
      endpoint: 'Cria',
    })
  }
}
