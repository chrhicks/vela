import { describe, expect, it } from 'vitest'
import { epochMs } from '@vela/rig-events'
import { closeEpoch, currentEpoch, epochContaining, forgetBefore, noEpochs, openEpoch } from '@vela/rig-model'

const at = (offset: number) => epochMs(1_000_000 + offset)

describe('epochs', () => {
  it('numbers them in order and keeps one open at a time', () => {
    const first = openEpoch(noEpochs, at(0))

    expect(openEpoch(first, at(5))).toBe(first)

    const second = openEpoch(closeEpoch(first, at(10)), at(20))

    expect(second.list.map(epoch => epoch.id)).toEqual([1, 2])
    expect(currentEpoch(second)?.from).toBe(at(20))
  })

  it('holds an exposure only if no break falls inside it', () => {
    const epochs = openEpoch(closeEpoch(openEpoch(noEpochs, at(0)), at(100)), at(150))

    expect(epochContaining(epochs, at(10), at(90))?.id).toBe(1)
    expect(epochContaining(epochs, at(90), at(110))).toBeNull()
    expect(epochContaining(epochs, at(110), at(140))).toBeNull()
    expect(epochContaining(epochs, at(160), at(900))?.id).toBe(2)
    expect(epochContaining(epochs, at(-10), at(50))).toBeNull()
  })

  it('never closes an epoch before it began', () => {
    expect(closeEpoch(openEpoch(noEpochs, at(50)), at(10)).list[0]?.to).toBe(at(50))
  })

  it('forgets closed epochs but keeps the newest so numbering goes on', () => {
    const epochs = openEpoch(closeEpoch(openEpoch(noEpochs, at(0)), at(100)), at(150))
    const trimmed = forgetBefore(closeEpoch(epochs, at(200)), at(500))

    expect(trimmed.list.map(epoch => epoch.id)).toEqual([2])
    expect(openEpoch(trimmed, at(600)).list.at(-1)?.id).toBe(3)
  })
})
