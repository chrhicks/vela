import type { Property } from '../rig/picture.ts'
import type { Value } from '../stream/entry.ts'
import { frameTypeElement, type CaptureRequest } from './request.ts'

export type Read = (property: string) => Property | undefined

export interface Wanted {
  readonly frameElement: string
  readonly gain: number
  readonly offset: number
  readonly cooler: CaptureRequest['cooler']
  readonly setpoint: number | undefined
  readonly uploadDir: string
  readonly uploadPrefix: string
  readonly object: string | undefined
}

export interface Step {
  readonly property: string
  readonly values: Readonly<Record<string, Value>>
  readonly shows: ((read: Read) => boolean) | undefined
}

export type Plan = { readonly steps: ReadonlyArray<Step> } | { readonly missing: string }

export function wantedOf(request: CaptureRequest, sequence: string, uploadDir: string): Wanted {
  return {
    frameElement: frameTypeElement[request.frameType],
    gain: request.gain,
    offset: request.offset,
    cooler: request.cooler,
    setpoint: request.setpoint,
    uploadDir,
    uploadPrefix: `${sequence}_XXX`,
    object: request.frameType === 'light' ? request.object : undefined,
  }
}

const showing = (property: string, values: Readonly<Record<string, Value>>) => (read: Read) => {
  const shown = read(property)

  return shown !== undefined && Object.entries(values).every(([name, value]) => shown.values[name] === value)
}

const step = (property: string, values: Readonly<Record<string, Value>>, visible = true): Step => ({ property, values, shows: visible ? showing(property, values) : undefined })

export function stepsFor(read: Read, wanted: Wanted, first: boolean): Plan {
  const steps: Step[] = []

  if (read('FITS_HEADER') === undefined) return { missing: 'FITS_HEADER' }
  if (first) steps.push(step('FITS_HEADER', { KEYWORD_NAME: 'INDI_CLEAR', KEYWORD_VALUE: '', KEYWORD_COMMENT: '' }, false))
  if (wanted.object !== undefined) steps.push(step('FITS_HEADER', { KEYWORD_NAME: 'OBJECT', KEYWORD_VALUE: wanted.object, KEYWORD_COMMENT: '' }, false))

  if (wanted.cooler !== 'keep') {
    const cooler = read('CCD_COOLER')

    if (cooler === undefined) return { missing: 'CCD_COOLER' }

    const on = cooler.values['COOLER_ON'] === true

    if (wanted.cooler === 'on' && wanted.setpoint !== undefined) {
      if (read('CCD_TEMPERATURE') === undefined) return { missing: 'CCD_TEMPERATURE' }
      if (first || !on) steps.push(step('CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: wanted.setpoint }, false))
      if (!on) steps.push(step('CCD_COOLER', { COOLER_ON: true, COOLER_OFF: false }))
    } else if (wanted.cooler === 'off' && on) steps.push(step('CCD_COOLER', { COOLER_ON: false, COOLER_OFF: true }))
  }

  const frameType = read('CCD_FRAME_TYPE')

  if (frameType === undefined) return { missing: 'CCD_FRAME_TYPE' }
  if (frameType.values[wanted.frameElement] !== true) steps.push(step('CCD_FRAME_TYPE', { [wanted.frameElement]: true }))

  const controls = read('CCD_CONTROLS')

  if (controls === undefined) return { missing: 'CCD_CONTROLS' }

  const differing: Record<string, Value> = {}

  for (const [name, value] of [['Gain', wanted.gain], ['Offset', wanted.offset]] as const) {
    if (controls.values[name] === undefined) return { missing: `CCD_CONTROLS ${name}` }
    if (controls.values[name] !== value) differing[name] = value
  }

  if (Object.keys(differing).length > 0) steps.push(step('CCD_CONTROLS', differing))

  const upload = read('UPLOAD_SETTINGS')

  if (upload === undefined) return { missing: 'UPLOAD_SETTINGS' }

  const uploadDiffering: Record<string, Value> = {}

  for (const [name, value] of [['UPLOAD_DIR', wanted.uploadDir], ['UPLOAD_PREFIX', wanted.uploadPrefix]] as const) {
    if (upload.values[name] === undefined) return { missing: `UPLOAD_SETTINGS ${name}` }
    if (upload.values[name] !== value) uploadDiffering[name] = value
  }

  if (Object.keys(uploadDiffering).length > 0) steps.push(step('UPLOAD_SETTINGS', uploadDiffering))

  return { steps }
}
