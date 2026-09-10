import { describe, expect, it, vi } from 'vitest'
import type { AlpacaAcquisition, AlpacaCameraGeometry, AlpacaFraming, AlpacaTelescopeStatus } from '@vela/alpaca'
import { createPhysicalAlignment } from './physical.js'

const signal = new AbortController().signal

function observatory(mechanicalSign = -1) {
  const mount: AlpacaTelescopeStatus = {
    rightAscensionDegrees: 10, declinationDegrees: 60, coordinateSystem: 'topocentric',
    latitudeDegrees: 39, longitudeDegrees: -77, elevationMeters: 150,
    tracking: true, trackingRate: 'sidereal', rightAscensionRateSecondsPerSiderealSecond: 0,
    declinationRateArcsecondsPerSecond: 0, pierSide: 'east', slewing: false, parked: false,
    observedAt: '2026-09-09T01:00:00Z',
  }
  const camera: AlpacaCameraGeometry = {
    cameraName: 'Imager', sensorWidthPixels: 6000, sensorHeightPixels: 4000,
    pixelWidthMicrons: 3.76, pixelHeightMicrons: 3.76, binX: 2, binY: 2,
    width: 3000, height: 2000, startX: 0, startY: 0,
  }
  const mechanics = { sign: mechanicalSign, afterMove: () => {} }
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected hardware operation') }
  const acquisition: AlpacaAcquisition = {
    capture: unexpected, pointing: unexpected, abort: unexpected,
    move: vi.fn(async (_id, rate, duration) => {
      // The fake models the motor/driver independently; it knows no sweep target.
      mount.rightAscensionDegrees = (mount.rightAscensionDegrees + mechanics.sign * rate * duration + 360) % 360
      mechanics.afterMove()
    }),
  }
  let observation = 0
  const device: AlpacaFraming = {
    telescopeStatus: vi.fn(async () => ({ ...mount,
      observedAt: new Date(Date.parse(mount.observedAt) + observation++ * 1000).toISOString() })),
    cameraGeometry: vi.fn(async () => ({ ...camera })),
    setTracking: unexpected, slew: unexpected, abortTelescope: unexpected,
  }
  const settings = { cameraId: 'camera', cameraName: 'Imager', telescopeId: 'mount', focalLengthMm: 400 }
  return { mount, camera, mechanics, acquisition, device, settings,
    alignment: createPhysicalAlignment(settings, acquisition, device) }
}

