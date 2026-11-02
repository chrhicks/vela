import { describe, expect, it } from 'vitest'
import { mountSite } from '@vela/rig-events'
import { mountState, syntheticSite } from '@vela/rig-testing'

const at = 1_792_000_000_000

describe('mountSite', () => {
  it('reads the site a snapshot\'s mount reports', () => {
    expect(mountSite(mountState({ sequence: 1, mount: { at, raHours: 1, decDegrees: 2 } }))).toEqual(syntheticSite)
  })

  it('finds none when the mount reports none, or the snapshot has no mount', () => {
    expect(mountSite(mountState({ sequence: 1, mount: { at, raHours: 1, decDegrees: 2, site: null } }))).toBeNull()
    expect(mountSite(mountState({ sequence: 1, withoutMount: true, mount: { at, raHours: 1, decDegrees: 2 } }))).toBeNull()
  })
})
