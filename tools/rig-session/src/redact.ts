/**
 * What a package never holds: the observing site and serial port paths. A package is shared in
 * conversation, so anything that could name where the rig stands or what is plugged into it is
 * replaced here, once, before a value reaches a table.
 */
export const redacted = '[redacted]'

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
