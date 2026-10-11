import { describe, expect, it } from 'vitest'
import * as alpaca from './index.js'
import {
  CaptureRetryableError,
  CaptureStoppedError,
  EquipmentError,
  FocuserStoppedError,
  FramingStoppedError,
} from '@vela/equipment'

describe('@vela/alpaca export boundary', () => {
  it('preserves adapter diagnostics while sharing workflow failure identities', () => {
    const error = new alpaca.AlpacaProviderError('Read failed', {
      reason: 'transport',
      endpoint: 'connected',
    })

    expect(error).toBeInstanceOf(EquipmentError)
    expect(error.name).toBe('AlpacaProviderError')
    const retryable = new alpaca.AlpacaCaptureRetryableError(error)

    expect(retryable).toBeInstanceOf(CaptureRetryableError)
    expect(retryable).toMatchObject({ name: 'AlpacaCaptureRetryableError', cause: error })
    expect(alpaca.AlpacaCaptureStoppedError).toBe(CaptureStoppedError)
    expect(alpaca.AlpacaFocuserStoppedError).toBe(FocuserStoppedError)
    expect(alpaca.AlpacaFramingStoppedError).toBe(FramingStoppedError)
  })

  it('exports only the normalized provider seam at runtime', () => {
    expect(Object.keys(alpaca).sort()).toEqual([
      'AlpacaCaptureRetryableError',
      'AlpacaCaptureStoppedError',
      'AlpacaDiscoveryError',
      'AlpacaFocuserStoppedError',
      'AlpacaFramingStoppedError',
      'AlpacaProviderError',
      'createAlpacaAcquisition',
      'createAlpacaCameraCooling',
      'createAlpacaDiscovery',
      'createAlpacaFocuser',
      'createAlpacaFraming',
      'createAlpacaMountControl',
      'createAlpacaProvider',
    ])
  })
})
