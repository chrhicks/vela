import { describe, expect, it } from 'vitest'
import { connected, startedAt, wire } from '../testing/entries.ts'
import { announcesFrame } from './announce.ts'

describe('announcesFrame', () => {
  it('is true when the camera sets its file path to a file', () => {
    expect(announcesFrame(wire(startedAt, 'set', 'primary', 'CCD_FILE_PATH', { FILE_PATH: '/spool/test_001.fits' }, 'Ok'), 'primary')).toBe(true)
  })

  it('is false for the empty path the driver defines first, another camera, another property, or a command', () => {
    expect(announcesFrame(wire(startedAt, 'def', 'primary', 'CCD_FILE_PATH', { FILE_PATH: '' }, 'Idle'), 'primary')).toBe(false)
    expect(announcesFrame(wire(startedAt, 'set', 'guide', 'CCD_FILE_PATH', { FILE_PATH: '/spool/test_001.fits' }, 'Ok'), 'primary')).toBe(false)
    expect(announcesFrame(wire(startedAt, 'set', 'primary', 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 0 }, 'Ok'), 'primary')).toBe(false)
    expect(announcesFrame(wire(startedAt, 'new', 'primary', 'CCD_FILE_PATH', { FILE_PATH: '/spool/x.fits' }), 'primary')).toBe(false)
    expect(announcesFrame(connected(startedAt), 'primary')).toBe(false)
  })
})
