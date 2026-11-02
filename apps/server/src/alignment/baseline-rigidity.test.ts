import { describe, expect, it } from 'vitest'
import { baselineRigidity, type RigidityFrame } from './baseline-rigidity.js'
import { fixture } from './physical-fixture.js'
import { physicalAlignmentSample } from './physical-coordinates.js'

const [first, second, third] = fixture.cases[0]!.samples

function frameOf(capture: typeof first): RigidityFrame {
  const sample = physicalAlignmentSample(capture.solved, { capturedAt: capture.capturedAt, exposureSeconds: 2 }, fixture.site)

  return {
    solved: { ...capture.solved, cd: [0.1, 0, 0, -0.1] },
    sample,
    mountRightAscensionDegrees: sample.raDegrees,
  }
}

const frames = [frameOf(first), frameOf(second), frameOf(third)] as const

describe('baselineRigidity', () => {
  it('calls a mount rigid when the camera turned as far as the mount reported', () => {
    expect(baselineRigidity(frames)).toMatchObject({ status: 'rigid', thresholdArcmin: 2 })
  })

  it('calls the mount not rigid when the third position is not where the first two predict', () => {
    const loose = [frames[0], frames[1], { ...frames[2], mountRightAscensionDegrees: frames[2].mountRightAscensionDegrees + 0.5 }] as const
    const verdict = baselineRigidity(loose)

    expect(verdict.status).toBe('not-rigid')
    expect(verdict.missArcmin).toBeGreaterThan(2)
  })

  it('refuses a solve whose WCS has no orientation instead of returning a miss that is not a number', () => {
    const singular = [frames[0], { ...frames[1], solved: { ...frames[1].solved, cd: [0, 0, 0, 0] } }, frames[2]] as const

    expect(() => baselineRigidity(singular)).toThrow('no usable orientation')
  })
})
