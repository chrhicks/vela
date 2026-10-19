import { expect, test } from 'vitest'
import { criaConfigFor, replayRigId, velaCriaConfigFor } from './rig-config.ts'

const devices = [
  { id: 'primary', kind: 'camera', indiDevice: 'ZWO CCD ASI2600MC Pro' },
  { id: 'guide', kind: 'camera', indiDevice: 'ZWO CCD ASI220MM Mini' },
  { id: 'mount', kind: 'mount', indiDevice: 'ZWO AM5' },
  { id: 'switch', kind: 'switch', indiDevice: 'Pegasus PPBA' },
]

test('Cria is told to connect to nothing, on any free port, with no serial port and no site', () => {
  expect(criaConfigFor(devices, { indiPort: 7777, imageDirectory: '/tmp/x/images' })).toEqual({
    listen: { host: '127.0.0.1', port: 0 },
    indi: { host: '127.0.0.1', port: 7777 },
    imageDirectory: '/tmp/x/images',
    commandsEnabled: true,
    devices: [
      { id: 'primary', kind: 'camera', indiDevice: 'ZWO CCD ASI2600MC Pro', connect: false },
      { id: 'guide', kind: 'camera', indiDevice: 'ZWO CCD ASI220MM Mini', connect: false },
      { id: 'mount', kind: 'mount', indiDevice: 'ZWO AM5', connect: false },
    ],
  })
})

test('Vela gets one rig named replay: <name> whose imaging camera is the one replay serves', () => {
  expect(velaCriaConfigFor('night one', devices, { criaUrl: 'http://127.0.0.1:4000', imagingIndiDevice: 'ZWO CCD ASI220MM Mini' })).toEqual({
    rigs: [
      {
        id: 'replay-night-one',
        name: 'replay: night one',
        url: 'http://127.0.0.1:4000',
        imagingCameraId: 'guide',
        devices: [
          { id: 'primary', kind: 'camera', expectedName: 'ZWO CCD ASI2600MC Pro' },
          { id: 'guide', kind: 'camera', expectedName: 'ZWO CCD ASI220MM Mini' },
          { id: 'mount', kind: 'mount', expectedName: 'ZWO AM5' },
        ],
      },
    ],
  })
})

test('a served camera that the recording does not list is an error, not a silent default', () => {
  expect(() => velaCriaConfigFor('x', devices, { criaUrl: 'http://127.0.0.1:1', imagingIndiDevice: 'Nope' })).toThrow('no camera named Nope')
})

test('a rig id is a lowercase slug of the name', () => {
  expect(replayRigId('2026-10-17 Night (AM5)')).toBe('replay-2026-10-17-night-am5')
})
