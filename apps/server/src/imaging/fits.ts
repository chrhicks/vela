import { setImmediate } from 'node:timers/promises'
import type { ExposureSettings, MountPointing } from '@vela/equipment'
import type { CaptureImage, FrameType } from '@vela/model/web'
import { fromMount, toMount, type EquatorialPosition, type Site } from '@vela/rig-sky'
import { localSiderealDegrees } from '../alignment/physical-coordinates.js'
import { carriesFilter, imageTypeKeyword } from './frame-type.js'
import type { ImageColor } from './preview.js'

/** What a frame was taken with: the camera and mount as read, plus the rig's optics. */
export interface FrameSettings extends ExposureSettings {
  /** Effective focal length of the rig's optics, in millimetres. */
  focalLengthMm?: number
}

/** Export acquisition samples without stretching, calibration, or row reversal. */
export async function encodeCaptureFits(
  frame: {
    width: number
    height: number
    pixels: ArrayLike<number>
    capturedAt: string
    capturedAtSource?: CaptureImage['capturedAtSource']
    color?: ImageColor
  },
  metadata: {
    exposureSeconds: number
    cameraName: string
    frameType?: FrameType
    /** The subject's name. Only a light frame carries one. */
    objectName?: string | undefined
    /** The filter name Chris said was in place. Only a light or a flat carries one; null or absent leaves the key out. */
    filterName?: string | null | undefined
    /** Absent keys are left out of the header, never defaulted. */
    settings?: FrameSettings
  },
): Promise<Buffer> {
  const { width, height, pixels } = frame

  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    pixels.length !== width * height
  ) {
    throw new Error('Cannot export FITS: image dimensions do not match its samples')
  }

  const start = new Date(frame.capturedAt)

  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(metadata.exposureSeconds) ||
    metadata.exposureSeconds < 0
  ) {
    throw new Error('Cannot export FITS: invalid exposure metadata')
  }

  let unsigned16 = true

  for (let begin = 0; begin < pixels.length; begin += 65_536) {
    const end = Math.min(begin + 65_536, pixels.length)

    for (let i = begin; i < end; i++) {
      const value = pixels[i]!

      if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
        throw new Error('Cannot export FITS: samples must be signed 32-bit integers')
      }

      if (value < 0 || value > 65_535) unsigned16 = false
    }

    await setImmediate()
  }

  const bytesPerSample = unsigned16 ? 2 : 4

  const cards = [
    card('SIMPLE', 'T'.padStart(20)),
    numberCard('BITPIX', bytesPerSample * 8),
    numberCard('NAXIS', 2),
    numberCard('NAXIS1', width),
    numberCard('NAXIS2', height),
    textCard('DATE-OBS', start.toISOString()),
    numberCard('EXPTIME', metadata.exposureSeconds),
    textCard('IMAGETYP', imageTypeKeyword[metadata.frameType ?? 'light']),
    textCard('INSTRUME', metadata.cameraName),
    textCard('ROWORDER', 'TOP-DOWN'),
  ]

  if (unsigned16) cards.push(numberCard('BZERO', 32_768), numberCard('BSCALE', 1))

  if (frame.capturedAtSource === 'server-estimate') {
    cards.push(textCard('TIMESRC', 'SERVER-ESTIMATE'))
    cards.push('COMMENT DATE-OBS estimated from server UTC before StartExposure.'.padEnd(80))
  }

  // The acquisition adapter already shifts this pattern to the image origin.
  if (frame.color?.kind === 'bayer')
    cards.push(textCard('BAYERPAT', frame.color.pattern.toUpperCase()))
  cards.push(...settingCards(metadata))
  cards.push(...pointingCards(start, metadata))
  cards.push('END'.padEnd(80))

  const header = Buffer.from(
    cards.join('').padEnd(Math.ceil((cards.length * 80) / 2880) * 2880),
    'ascii',
  )

  const result = Buffer.alloc(
    header.length + Math.ceil((pixels.length * bytesPerSample) / 2880) * 2880,
  )

  header.copy(result)

  for (let begin = 0; begin < pixels.length; begin += 65_536) {
    const end = Math.min(begin + 65_536, pixels.length)

    for (let i = begin; i < end; i++) {
      const value = pixels[i]!

      if (unsigned16) result.writeInt16BE(value - 32_768, header.length + i * 2)
      else result.writeInt32BE(value, header.length + i * 4)
    }

    await setImmediate()
  }

  return result
}

/**
 * The camera, optics, subject, filter and pier side, in the order stacking software expects to find them.
 */
