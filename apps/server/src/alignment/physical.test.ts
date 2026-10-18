import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import type {
  AlpacaAcquisition,
  AlpacaCameraGeometry,
  AlpacaFraming,
  AlpacaTelescopeStatus,
} from '@vela/alpaca'
import { createPhysicalAlignment } from './physical.js'

const signal = new AbortController().signal

function observatory(mechanicalSign = -1, sweep: { sweepRateDegreesPerSecond?: number; maxLegSeconds?: number } = {}) {
  const mount: AlpacaTelescopeStatus = {
    rightAscensionDegrees: 10,
    declinationDegrees: 60,
    coordinateSystem: 'topocentric',
    latitudeDegrees: 39,
    longitudeDegrees: -77,
    elevationMeters: 150,
    tracking: true,
    trackingRate: 'sidereal',
    rightAscensionRateSecondsPerSiderealSecond: 0,
    declinationRateArcsecondsPerSecond: 0,
    pierSide: 'east',
    slewing: false,
    parked: false,
    observedAt: '2026-09-09T01:00:00Z',
  }

  const camera: AlpacaCameraGeometry = {
    cameraName: 'Imager',
    sensorWidthPixels: 6000,
    sensorHeightPixels: 4000,
    pixelWidthMicrons: 3.76,
    pixelHeightMicrons: 3.76,
    binX: 2,
    binY: 2,
    width: 3000,
    height: 2000,
    startX: 0,
    startY: 0,
  }

  const mechanics = { sign: mechanicalSign, overshoot: 0, afterMove: () => {} }

  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected hardware operation')
  }

  const acquisition: AlpacaAcquisition = {
    capture: unexpected,
    pointing: unexpected,
    abort: unexpected,
    rotateRightAscension: vi.fn(async (_id, rate, distance) => {
      const travel = Math.sign(mechanics.sign * rate) * (Math.abs(distance) + mechanics.overshoot)
      mount.rightAscensionDegrees = (mount.rightAscensionDegrees + travel + 360) % 360
      mechanics.afterMove()
    }),
    move: vi.fn(async (_id, rate, duration) => {
      // The fake models the motor/driver independently; it knows no sweep target.
      mount.rightAscensionDegrees =
        (mount.rightAscensionDegrees + mechanics.sign * rate * duration + 360) % 360
      mechanics.afterMove()
    }),
  }

  let observation = 0

  const device: AlpacaFraming = {
    home: vi.fn(async () => {
      mount.tracking = false
      mount.declinationDegrees = 90
    }),
    telescopeStatus: vi.fn(async () => ({
      ...mount,
      observedAt: new Date(Date.parse(mount.observedAt) + observation++ * 1000).toISOString(),
    })),
    cameraGeometry: vi.fn(async () => ({ ...camera })),
    setTracking: vi.fn(async (_id, tracking) => {
      mount.tracking = tracking
    }),
    slew: vi.fn(async target => {
      mount.rightAscensionDegrees = target.rightAscensionDegrees
      mount.declinationDegrees = target.declinationDegrees
    }),
    abortTelescope: unexpected,
  }

  const settings = {
    cameraId: 'camera',
    cameraName: 'Imager',
    telescopeId: 'mount',
    focalLengthMm: 400,
    ...sweep,
  }

  const settle = vi.fn(async (_signal: AbortSignal) => {})

  return {
    mount,
    camera,
    mechanics,
    acquisition,
    device,
    settings,
    settle,
    alignment: createPhysicalAlignment(settings, acquisition, device, settle),
  }
}

