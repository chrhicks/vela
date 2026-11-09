import { Schema } from 'effect'
import { decodeConfig } from '../config.ts'

export const frameTypes = ['light', 'dark', 'flat', 'bias'] as const

export type FrameType = (typeof frameTypes)[number]

export const frameTypeElement: Readonly<Record<FrameType, string>> = {
  light: 'FRAME_LIGHT',
  dark: 'FRAME_DARK',
  flat: 'FRAME_FLAT',
  bias: 'FRAME_BIAS',
}

const nonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

export const CaptureRequest = Schema.Struct({
  object: Schema.String,
  frameType: Schema.Literals(frameTypes),
  exposureSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
  count: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  gain: nonNegative,
  offset: nonNegative,
  cooler: Schema.Literals(['keep', 'on', 'off']),
  setpoint: Schema.optionalKey(Schema.Finite),
})

export type CaptureRequest = typeof CaptureRequest.Type

export function sequenceName(object: string, frameType: FrameType) {
  const safe = object.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  return safe === '' ? undefined : `${safe}_${frameType}`
}

export type Parsed = { readonly ok: true; readonly request: CaptureRequest; readonly sequence: string } | { readonly ok: false; readonly reason: string }

export function parseRequest(json: unknown): Parsed {
  let request: CaptureRequest

  try {
    request = decodeConfig(CaptureRequest, json)
  } catch (error) {
    return { ok: false, reason: `not a capture request: ${error instanceof Error ? error.message : String(error)}` }
  }

  const sequence = sequenceName(request.object, request.frameType)

  if (sequence === undefined) return { ok: false, reason: 'the object name has no letters or digits to name the files by' }
  if (request.cooler === 'on' && request.setpoint === undefined) return { ok: false, reason: 'a setpoint is needed when the cooler is on' }

  return { ok: true, request, sequence }
}
