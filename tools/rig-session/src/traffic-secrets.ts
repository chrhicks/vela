import { Secrets } from './sanitize.ts'
import { attributesOf, elementsOf } from './wire.ts'

const mayHoldASecret = /GEOGRAPHIC_COORD|DEVICE_PORT|SYSTEM_PORTS|serial|\/dev\//i

/**
 * Learns what one INDI message says that a package must not: the site (`GEOGRAPHIC_COORD`), the ports
 * (`DEVICE_PORT`, `SYSTEM_PORTS`, any `/dev/` path) and device serial numbers (an element or a property
 * named like one). Nothing here decides what is exported; `Secrets` replaces what was learned wherever it occurs.
 */
export function learnFromMessage(xml: string, secrets: Secrets): void {
  if (!mayHoldASecret.test(xml)) return

  const { name = '' } = attributesOf(/^\s*<\w+\b([^>]*?)\/?>/.exec(xml)?.[1] ?? '')
  const elements = elementsOf(xml)

  if (name === 'GEOGRAPHIC_COORD') {
    for (const [element, kind] of [['LAT', 'latitude'], ['LONG', 'longitude'], ['ELEV', 'elevation']] as const) {
      const value = elements[element]

      if (value !== undefined && value.trim() !== '') secrets.addCoordinate(kind, Number(value))
    }
  } else if (name === 'DEVICE_PORT') {
    for (const value of Object.values(elements)) secrets.addLiteral(value)
  } else if (name === 'SYSTEM_PORTS') {
    for (const [element, value] of Object.entries(elements)) {
      secrets.addLiteral(element)
      secrets.addLiteral(value)
    }
  }

  for (const [element, value] of Object.entries(elements)) {
    if (/serial/i.test(element) || /serial/i.test(name)) secrets.addLiteral(value)
  }

  for (const [path] of xml.matchAll(/\/dev\/[^\s"'<>,;)]+/g)) secrets.addLiteral(path)
}