function settingCards({
  frameType = 'light',
  objectName,
  filterName,
  settings = {},
}: {
  frameType?: FrameType
  objectName?: string | undefined
  filterName?: string | null | undefined
  settings?: FrameSettings
}) {
  const numbers: ReadonlyArray<readonly [string, number | undefined]> = [
    ['GAIN', settings.gain],
    ['OFFSET', settings.offset],
    ['XBINNING', settings.binX],
    ['YBINNING', settings.binY],
    ['XPIXSZ', settings.pixelWidthMicrons],
    ['YPIXSZ', settings.pixelHeightMicrons],
    ['CCD-TEMP', settings.sensorTemperatureC],
    ['SET-TEMP', settings.setpointC],
    ['FOCALLEN', settings.focalLengthMm],
  ]

  const cards = numbers.flatMap(([key, value]) =>
    value !== undefined && Number.isFinite(value) ? [numberCard(key, value)] : [],
  )

  if (frameType === 'light' && objectName?.trim()) cards.push(textCard('OBJECT', objectName.trim()))

  if (carriesFilter(frameType) && filterName?.trim()) cards.push(textCard('FILTER', filterName.trim()))

  if (settings.pierSide) cards.push(textCard('PIERSIDE', settings.pierSide.toUpperCase()))

  return cards
}

/**
 * Where and when a light frame was taken, at the exposure midpoint: DATE-AVG, the site, local sidereal
 * time, J2000 RA and DEC, and hour angle (west positive). The mount is read right after the exposure,
 * so the pointing counts only while it tracked and did not slew. A value that cannot be stated leaves
 * its card out. Processed images Chris publishes are stripped of these elsewhere.
 */
function pointingCards(
  start: Date,
  { frameType = 'light', exposureSeconds, settings = {} }: { frameType?: FrameType; exposureSeconds: number; settings?: FrameSettings },
) {
  const { mount } = settings
  const site = mount?.site && validSite(mount.site)

  if (frameType !== 'light' || !mount || !site) return []

  const midpoint = new Date(start.getTime() + exposureSeconds * 500)
  const lst = localSiderealDegrees(midpoint, site)

  const cards = [
    textCard('DATE-AVG', midpoint.toISOString()),
    numberCard('SITELAT', site.latitudeDegrees),
    numberCard('SITELONG', site.longitudeDegrees),
    ...(site.elevationMeters === undefined ? [] : [numberCard('SITEELEV', site.elevationMeters)]),
    numberCard('LST', lst / 15, 'hours'),
  ]

  const pointed = pointedAt(mount, midpoint, site)

  if (pointed) {
    cards.push(numberCard('RA', pointed.j2000.raDegrees), numberCard('DEC', pointed.j2000.decDegrees))
    cards.push(numberCard('HA', hourAngleHours(lst, pointed.ofDate.raDegrees), 'hours'))
  }

  return cards
}

function validSite(site: NonNullable<MountPointing['site']>): Site | undefined {
  const { latitudeDegrees, longitudeDegrees, elevationMeters } = site

  return Number.isFinite(latitudeDegrees) &&
    Math.abs(latitudeDegrees) <= 90 &&
    Number.isFinite(longitudeDegrees) &&
    Math.abs(longitudeDegrees) <= 180 &&
    (elevationMeters === undefined || Number.isFinite(elevationMeters))
    ? site
    : undefined
}

function pointedAt(mount: MountPointing, midpoint: Date, site: Site) {
  const read: EquatorialPosition = { raDegrees: mount.rightAscensionDegrees, decDegrees: mount.declinationDegrees }

  if (
    !mount.tracking ||
    mount.slewing ||
    !Number.isFinite(read.raDegrees) ||
    read.raDegrees < 0 ||
    read.raDegrees >= 360 ||
    !Number.isFinite(read.decDegrees) ||
    Math.abs(read.decDegrees) > 90
  )
    return undefined

  return mount.coordinateSystem === 'j2000'
    ? { j2000: read, ofDate: toMount(read, 'topocentric', midpoint, site) }
    : { j2000: fromMount(read, 'topocentric', midpoint, site), ofDate: read }
}

/** Local sidereal time minus right ascension, in hours, wrapped into (-12, 12]. */
function hourAngleHours(lstDegrees: number, raDegrees: number) {
  const hours = ((((lstDegrees - raDegrees) / 15) % 24) + 24) % 24

  return hours > 12 ? hours - 24 : hours
}

function textCard(key: string, value: string) {
  // FITS headers are ASCII. Escape apostrophes before fitting the value to one card.
  let text = ''

  for (const character of value.replace(/[^\x20-\x7e]/g, '?')) {
    const next = character === "'" ? "''" : character

    if (text.length + next.length > 68) break
    text += next
  }

  return card(key, `'${text}'`)
}

function numberCard(key: string, value: number, unit?: string) {
  const text = String(value).toUpperCase().padStart(20)

  return card(key, unit === undefined ? text : `${text} / ${unit}`)
}

function card(key: string, encoded: string) {
  return `${key.padEnd(8)}= ${encoded}`.padEnd(80)
}