describe('physical alignment sweep', () => {
  it('prepares from observed mount state and binned camera field height', async () => {
    const fake = observatory()
    const prepared = await fake.alignment.prepare(signal)
    expect(prepared.fieldHeightDegrees).toBeCloseTo(2.15407, 5)
    expect(fake.device.telescopeStatus).toHaveBeenCalledWith('mount', signal, { includeAlignmentObservations: true })
    expect(fake.device.cameraGeometry).toHaveBeenCalledWith({ cameraId: 'camera', expectedCameraName: 'Imager' }, signal)
    expect(fake.acquisition.move).not.toHaveBeenCalled()
    await expect(fake.alignment.pointing(signal)).resolves.toMatchObject({ latitude: 39 })
  })

  it('allows cancellation during settling before reading exposure pointing', async () => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    const controller = new AbortController()
    const pending = fake.alignment.pointing(controller.signal)
    const rejection = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(fake.device.telescopeStatus).toHaveBeenCalledTimes(2))
    controller.abort()
    await rejection
    expect(fake.device.cameraGeometry).toHaveBeenCalledTimes(1)
  })

  it('rechecks mount state after settling', async () => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    const pending = fake.alignment.pointing(signal)
    const rejection = expect(pending).rejects.toThrow('tracking enabled')
    await vi.waitFor(() => expect(fake.device.telescopeStatus).toHaveBeenCalledTimes(2))
    fake.mount.tracking = false
    await rejection
  })

  it.each([-1, 1])('observes mechanical sign %s and completes two westward 18-degree steps through RA wrap', async sign => {
    const fake = observatory(sign)
    await fake.alignment.prepare(signal)
    await fake.alignment.move(signal)
    expect(fake.mount.rightAscensionDegrees).toBeCloseTo(352, 8)
    await fake.alignment.validate(signal)
    await fake.alignment.move(signal)
    expect(fake.mount.rightAscensionDegrees).toBeCloseTo(334, 8)
    expect(fake.mount.declinationDegrees).toBe(60)
    const moves = vi.mocked(fake.acquisition.move).mock.calls
    expect(moves[0]).toEqual(['mount', 0.5, 1, signal])
    for (const [, rate, duration] of moves.slice(1)) {
      expect(rate).toBe(-sign * 1.5)
      expect(Math.abs(rate * duration)).toBeLessThanOrEqual(3)
    }
    expect(moves.filter(([, rate]) => rate === 0.5)).toHaveLength(1)
    await fake.alignment.validate(signal)
  })

  it.each([
    { tracking: false }, { parked: true }, { slewing: true }, { coordinateSystem: 'j2000' },
    { trackingRate: 'lunar' }, { trackingRate: undefined },
    { rightAscensionRateSecondsPerSiderealSecond: 0.001 }, { rightAscensionRateSecondsPerSiderealSecond: undefined },
    { declinationRateArcsecondsPerSecond: 0.001 }, { declinationRateArcsecondsPerSecond: undefined },
    { pierSide: 'unknown' }, { pierSide: undefined },
    { latitudeDegrees: -39 }, { latitudeDegrees: 86 }, { latitudeDegrees: undefined }, { longitudeDegrees: undefined },
  ])('rejects unsuitable starting observations %j without motion', async changes => {
    const fake = observatory()
    Object.assign(fake.mount, changes)
    await expect(fake.alignment.prepare(signal)).rejects.toThrow()
    expect(fake.acquisition.move).not.toHaveBeenCalled()
  })

  it.each([
    { trackingRate: 'solar' }, { pierSide: 'west' }, { latitudeDegrees: 40 },
    { longitudeDegrees: -76 }, { elevationMeters: 151 },
    { rightAscensionDegrees: 10.1 }, { declinationDegrees: 60.1 },
  ])('rejects an external change after preparation %j', async changes => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    Object.assign(fake.mount, changes)
    await expect(fake.alignment.validate(signal)).rejects.toThrow()
    await expect(fake.alignment.move(signal)).rejects.toThrow()
    expect(fake.acquisition.move).not.toHaveBeenCalled()
  })

  it('rejects geometry changes before supplying capture pointing', async () => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    fake.camera.binY = 1
    await expect(fake.alignment.pointing(signal)).rejects.toThrow('geometry changed')
  })

  it('rejects a delivered frame that differs from the calibrated camera geometry', async () => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    await expect(fake.alignment.validate(signal, { width: 1500, height: 1000 })).rejects.toThrow('dimensions changed')
    await expect(fake.alignment.validate(signal, { width: 3000, height: 2000 })).resolves.toBeDefined()
  })

  it.each([0, 4])('rejects absent or excessive probe response (motor multiplier %s)', async sign => {
    const fake = observatory(sign)
    await fake.alignment.prepare(signal)
    await expect(fake.alignment.move(signal)).rejects.toThrow('direction probe')
    expect(fake.acquisition.move).toHaveBeenCalledTimes(1)
  })

  it.each(['unchanged', 'reversed', 'declination'] as const)('stops at the first unexpected increment: %s', async fault => {
    const fake = observatory()
    let moves = 0
    fake.mechanics.afterMove = () => {
      moves += 1
      if (moves === 1 && fault === 'unchanged') fake.mechanics.sign = 0
      if (moves === 1 && fault === 'reversed') fake.mechanics.sign = 1
      if (moves === 2 && fault === 'declination') fake.mount.declinationDegrees += 0.2
    }
    await fake.alignment.prepare(signal)
    await expect(fake.alignment.move(signal)).rejects.toThrow('RA-only sweep')
    expect(fake.acquisition.move).toHaveBeenCalledTimes(2)
  })

  it('rejects declination drift in the probe before issuing another movement', async () => {
    const fake = observatory()
    fake.mechanics.afterMove = () => { fake.mount.declinationDegrees += 0.2 }
    await fake.alignment.prepare(signal)
    await expect(fake.alignment.move(signal)).rejects.toThrow()
    expect(fake.acquisition.move).toHaveBeenCalledTimes(1)
  })

  it('propagates an ambiguous movement error without retrying', async () => {
    const fake = observatory()
    fake.mechanics.afterMove = () => { throw new Error('Movement response lost') }
    await fake.alignment.prepare(signal)
    await expect(fake.alignment.move(signal)).rejects.toThrow('Movement response lost')
    expect(fake.acquisition.move).toHaveBeenCalledTimes(1)
  })
})
