export interface Target {
  readonly id: string
  readonly name: string
  readonly common: string
  readonly also: ReadonlyArray<string>
  readonly type: string
  readonly constellation: string
  readonly size: string
  readonly up: boolean
  readonly altitude: string
  readonly until: string
  readonly fromMoon: string
  readonly dualBand: boolean
}

export const targets: ReadonlyArray<Target> = [
  {
    id: 'ngc7635',
    name: 'NGC 7635',
    common: 'Bubble',
    also: ['Bubble', 'Sh2-162', 'C 11'],
    type: 'Emission nebula',
    constellation: 'Cassiopeia',
    size: '15′',
    up: true,
    altitude: '71°',
    until: '02:40',
    fromMoon: '112°',
    dualBand: true,
  },
  {
    id: 'ic1805',
    name: 'IC 1805',
    common: 'Heart',
    also: ['Heart', 'Sh2-190'],
    type: 'Emission nebula',
    constellation: 'Cassiopeia',
    size: '150′',
    up: true,
    altitude: '58°',
    until: '04:10',
    fromMoon: '96°',
    dualBand: true,
  },
  {
    id: 'ic1848',
    name: 'IC 1848',
    common: 'Soul',
    also: ['Soul', 'Sh2-199'],
    type: 'Emission nebula',
    constellation: 'Cassiopeia',
    size: '100′',
    up: true,
    altitude: '55°',
    until: '04:25',
    fromMoon: '93°',
    dualBand: true,
  },
  {
    id: 'ngc281',
    name: 'NGC 281',
    common: 'Pacman',
    also: ['Pacman', 'Sh2-184', 'IC 11'],
    type: 'Emission nebula',
    constellation: 'Cassiopeia',
    size: '35′',
    up: true,
    altitude: '68°',
    until: '02:05',
    fromMoon: '104°',
    dualBand: true,
  },
  {
    id: 'm31',
    name: 'M 31',
    common: 'Andromeda',
    also: ['Andromeda', 'NGC 224'],
    type: 'Galaxy',
    constellation: 'Andromeda',
    size: '178′',
    up: true,
    altitude: '74°',
    until: '01:30',
    fromMoon: '88°',
    dualBand: false,
  },
  {
    id: 'm52',
    name: 'M 52',
    common: '',
    also: ['NGC 7654'],
    type: 'Open cluster',
    constellation: 'Cassiopeia',
    size: '13′',
    up: true,
    altitude: '70°',
    until: '02:45',
    fromMoon: '111°',
    dualBand: false,
  },
  {
    id: 'ngc7000',
    name: 'NGC 7000',
    common: 'N America',
    also: ['North America', 'Sh2-117', 'C 20'],
    type: 'Emission nebula',
    constellation: 'Cygnus',
    size: '120′',
    up: true,
    altitude: '49°',
    until: '22:50',
    fromMoon: '131°',
    dualBand: true,
  },
  {
    id: 'm42',
    name: 'M 42',
    common: 'Orion',
    also: ['Orion', 'NGC 1976'],
    type: 'Emission nebula',
    constellation: 'Orion',
    size: '65′',
    up: false,
    altitude: '-9°',
    until: 'RISES 22:35',
    fromMoon: '58°',
    dualBand: true,
  },
]

export type Exposure = '60' | '90' | '120' | 'other'

interface LastUsed {
  readonly exposure: Exposure
  readonly otherSeconds: number
  readonly frames: number
}

const lastUsed: LastUsed = { exposure: '60', otherSeconds: 180, frames: 300 }

export const ready = {
  facts: ['Rig set 18:42', 'Filter in', 'Dark until 05:03', 'Moon 2 %'],
  frame: 'Frame 3.3 × 2.2°',
  now: '20:48',
  dawn: '05:03',
  lastUsed,
} as const