describe('physical alignment sweep', () => {
  it('prepares a tracking-off mount by homing and restoring tracking', async () => {
    const fake = observatory()
    fake.mount.tracking = false
    await fake.alignment.prepare(signal)
    expect(fake.device.home).toHaveBeenCalledExactlyOnceWith('mount', signal)
    expect(fake.device.setTracking).toHaveBeenCalledExactlyOnceWith('mount', true, signal)
    expect(fake.mount.tracking).toBe(true)
    expect(fake.mount.declinationDegrees).toBe(80)
    await expect(fake.alignment.validate(signal)).resolves.toBeDefined()
  })

  it('rejects preparation when tracking is still off after its restoration request', async () => {
    const fake = observatory()
    fake.mount.tracking = false
    vi.mocked(fake.device.setTracking).mockImplementation(async () => {})
    await expect(fake.alignment.prepare(signal)).rejects.toThrow('tracking enabled')
    expect(fake.acquisition.move).not.toHaveBeenCalled()
    expect(fake.acquisition.rotateRightAscension).not.toHaveBeenCalled()
  })

  it('homes on every attempt and restores tracking before observing', async () => {
    const fake = observatory()
    fake.mount.pierSide = 'unknown'
    await fake.alignment.prepare(signal)
    await fake.alignment.prepare(signal)
    expect(fake.device.home).toHaveBeenCalledTimes(2)
    expect(fake.device.setTracking).toHaveBeenCalledTimes(2)
    expect(fake.mount.tracking).toBe(true)
    expect(fake.mount.declinationDegrees).toBe(80)
    expect(fake.device.slew).toHaveBeenCalledTimes(2)
    await fake.alignment.validate(signal)
  })

  it('uses a consistent starting field despite opposite RA readings at Home', async () => {
    const fake = observatory()
    vi.mocked(fake.device.home).mockImplementation(async () => {
      fake.mount.rightAscensionDegrees = (fake.mount.rightAscensionDegrees + 180) % 360
      fake.mount.declinationDegrees = 90
      fake.mount.tracking = false
    })
    await fake.alignment.prepare(signal)
    const first = fake.mount.rightAscensionDegrees
    await fake.alignment.prepare(signal)
    expect(Math.abs(fake.mount.rightAscensionDegrees - first)).toBeLessThan(0.1)
    expect(fake.mount.declinationDegrees).toBe(80)
  })

  it('prepares from observed mount state and binned camera field height', async () => {
    const fake = observatory()
    const prepared = await fake.alignment.prepare(signal)
    expect(prepared.fieldHeightDegrees).toBeCloseTo(2.15407, 5)
    expect(fake.device.telescopeStatus).toHaveBeenCalledWith('mount', signal, {
      includeAlignmentObservations: true,
    })
    expect(fake.device.cameraGeometry).toHaveBeenCalledWith(
      { cameraId: 'camera', expectedCameraName: 'Imager' },
      signal,
    )
    expect(fake.acquisition.move).not.toHaveBeenCalled()
    await expect(fake.alignment.pointing(signal)).resolves.toMatchObject({ latitude: 39 })
  })

  it('allows cancellation during settling before reading exposure pointing', async () => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    const controller = new AbortController()
    fake.settle.mockImplementation(
      next =>
        new Promise((_resolve, reject) => {
          next.throwIfAborted()
          next.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {
            once: true,
          })
        }),
    )
    const pending = fake.alignment.pointing(controller.signal)
    const rejection = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(fake.device.telescopeStatus).toHaveBeenCalledTimes(4))
    controller.abort()
    await rejection
    expect(fake.device.cameraGeometry).toHaveBeenCalledTimes(1)
  })

  it('uses a caller-owned settling interval without skipping the post-settle checks', async () => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    const settled = fake.settle.mock.calls.length
    const statuses = vi.mocked(fake.device.telescopeStatus).mock.calls.length
    const geometries = vi.mocked(fake.device.cameraGeometry).mock.calls.length

    await expect(fake.alignment.pointing(signal, { afterSettling: true })).resolves.toMatchObject({
      latitude: 39,
    })
    expect(fake.settle).toHaveBeenCalledTimes(settled)
    expect(fake.device.telescopeStatus).toHaveBeenCalledTimes(statuses + 1)
    expect(fake.device.cameraGeometry).toHaveBeenCalledTimes(geometries + 1)

    fake.mount.tracking = false
    await expect(fake.alignment.pointing(signal, { afterSettling: true })).rejects.toThrow(
      'tracking enabled',
    )
    fake.mount.tracking = true
    fake.camera.binY += 1
    await expect(fake.alignment.pointing(signal, { afterSettling: true })).rejects.toThrow(
      'geometry changed',
    )
  })

  it('rechecks mount state after settling', async () => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    fake.settle.mockImplementation(async () => {
      fake.mount.tracking = false
    })
    await expect(fake.alignment.pointing(signal)).rejects.toThrow('tracking enabled')
  })

  it.each([-1, 1])(
    'observes mechanical sign %s and completes two continuous westward legs',
    async sign => {
      const fake = observatory(sign)
      await fake.alignment.prepare(signal)
      const startRa = fake.mount.rightAscensionDegrees
      await fake.alignment.move(signal)
      const firstTravel = (startRa - fake.mount.rightAscensionDegrees + 360) % 360
      expect(firstTravel).toBeCloseTo(57)
      await fake.alignment.validate(signal)
      await fake.alignment.move(signal)
      const totalTravel = (startRa - fake.mount.rightAscensionDegrees + 360) % 360
      expect(totalTravel).toBeCloseTo(114)
      expect(fake.mount.declinationDegrees).toBe(80)
      expect(fake.acquisition.move).toHaveBeenCalledExactlyOnceWith('mount', 0.25, 1, signal)
      expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledTimes(2)

      for (const [, rate, distance] of vi.mocked(fake.acquisition.rotateRightAscension).mock
        .calls) {
        expect(rate).toBe(-sign)
        expect(distance).toBeLessThan(-56)
        expect(distance).toBeGreaterThan(-58)
      }

      await fake.alignment.validate(signal)
    },
  )

  it('expires the reference as tracking carries the field toward the meridian', async () => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    await fake.alignment.move(signal)
    await fake.alignment.move(signal)
    fake.mount.observedAt = new Date(
      Date.parse(fake.mount.observedAt) + 2 * 60 * 60 * 1000,
    ).toISOString()
    await expect(fake.alignment.validate(signal)).rejects.toThrow('meridian boundary')
  })

  it('measures each step after delayed position telemetry settles', async () => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    fake.settle.mockImplementation(async () => {
      fake.mount.rightAscensionDegrees -= 0.15
    })
    await fake.alignment.move(signal)
    // Late telemetry must be included in the reference, not mistaken for a new move.
    await expect(fake.alignment.validate(signal)).resolves.toBeDefined()
    expect(fake.settle.mock.calls.length).toBe(
      1 +
        vi.mocked(fake.acquisition.move).mock.calls.length +
        vi.mocked(fake.acquisition.rotateRightAscension).mock.calls.length,
    )
  })

  it('rejects a preparation slew that leaves the telescope at the pole', async () => {
    const fake = observatory()
    vi.mocked(fake.device.slew).mockImplementation(async () => {})
    await expect(fake.alignment.prepare(signal)).rejects.toThrow('off-pole')
    expect(fake.acquisition.move).not.toHaveBeenCalled()
  })

  it('accepts modest motor overshoot without a corrective movement', async () => {
    const fake = observatory()
    fake.mechanics.overshoot = 3
    await fake.alignment.prepare(signal)
    const startRa = fake.mount.rightAscensionDegrees
    await fake.alignment.move(signal)
    const travel = (startRa - fake.mount.rightAscensionDegrees + 360) % 360
    expect(travel).toBeCloseTo(60)
    expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledTimes(1)
    await fake.alignment.validate(signal)
  })

  it.each([
    { parked: true },
    { slewing: true },
    { coordinateSystem: 'j2000' },
    { trackingRate: 'lunar' },
    { trackingRate: undefined },
    { rightAscensionRateSecondsPerSiderealSecond: 0.001 },
    { rightAscensionRateSecondsPerSiderealSecond: undefined },
    { declinationRateArcsecondsPerSecond: 0.001 },
    { declinationRateArcsecondsPerSecond: undefined },
    { latitudeDegrees: -39 },
    { latitudeDegrees: 86 },
    { latitudeDegrees: undefined },
    { longitudeDegrees: undefined },
  ])('rejects unsuitable starting observations %j without motion', async changes => {
    const fake = observatory()
    fake.mount.tracking = false
    Object.assign(fake.mount, changes)
    await expect(fake.alignment.prepare(signal)).rejects.toThrow()
    expect(fake.device.home).not.toHaveBeenCalled()
    expect(fake.device.slew).not.toHaveBeenCalled()
    expect(fake.acquisition.move).not.toHaveBeenCalled()
  })

  it.each([
    { tracking: false },
    { trackingRate: 'solar' },
    { pierSide: 'west' },
    { latitudeDegrees: 40 },
    { longitudeDegrees: -76 },
    { elevationMeters: 151 },
    { rightAscensionDegrees: 10.1 },
    { declinationDegrees: 80.1 },
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

  it('accepts unchanged camera geometry regardless of property order', async () => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    vi.mocked(fake.device.cameraGeometry).mockResolvedValue(
      // SAFETY: reversing the entries preserves every key and value of the typed camera geometry.
      Object.fromEntries(Object.entries(fake.camera).reverse()) as typeof fake.camera,
    )
    await expect(fake.alignment.pointing(signal)).resolves.toBeDefined()
  })

  it('rejects a delivered frame that differs from the calibrated camera geometry', async () => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    await expect(fake.alignment.validate(signal, { width: 1500, height: 1000 })).rejects.toThrow(
      'dimensions changed',
    )
    await expect(
      fake.alignment.validate(signal, { width: 3000, height: 2000 }),
    ).resolves.toBeDefined()
  })

  it.each([0, 8])(
    'rejects absent or excessive probe response (motor multiplier %s)',
    async sign => {
      const fake = observatory(sign)
      await fake.alignment.prepare(signal)
      await expect(fake.alignment.move(signal)).rejects.toThrow('RA direction check expected')
      expect(fake.acquisition.move).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['unchanged', 'reversed', 'declination'] as const)(
    'rejects an invalid completed rotation without another move: %s',
    async fault => {
      const fake = observatory()
      let moves = 0
      fake.mechanics.afterMove = () => {
        moves += 1

        if (moves === 1 && fault === 'unchanged') fake.mechanics.sign = 0

        if (moves === 1 && fault === 'reversed') fake.mechanics.sign = 1

        if (moves === 2 && fault === 'declination') fake.mount.declinationDegrees += 0.2
      }

      await fake.alignment.prepare(signal)
      await expect(fake.alignment.move(signal)).rejects.toThrow()
      expect(fake.acquisition.move).toHaveBeenCalledTimes(1)
      expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledTimes(1)
    },
  )

  it('rejects declination drift in the probe before issuing another movement', async () => {
    const fake = observatory()
    fake.mechanics.afterMove = () => {
      fake.mount.declinationDegrees += 0.2
    }

    await fake.alignment.prepare(signal)
    await expect(fake.alignment.move(signal)).rejects.toThrow()
    expect(fake.acquisition.move).toHaveBeenCalledTimes(1)
  })

  it('propagates an ambiguous movement error without retrying', async () => {
    const fake = observatory()
    fake.mechanics.afterMove = () => {
      throw new Error('Movement response lost')
    }

    await fake.alignment.prepare(signal)
    await expect(fake.alignment.move(signal)).rejects.toThrow('Movement response lost')
    expect(fake.acquisition.move).toHaveBeenCalledTimes(1)
  })
})

