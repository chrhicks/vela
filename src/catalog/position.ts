import type { CatalogRow } from './types.ts'

export interface Position {
  readonly raDegrees: number
  readonly decDegrees: number
}

const separators = /[hHdDmMsS°′″'":,]/g

const isNumber = (token: string) => /^[+-]?\d+(\.\d+)?$/.test(token)

function sexagesimal(parts: ReadonlyArray<string>) {
  const [whole, minutes, seconds] = parts.map(Number) as [number, number, number]

  if (minutes >= 60 || seconds >= 60 || minutes < 0 || seconds < 0) return undefined

  const size = Math.abs(whole) + minutes / 60 + seconds / 3600

  return parts[0]!.startsWith('-') ? -size : size
}

export function parsePosition(text: string): Position | undefined {
  const tokens = text.trim().replace(separators, ' ').split(/\s+/).filter(token => token !== '')

  if (tokens.length === 0 || !tokens.every(isNumber)) return undefined

  let position: Position | undefined

  if (tokens.length === 6) {
    const raHours = sexagesimal(tokens.slice(0, 3))
    const decDegrees = sexagesimal(tokens.slice(3))

    if (raHours === undefined || decDegrees === undefined || raHours < 0) return undefined

    position = { raDegrees: raHours * 15, decDegrees }
  } else if (tokens.length === 2) {
    const [ra, dec] = tokens.map(Number) as [number, number]

    position = { raDegrees: /[hH]/.test(text) ? ra * 15 : ra, decDegrees: dec }
  }

  if (position === undefined || position.raDegrees < 0 || position.raDegrees >= 360 || Math.abs(position.decDegrees) > 90) return undefined

  return position
}

function split(value: number, places: number) {
  const total = Math.round(Math.abs(value) * 3600)
  const pad = (part: number) => String(part).padStart(2, '0')

  return [String(Math.floor(total / 3600)).padStart(places, '0'), pad(Math.floor((total % 3600) / 60)), pad(total % 60)]
}

export function positionName({ raDegrees, decDegrees }: Position) {
  const [hours, raMinutes, raSeconds] = split(raDegrees / 15, 2)
  const [degrees, decMinutes, decSeconds] = split(decDegrees, 2)

  return `${hours}h${raMinutes}m${raSeconds}s ${decDegrees < 0 ? '-' : '+'}${degrees}°${decMinutes}′${decSeconds}″`
}

export function positionRow(text: string): CatalogRow | undefined {
  const position = parsePosition(text)

  if (position === undefined) return undefined

  const id = `${position.raDegrees.toFixed(6)} ${position.decDegrees < 0 ? '' : '+'}${position.decDegrees.toFixed(6)}`

  return [id, positionName(position), null, [], position.raDegrees, position.decDegrees, 'J2000 position', null, null, null]
}
