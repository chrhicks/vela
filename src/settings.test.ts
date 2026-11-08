import { describe, expect, it } from 'vitest'
import { decodeConfig } from './config.ts'
import { VelaSettings } from './settings.ts'

const minimal = { port: 8793, broker: { servers: 'nats://127.0.0.1:4222', user: 'vela', passFile: '/home/example/.config/vela/broker.pass' } }

describe('settings', () => {
  it('fills the described defaults', () => {
    expect(decodeConfig(VelaSettings, minimal)).toMatchObject({ silenceSeconds: 10, pageRefreshSeconds: 1, historyReadBatch: 2048, devices: { mount: 'mount', primary: 'primary' } })
  })

  it('refuses a key it does not know', () => {
    expect(() => decodeConfig(VelaSettings, { ...minimal, passwrd: 'x' })).toThrow()
  })
})
