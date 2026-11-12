import { describe, expect, it } from 'vitest'
import { decodeConfig } from './config.ts'
import { VelaSettings } from './settings.ts'

const minimal = {
  port: 8793,
  broker: { servers: 'nats://127.0.0.1:4222' },
  frames: { spoolDir: '/home/example/frames', measureDir: '/home/example/frames/measure', nightZone: 'America/Phoenix' },
  capture: { runFile: '/home/example/.local/state/vela/run.json' },
  feed: { webRoot: '/home/example/vela/web/dist' },
}

describe('settings', () => {
  it('fills the described defaults', () => {
    expect(decodeConfig(VelaSettings, minimal)).toMatchObject({
      silenceSeconds: 10,
      pageRefreshSeconds: 1,
      historyReadBatch: 2048,
      devices: { mount: 'mount', primary: 'primary' },
      capture: { commandAnswerSeconds: 10, settleSeconds: 10, exposureSilenceSeconds: 10, failuresInRow: 3 },
      frames: { host: 'errai', keepDir: '/mnt/storage/rig/frames', nightChangesAtHour: 12, copyAttempts: 3, preview: { bin: 2, blackSigmas: 2.8, targetMedian: 0.25 } },
    })
  })

  it('has no default for where the spool is or which clock names a night', () => {
    expect(() => decodeConfig(VelaSettings, { ...minimal, frames: { spoolDir: '/home/example/frames' } })).toThrow()
    expect(() => decodeConfig(VelaSettings, { ...minimal, frames: { nightZone: 'America/Phoenix' } })).toThrow()
  })

  it('fills the feed defaults and has none for where the built web app is', () => {
    expect(decodeConfig(VelaSettings, minimal).feed).toEqual({ host: '127.0.0.1', port: 8796, webRoot: '/home/example/vela/web/dist', heartbeatSeconds: 5 })
    expect(() => decodeConfig(VelaSettings, { ...minimal, feed: {} })).toThrow()
  })

  it('has no default for where the run file is', () => {
    expect(() => decodeConfig(VelaSettings, { ...minimal, capture: {} })).toThrow()
  })

  it('refuses a key it does not know', () => {
    expect(() => decodeConfig(VelaSettings, { ...minimal, passwrd: 'x' })).toThrow()
  })
})
