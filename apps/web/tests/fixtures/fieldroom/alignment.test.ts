import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { alignmentAdjusting, alignmentMeasuredAt, alignmentResource, alignmentScenes, createAlignmentScene } from './alignment'

const read = '/api/web/rigs/fra400/alignment'

const stop = '/api/rigs/fra400/alignment/stop'

describe('Fieldroom alignment scene boundary', () => {
  it('pins simulator bytes and native geometry, independently of illustrative measurements', () => {
    const image = readFileSync(alignmentResource.path)
    expect(createHash('sha256').update(image).digest('hex')).toBe(alignmentResource.sha256)
    expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([1600, 1200])
    expect(alignmentAdjusting.measurement?.imageWidth).toBe(1600)
    // The declared north-up fixture uses pixel-center coordinates at 3 arcsec/pixel.
    expect(alignmentAdjusting.measurement!.targetX - 799.5).toBeCloseTo(23 / 3)
    expect(alignmentAdjusting.measurement!.targetY - 599.5).toBeCloseTo(-30 / 3)
    expect(alignmentAdjusting.measurement?.imageHeight).toBe(1200)
    expect(alignmentAdjusting.measurement?.capturedAtSource).toBe('server-estimate')
  })

  it('supplies isolated initial states with valid phase and image associations', () => {
    for (const name of alignmentScenes) {
      const scene = createAlignmentScene(name)
      const view = scene.snapshot()
      expect(view.rigId).toBe('fra400')
      expect(view.active).toBe(['baseline', 'adjusting'].includes(view.phase))
      expect(scene.respond('GET', read).status).toBe(200)

      if (view.measurement) {
        expect(Date.parse(view.measuredAt!)).toBeLessThanOrEqual(Date.parse(scene.time))
        expect(view.measurement.totalArcsec).toBeCloseTo(Math.hypot(view.measurement.altitudeArcsec, view.measurement.azimuthArcsec))
      }

      if (view.preview) expect(view.measurement).toBeNull()
      expect(scene.unknownRequests).toEqual([])
    }

    const scene = createAlignmentScene('alignment-phone-adjusting')
    scene.snapshot().measurement!.targetX = 0
    expect(scene.snapshot().measurement!.targetX).not.toBe(0)
  })

  it('freezes the same exposure at two-second and 45-second ages without changing pixels', () => {
    const active = createAlignmentScene('alignment-phone-adjusting')
    const retry = createAlignmentScene('alignment-phone-read-interrupted')
    expect(Date.parse(active.time) - Date.parse(alignmentMeasuredAt)).toBe(2000)
    expect(Date.parse(retry.time) - Date.parse(alignmentMeasuredAt)).toBe(45000)
    expect(active.snapshot().measurement).toEqual(retry.snapshot().measurement)
    expect(retry.snapshot().activity).toBe('retrying')
    expect(retry.respond('POST', stop, {}).status).toBe(200)
    expect(retry.snapshot().phase).toBe('stopped')
  })

  it('scripts image failure/recovery and baseline completion without acquisition writes', () => {
    const scene = createAlignmentScene('alignment-enlarged-baseline')
    const old = scene.snapshot().preview!
    const next = structuredClone(alignmentAdjusting)
    next.measurement!.imageUrl = '/api/rigs/fra400/alignment/images/review-solve-2'
    next.measuredAt = '2026-10-01T01:02:15.000Z'
    scene.setView(next)
    scene.setImageFailure(next.measurement!.imageUrl, 503)
    expect(scene.respond('GET', next.measurement!.imageUrl).status).toBe(503)
    expect(scene.respond('GET', old.imageUrl).resource).toBe(alignmentResource.resource)
    scene.setImageFailure(next.measurement!.imageUrl, null)
    expect(scene.respond('GET', next.measurement!.imageUrl).status).toBe(200)
    expect(scene.writes).toEqual([])
  })

  it('preserves pending and unknown outcomes for explicit state inspection, and blocks unknown routes', () => {
    const scene = createAlignmentScene('alignment-stop-pending')
    expect(scene.respond('POST', stop, {}).status).toBe(200)
    expect(scene.snapshot().activity).toBe('stopping')
    expect(scene.snapshot().active).toBe(true)
    scene.setCommandOutcome('stop', 'unconfirmed')
    expect(scene.respond('POST', stop, {}).status).toBe(503)
    expect(scene.respond('GET', read).json).toMatchObject({ phase: 'stopped', active: false })
    expect(scene.writes).toHaveLength(2)
    expect(scene.respond('POST', '/api/rigs/other/alignment/stop', {}).status).toBe(501)
    expect(scene.unknownRequests).toHaveLength(1)
    const offline = createAlignmentScene('alignment-offline')
    expect([offline.respond('GET', read).status, offline.respond('GET', read).status, offline.respond('GET', read).status]).toEqual([200, 200, 503])
    offline.setReadFailure(null)
    expect(offline.respond('GET', read).status).toBe(200)
  })
})