describe('reported Cria axis travel', () => {
  it.each([53.5, 60.5])('rejects a %s degree total sweep even when later telemetry looks acceptable', async total => {
    const fake = observatory()
    await fake.alignment.prepare(signal)
    vi.mocked(fake.acquisition.move).mockImplementation(async () => ({ travelledDegrees: 0.25 }))
    vi.mocked(fake.acquisition.rotateRightAscension).mockImplementation(async () => ({ travelledDegrees: -(total + 0.25) }))
    await expect(fake.alignment.move(signal)).rejects.toThrow('RA sweep expected')
  })

  it('uses the measured probe and sweep, and rates the mount advertises', async () => {
    const fake = observatory()
    fake.mount.primaryAxisRates = [{ name: 'probe', degreesPerSecond: 0.2507 }, { name: 'sweep', degreesPerSecond: 0.998 }, { name: 'fast', degreesPerSecond: 3.008 }]
    await fake.alignment.prepare(signal)
    vi.mocked(fake.acquisition.move).mockImplementation(async () => ({ travelledDegrees: 0.25 }))
    vi.mocked(fake.acquisition.rotateRightAscension).mockImplementation(async () => ({ travelledDegrees: -57.05 }))
    await expect(fake.alignment.move(signal)).resolves.toBeUndefined()
    expect(fake.acquisition.move).toHaveBeenCalledExactlyOnceWith('mount', 0.2507, 1, signal)
    expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledExactlyOnceWith('mount', -0.998, -57.25, signal)
  })
})

