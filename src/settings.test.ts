import { describe, expect, it } from 'vitest'
import { decodeConfig } from './config.ts'
import { VelaSettings } from './settings.ts'

const minimal = {
  port: 8793,
  broker: { servers: 'nats://127.0.0.1:4222' },
  frames: { spoolDir: '/home/example/frames', nightZone: 'America/Phoenix' },
}

describe('settings', () => {
  it('fills the described defaults', () => {
    expect(decodeConfig(VelaSettings, minimal)).toMatchObject({
      silenceSeconds: 10,
      pageRefreshSeconds: 1,
      historyReadBatch: 2048,
      devices: { mount: 'mount', primary: 'primary' },
      frames: { host: 'errai', keepDir: '/mnt/storage/rig/frames', nightChangesAtHour: 12, copyAttempts: 3, preview: { bin: 2, blackSigmas: 2.8, targetMedian: 0.25 } },
    })
  })

  it('has no default for where the spool is or which clock names a night', () => {
    expect(() => decodeConfig(VelaSettings, { ...minimal, frames: { spoolDir: '/home/example/frames' } })).toThrow()
    expect(() => decodeConfig(VelaSettings, { ...minimal, frames: { nightZone: 'America/Phoenix' } })).toThrow()
  })

  it('refuses a key it does not know', () => {
    expect(() => decodeConfig(VelaSettings, { ...minimal, passwrd: 'x' })).toThrow()
  })
})
