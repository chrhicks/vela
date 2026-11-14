import type { EndsBy, Limit } from '../../../../../state/ends-by.ts'
import type { Sky } from '../../../../../state/sky.ts'
import type { Placement, TargetFacts } from '../../../../../state/targets.ts'
import { clockTime } from '../../../rig/clock.ts'

export const unknown = '—'

const typeWords: Readonly<Record<string, string>> = {
  HII: 'Emission nebula',
  EN: 'Emission nebula',
  BN: 'Bipolar nebula',
  NB: 'Nebula',
  GNe: 'Nebula',
  ISM: 'Interstellar cloud',
  MoC: 'Molecular cloud',
  RN: 'Reflection nebula',
  RNe: 'Reflection nebula',
  DN: 'Dark nebula',
  DNe: 'Dark nebula',
  SNR: 'Supernova remnant',
  'SR?': 'Supernova remnant',
  PN: 'Planetary nebula',
  'PN?': 'Planetary nebula',
  PPN: 'Protoplanetary nebula',
  'C+N': 'Cluster with nebula',
  OC: 'Open cluster',
  OpC: 'Open cluster',
  Cl: 'Cluster',
  CL: 'Cluster',
  GC: 'Globular cluster',
  SA: 'Stellar association',
  SC: 'Star cloud',
  REG: 'Region of sky',
  G: 'Galaxy',
  Gx: 'Galaxy',
  AGx: 'Active galaxy',
  rG: 'Radio galaxy',
  IG: 'Interacting galaxies',
  IG2: 'Interacting galaxies',
  GiG: 'Galaxy in a group',
  ClG: 'Cluster of galaxies',
  QSO: 'Quasar',
  '*': 'Star',
  '**': 'Double star',
  'J2000 position': 'Typed position',
}

export const typeOf = (code: string) => typeWords[code] ?? code

export const degrees = (value: number) => `${Math.round(value)}°`

export const altitudeOf = (placement: Placement | null) => (placement === null ? unknown : degrees(placement.altitudeDegrees))

export const moonOf = (placement: Placement | null) => (placement === null ? unknown : degrees(placement.moonDegrees))

export function aboveLineOf(placement: Placement | null) {
  if (placement === null) return unknown

  return placement.line.above === 'until' ? clockTime(placement.line.until) : placement.line.above === 'always' ? 'All night' : 'Not up'
}

export const isUp = (placement: Placement | null) => placement === null || placement.line.above !== 'no'

const arcminutes = (value: number) => `${Number(value.toFixed(value < 10 ? 1 : 0))}′`

export function sizeOf(size: TargetFacts['sizeArcminutes']) {
  if (size === null) return unknown

  return size.short === null || size.short === size.long ? arcminutes(size.long) : `${arcminutes(size.long)} × ${arcminutes(size.short)}`
}

const limitWords: Readonly<Record<Limit['by'], string>> = { 'target-low': 'TARGET LOW', dark: 'DARK ENDS' }

export function endsByWords(ends: EndsBy, now: number) {
  if (ends.ends === 'unknown') return unknown

  if (ends.ends === 'at-limit') return ends.limit.at <= now ? `${limitWords[ends.limit.by]} NOW` : `${clockTime(ends.limit.at)}, ${limitWords[ends.limit.by]}`

  if (ends.passes === undefined) return clockTime(ends.at)

  return `${clockTime(ends.at)}, PAST ${limitWords[ends.passes.by]} ${ends.passes.at <= now ? 'NOW' : clockTime(ends.passes.at)}`
}

export function moonWords({ moon }: Sky) {
  const lit = `Moon ${Math.round(moon.litFraction * 100)} %`

  if (moon.changesAt === null) return `${lit}, ${moon.up ? 'up' : 'down'}`

  return moon.up ? `${lit}, sets ${clockTime(moon.changesAt)}` : `${lit}, down until ${clockTime(moon.changesAt)}`
}
