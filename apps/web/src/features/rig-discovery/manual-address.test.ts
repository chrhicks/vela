import { describe, expect, it } from 'vitest'
import { isDiscoveryHost } from './manual-address'

describe('manual discovery host feedback', () => {
  it.each(['192.168.4.104', '0.0.0.0', 'ascom-remote.local', 'observatory', 'observatory.local.'])('accepts %s', host => {
    expect(isDiscoveryHost(host)).toBe(true)
  })
  it.each(['', 'http://192.168.4.104', 'host:11111', 'foo/bar', 'foo@bar', 'foo..bar', '256.1.1.1', '192.168.01.1', '1.2.3', '-host', 'host-', 'host local', ' host', 'a'.repeat(64)])('rejects %s', host => {
    expect(isDiscoveryHost(host)).toBe(false)
  })
})
