import { describe, expect, it } from 'vitest'
import { layerChips, layersAtStart, toggled } from './horizon-layers.ts'

describe('the layers of the horizon chart', () => {
  it('start with the Moon on', () => {
    expect([...layersAtStart()]).toEqual(['moon'])
  })

  it('has a chip for each layer, lettered as in the sketch', () => {
    expect(layerChips).toEqual([{ layer: 'moon', letter: 'E', label: 'Moon' }])
  })

  it('turns a layer off and on without changing the set it was given', () => {
    const on = layersAtStart()
    const off = toggled(on, 'moon')

    expect([...off]).toEqual([])
    expect([...on]).toEqual(['moon'])
    expect([...toggled(off, 'moon')]).toEqual(['moon'])
  })
})
