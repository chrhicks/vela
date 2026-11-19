import type { EndsBy, Limit } from '../../../../../state/ends-by.ts'
import type { Sky } from '../../../../../state/sky.ts'
import type { Placement, SizeArcminutes } from '../../../../../state/targets.ts'
import { clockTime } from '../../../rig/clock.ts'
import { frameDegrees } from './frame.ts'

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
  EmN: 'Emission nebula',
  Neb: 'Nebula',
  RfN: 'Reflection nebula',
  DrkN: 'Dark nebula',
  'Cl+N': 'Cluster with nebula',
  OCl: 'Open cluster',
  GCl: 'Globular cluster',
  '*Ass': 'Stellar association',
  GPair: 'Galaxy pair',
  GTrpl: 'Galaxy triplet',
  GGroup: 'Galaxy group',
  Nova: 'Nova',
  Other: 'Other',
  '?': 'Unknown',
  'Sy*': 'Symbiotic star',
  'Em*': 'Emission-line star',
  'pA*': 'Post-AGB star',
  'pA?': 'Post-AGB star?',
  'Q?': 'Quasar?',
  Bla: 'Blazar',
  BLL: 'BL Lac object',
  EmO: 'Emission object',
  'Mi*': 'Mira variable',
  'Mi?': 'Mira variable?',
  YSO: 'Young stellar object',
  'Y*O': 'Young stellar object',
  'Y*?': 'Young stellar object?',
  PoG: 'Part of a galaxy',
  PoC: 'Part of a cloud',
  'No*': 'Nova',
  'NL*': 'Nova-like star',
  IR: 'Infrared source',
  UV: 'Ultraviolet source',
  Mas: 'Maser',
  'sr*': 'Semi-regular variable',
  'Ir*': 'Irregular variable',
  'LP*': 'Long-period variable',
  'V*': 'Variable star',
  'Or*': 'Orion variable',
  'RS*': 'RS CVn variable',
  'El*': 'Ellipsoidal variable',
  'Al*': 'Algol-type binary',
  'CV*': 'Cataclysmic variable',
  'C*': 'Carbon star',
  'WD*': 'White dwarf',
  'TT*': 'T Tauri star',
  'pr*': 'Pre-main-sequence star',
  'HS*': 'Hot subdwarf',
  'AB*': 'AGB star',
  'RG*': 'Red giant',
  'OH*': 'OH/IR star',
  's?r': 'Red supergiant?',
  's*b': 'Blue supergiant',
  '*iN': 'Star in nebula',
  'HX?': 'X-ray binary?',
  SFR: 'Star-forming region',
  bub: 'Bubble',
  CGb: 'Cometary globule',
  MGr: 'Moving group',
  CGG: 'Compact group of galaxies',
  SCG: 'Supercluster of galaxies',
  RG: 'Radio galaxy',
  'J2000 position': 'Typed position',
}

export const typeOf = (code: string) => typeWords[code] ?? code

export const degrees = (value: number) => `${Math.round(value)}°`

export const altitudeOf = (placement: Placement | null) => (placement === null ? unknown : degrees(placement.altitudeDegrees))

export const moonOf = (placement: Placement | null) => (placement === null ? unknown : degrees(placement.moonDegrees))

export function aboveLineOf(placement: Placement | null) {
  if (placement === null) return unknown

  switch (placement.line.above) {
    case 'until':
      return clockTime(placement.line.until)
    case 'always':
      return 'All night'
    case 'rises':
      return `Rises ${clockTime(placement.line.at)}`
    case 'no':
      return 'Not up'
  }
}

export const isUp = (placement: Placement | null) => placement === null || placement.line.above === 'until' || placement.line.above === 'always'

const arcminutes = (value: number) => `${Number(value.toFixed(value < 10 ? 1 : 0))}′`

export function sizeOf(size: SizeArcminutes) {
  if (size === null) return unknown

  return size.short === null || size.short === size.long ? arcminutes(size.long) : `${arcminutes(size.long)} × ${arcminutes(size.short)}`
}

const frameArcminutes = frameDegrees.width * 60

export const frameShareOf = (size: SizeArcminutes) => (size === null ? unknown : `${Math.round((size.long / frameArcminutes) * 100)}%`)

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
