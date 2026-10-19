import { z } from 'zod'

/**
 * What a package never holds: the observing site and serial port paths. A package is shared in
 * conversation, so anything that could name where the rig stands or what is plugged into it is
 * replaced here, once, before a value reaches a table.
 */
export const redacted = '[redacted]'

/** INDI properties whose values name the site or the hardware. Their values are never exported. */
const privateProperties = new Set(['GEOGRAPHIC_COORD', 'DEVICE_PORT', 'SYSTEM_PORTS'])

const privateKey = /^(site|latitude|longitude|elevation|port|serial)/i

export function isPrivateProperty(name: string): boolean {
  return privateProperties.has(name)
}

/** A driver announcing the site in words ("Observer location updated: Latitude ... Longitude ...") has no safe part to keep. */
const namesTheSite = /\b(latitude|longitude|observer location|geographic)/i

/**
 * Free text with `LAT=`/`LONG=`/`ELEV=` pairs and `/dev/` paths replaced. A text that names the site
 * in words is replaced whole, because its numbers come in too many shapes (degrees, sexagesimal, decimal).
 */
export function redactText(text: string): string {
  if (namesTheSite.test(text)) return `${redacted} (names the site)`

  return text.replaceAll(/\b(LAT|LONG|ELEV)=\S+/g, `$1=${redacted}`).replaceAll(/\/dev\/\S+/g, redacted)
}

export type Json = z.infer<ReturnType<typeof z.json>>

/** `value` with the values of site and port keys, and the site in strings, replaced. */
export function redactedJson(value: Json, key = ''): Json {
  if (privateKey.test(key)) return redacted

  const text = z.string().safeParse(value)

  if (text.success) return redactText(text.data)

  const list = z.array(z.json()).safeParse(value)

  if (list.success) return list.data.map(item => redactedJson(item))

  const object = z.record(z.string(), z.json()).safeParse(value)

  if (object.success) return Object.fromEntries(Object.entries(object.data).map(([name, inner]) => [name, redactedJson(inner, name)]))

  return value
}
