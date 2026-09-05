import { describe, expect, it } from 'vitest'
import * as alpaca from './index.js'

describe('@vela/alpaca export boundary', () => {
  it('exports only the normalized provider seam at runtime', () => {
    expect(Object.keys(alpaca).sort()).toEqual([
      'AlpacaDiscoveryError',
      'AlpacaProviderError',
      'createAlpacaAcquisition',
      'createAlpacaDiscovery',
      'createAlpacaProvider',
    ])
  })
})
