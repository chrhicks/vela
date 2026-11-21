import { describe, expect, it } from 'vitest'
import { layerChips, layersAtStart, toggled } from './horizon-layers.ts'

describe('the layers of the horizon chart', () => {
  it('start with the frame, the clouds and the Moon on, and the shortlist and the tree map off', () => {
    expect([...layersAtStart()]).toEqual(['frame', 'clouds', 'moon'])
  })

  it('has a chip for each layer, lettered as in the sketch', () => {
    expect(layerChips).toEqual([
      { layer: 'frame', letter: 'A', label: 'Frame' },
      { layer: 'clouds', letter: 'B', label: 'Clouds' },
      { layer: 'shortlist', letter: 'C', label: 'Shortlist' },
      { layer: 'treemap', letter: 'D', label: 'Tree map' },
      { layer: 'moon', letter: 'E', label: 'Moon' },
    ])
  })

  it('turns a layer off and on without changing the set it was given', () => {
    const on = layersAtStart()
    const off = toggled(on, 'moon')

    expect([...off]).toEqual(['frame', 'clouds'])
    expect([...on]).toEqual(['frame', 'clouds', 'moon'])
    expect([...toggled(off, 'moon')]).toEqual(['frame', 'clouds', 'moon'])
  })
})
