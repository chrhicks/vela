import { expect, it } from 'vitest'
import { captureSettings } from './settings.js'

it('retains explicit legacy configuration and rejects partial or invalid configuration', () => {
  expect(captureSettings({})).toBeUndefined()
  expect(captureSettings({ VELA_CAPTURE_ENDPOINT: 'http://localhost:7850', VELA_CAPTURE_CAMERA_ID: ' camera ' }))
    .toEqual({ endpoint: 'http://localhost:7850', cameraId: 'camera' })
  expect(() => captureSettings({ VELA_CAPTURE_ENDPOINT: 'http://localhost:7850' })).toThrow()
  expect(() => captureSettings({ VELA_CAPTURE_CAMERA_ID: 'camera' })).toThrow()
  for (const endpoint of ['https://localhost', 'http://localhost/path', 'http://localhost/?query=1', 'http://user@localhost']) {
    expect(() => captureSettings({ VELA_CAPTURE_ENDPOINT: endpoint, VELA_CAPTURE_CAMERA_ID: 'camera' })).toThrow()
  }
})