const am5Rates = [
  { name: '1x', degreesPerSecond: 0.0042 },
  { name: '8x', degreesPerSecond: 0.2507 },
  { name: '9x', degreesPerSecond: 3.008 },
]

describe('multi-leg sweep', () => {
  function am5(sweep: { sweepRateDegreesPerSecond?: number; maxLegSeconds?: number } = {}) {
    const fake = observatory(-1, sweep)
    fake.mount.primaryAxisRates = am5Rates
    vi.mocked(fake.acquisition.move).mockImplementation(async () => ({ travelledDegrees: 0.25 }))

    return fake
  }

  const asked = (fake: ReturnType<typeof observatory>) =>
    vi.mocked(fake.acquisition.rotateRightAscension).mock.calls.map(call => call[2])

  function reportTravel(fake: ReturnType<typeof observatory>, travelled: (asked: number, leg: number) => number) {
    let leg = 0

    vi.mocked(fake.acquisition.rotateRightAscension).mockImplementation(async (_id, _rate, distance) => ({
      travelledDegrees: travelled(distance, leg++),
    }))
  }

  it('sweeps at the mount’s 8x in legs of at most the leg limit', async () => {
    const fake = am5()
    await fake.alignment.prepare(signal)
    reportTravel(fake, distance => distance)
    await fake.alignment.move(signal)
    expect(fake.acquisition.move).toHaveBeenCalledExactlyOnceWith('mount', 0.2507, 1, signal)
    expect(vi.mocked(fake.acquisition.rotateRightAscension).mock.calls.map(call => call[1])).toEqual([-0.2507, -0.2507, -0.2507])
    const distances = asked(fake)
    expect(distances).toHaveLength(3)

    for (const distance of distances) {
      expect(Math.abs(distance) / 0.2507).toBeLessThanOrEqual(100)
      expect(distance).toBeLessThan(0)
    }

    expect(-distances.reduce((sum, distance) => sum + distance, 0)).toBeCloseTo(57.25)
  })

  it('makes up one leg’s overshoot in the next legs', async () => {
    const fake = am5()
    await fake.alignment.prepare(signal)
    reportTravel(fake, (distance, leg) => distance - (leg === 0 ? 0.6 : 0))
    await fake.alignment.move(signal)
    // SAFETY: a 57° sweep at 8x with the default leg limit is always three legs, asserted by the first test.
    const [first, second, third] = asked(fake) as [number, number, number]
    expect(Math.abs(second)).toBeLessThan(Math.abs(first))
    expect(first + second + third).toBeCloseTo(-57.25 + 0.6)
  })

  it('makes up one leg’s undershoot in the next legs', async () => {
    const fake = am5()
    await fake.alignment.prepare(signal)
    reportTravel(fake, (distance, leg) => distance + (leg === 0 ? 0.6 : 0))
    await fake.alignment.move(signal)
    // SAFETY: a 57° sweep at 8x with the default leg limit is always three legs, asserted by the first test.
    const [first, second, third] = asked(fake) as [number, number, number]
    expect(Math.abs(second)).toBeGreaterThan(Math.abs(first))
    expect(first + second + third).toBeCloseTo(-57.25 - 0.6)
  })

  it('sends no more legs once the corridor is reached', async () => {
    const fake = am5()
    await fake.alignment.prepare(signal)
    reportTravel(fake, () => -55)
    await fake.alignment.move(signal)
    expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledTimes(1)
  })

  it('fails when the sum of the legs is outside the corridor, naming each leg', async () => {
    const fake = am5()
    await fake.alignment.prepare(signal)
    reportTravel(fake, distance => distance * 0.8)
    await expect(fake.alignment.move(signal)).rejects.toThrow(/RA sweep expected 54–60° westward; mount reported \d+\.\d+° over 3 legs \(/)
    expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledTimes(3)
  })

  it('takes a configured advertised rate', async () => {
    const fake = am5({ sweepRateDegreesPerSecond: 3.008 })
    await fake.alignment.prepare(signal)
    reportTravel(fake, distance => distance)
    await fake.alignment.move(signal)
    expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledExactlyOnceWith('mount', -3.008, -57.25, signal)
  })

  it('splits into more legs when the leg limit is lowered', async () => {
    const fake = am5({ maxLegSeconds: 50 })
    await fake.alignment.prepare(signal)
    reportTravel(fake, distance => distance)
    await fake.alignment.move(signal)
    expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledTimes(5)
  })

  it('refuses a configured rate the mount does not advertise before homing or moving', async () => {
    const fake = am5({ sweepRateDegreesPerSecond: 0.5 })
    await expect(fake.alignment.prepare(signal)).rejects.toThrow('not one the mount advertises (0.0042°/s, 0.2507°/s, 3.008°/s)')
    expect(fake.device.home).not.toHaveBeenCalled()
    expect(fake.device.slew).not.toHaveBeenCalled()
    expect(fake.acquisition.move).not.toHaveBeenCalled()
    expect(fake.acquisition.rotateRightAscension).not.toHaveBeenCalled()
  })

  it('never replays a failed leg and sends no later leg', async () => {
    const fake = am5()
    await fake.alignment.prepare(signal)
    let leg = 0

    vi.mocked(fake.acquisition.rotateRightAscension).mockImplementation(async (_id, _rate, distance) => {
      if (leg++ === 1) throw new Error('Cria could not confirm the stop')

      return { travelledDegrees: distance }
    })
    await expect(fake.alignment.move(signal)).rejects.toThrow('Cria could not confirm the stop')
    expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledTimes(2)
  })

  it('stops between legs when Stop arrives', async () => {
    const fake = am5()
    const controller = new AbortController()
    await fake.alignment.prepare(signal)

    vi.mocked(fake.acquisition.rotateRightAscension).mockImplementation(async (_id, _rate, distance) => {
      controller.abort()

      return { travelledDegrees: distance }
    })
    await expect(fake.alignment.move(controller.signal)).rejects.toThrow()
    expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledTimes(1)
  })

  it('ends the sweep when a leg changes the reported declination', async () => {
    const fake = am5()
    await fake.alignment.prepare(signal)

    vi.mocked(fake.acquisition.rotateRightAscension).mockImplementation(async (_id, _rate, distance) => {
      fake.mount.declinationDegrees += 0.5

      return { travelledDegrees: distance }
    })
    await expect(fake.alignment.move(signal)).rejects.toThrow('changed reported DEC by 0.500° in leg 1 of 3')
    expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledTimes(1)
  })

  it('measures each leg from the mount position when the adapter reports no travel', async () => {
    const fake = observatory(-1, { maxLegSeconds: 30 })
    await fake.alignment.prepare(signal)
    const startRa = fake.mount.rightAscensionDegrees
    await fake.alignment.move(signal)
    expect(fake.acquisition.rotateRightAscension).toHaveBeenCalledTimes(2)
    expect((startRa - fake.mount.rightAscensionDegrees + 360) % 360).toBeCloseTo(57, 0)
  })
})

describe('sweep leg trace', () => {
  const exporter = new InMemorySpanExporter()

  beforeAll(() => {
    new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register()
  })

  beforeEach(() => exporter.reset())

  function am5Fake() {
    const fake = observatory(-1)
    fake.mount.primaryAxisRates = am5Rates
    vi.mocked(fake.acquisition.move).mockImplementation(async () => ({ travelledDegrees: 0.25 }))

    return fake
  }

  const legs = () => exporter.getFinishedSpans().filter(span => span.name === 'alignment.sweep_leg')

  it('records each successful leg’s asked distance, reported travel and duration', async () => {
    const fake = am5Fake()
    await fake.alignment.prepare(signal)
    vi.mocked(fake.acquisition.rotateRightAscension).mockImplementation(async (_id, _rate, distance) => ({ travelledDegrees: distance - 0.1 }))
    await fake.alignment.move(signal)

    expect(legs().map(span => span.attributes)).toEqual(
      [1, 2, 3].map(leg => expect.objectContaining({
        'alignment.sweep.leg': leg,
        'alignment.sweep.legs': 3,
        'alignment.sweep.rate_degrees_per_second': -0.2507,
        'alignment.sweep.asked_degrees': expect.any(Number),
        'alignment.sweep.travelled_degrees': expect.any(Number),
        'alignment.sweep.reported': true,
        'alignment.sweep.duration_ms': expect.any(Number),
      })),
    )
    const [first] = legs().map(span => span.attributes)
    expect(first?.['alignment.sweep.asked_degrees']).toBeCloseTo(19.0833, 3)
    expect(first?.['alignment.sweep.travelled_degrees']).toBeCloseTo(19.1833, 3)
  })

  it('records a failed leg with its error and duration', async () => {
    const fake = am5Fake()
    await fake.alignment.prepare(signal)
    vi.mocked(fake.acquisition.rotateRightAscension).mockRejectedValue(new Error('Cria could not confirm the stop'))
    await expect(fake.alignment.move(signal)).rejects.toThrow()

    const [leg] = legs()
    expect(leg?.status).toMatchObject({ code: 2, message: 'Cria could not confirm the stop' })
    expect(leg?.attributes['alignment.sweep.duration_ms']).toEqual(expect.any(Number))
    expect(leg?.attributes).not.toHaveProperty('alignment.sweep.travelled_degrees')
  })
})
