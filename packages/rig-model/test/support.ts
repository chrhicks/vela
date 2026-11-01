import { EquatorFromVector, MakeTime, Observer, RotateVector, Rotation_HOR_EQD, Vector } from 'astronomy-engine'
import { epochMs, sourceId, rigId, type RigEvent, type SkyPosition } from '@vela/rig-events'
import { createModel, defaultConfig, step, type ClockInput, type ModelConfig, type ModelInput, type Output } from '@vela/rig-model'
import { syntheticSite } from '@vela/rig-testing'
import { gap, inOrder, session, snapshot, steady } from '@vela/rig-testing'

export const T0 = Date.UTC(2026, 9, 26, 23, 50, 0)

export const s = (seconds: number) => T0 + seconds * 1000

export const baseConfig: ModelConfig = defaultConfig(rigId('test-rig'), sourceId('model:test'))

export function run(inputs: readonly ModelInput[], config: ModelConfig = baseConfig) {
  let model = createModel(config)
  const out: Output[] = []

  for (const input of inputs) {
    const result = step(model, input)

    model = result.model
    out.push(...result.out)
  }

  return { model, out }
}

export function skyAt(altitude: number, azimuth: number, date: Date): SkyPosition {
  const time = MakeTime(date)
  const observer = new Observer(syntheticSite.latitudeDegrees, syntheticSite.longitudeDegrees, syntheticSite.elevationMeters)
  const a = (azimuth * Math.PI) / 180
  const h = (altitude * Math.PI) / 180
  const horizontal = new Vector(Math.cos(h) * Math.cos(a), -Math.cos(h) * Math.sin(a), Math.sin(h), time)
  const equator = EquatorFromVector(RotateVector(Rotation_HOR_EQD(time, observer), horizontal))

  return { raDegrees: equator.ra * 15, decDegrees: equator.dec }
}

export const clock = (second: number): ClockInput => ({ kind: 'clock', at: epochMs(s(second)) })

export const mountOf = (position: SkyPosition) => ({ raHours: position.raDegrees / 15, decDegrees: position.decDegrees })

export interface Pos {
  readonly raHours: number
  readonly decDegrees: number
}

export const home: Pos = mountOf(skyAt(40, 150, new Date(s(25))))

export const away: Pos = mountOf(skyAt(55, 220, new Date(s(25))))

export function slew(fromSecond: number, toSecond: number, start: Pos, end: Pos): RigEvent[] {
  const events: RigEvent[] = []

  for (let second = fromSecond; second < toSecond; second++) {
    const fraction = (second - fromSecond + 1) / (toSecond - fromSecond)
    const at = s(second)

    events.push(
      snapshot({
        at,
        mount: {
          at,
          raHours: start.raHours + (end.raHours - start.raHours) * fraction,
          decDegrees: start.decDegrees + (end.decDegrees - start.decDegrees) * fraction,
          slewing: true,
        },
      }),
    )
  }

  return events
}

export function tracking(fromSecond: number, toSecond: number, where: Pos): RigEvent[] {
  return steady({ from: s(fromSecond), to: s(toSecond), mount: { at: 0, ...where } })
}

export { gap, inOrder, session, snapshot, steady }

export function positions(out: readonly Output[]): string[] {
  return out.flatMap(draft => (draft.kind === 'mount-position' ? [`${draft.body.state}:${draft.body.reason}`] : []))
}

export function results(out: readonly Output[]) {
  return out.flatMap(draft => (draft.kind === 'pointing-fix' ? [draft] : []))
}
