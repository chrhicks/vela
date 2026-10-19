/** The few pieces of INDI's XML the packager reads. Cria's recorder stores each message as the text it saw. */
const entities = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
])

const decode = (text: string) => text.replaceAll(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => entities.get(name) ?? '')

export const attributesOf = (text: string) => Object.fromEntries([...text.matchAll(/([\w.:-]+)="([^"]*)"/g)].map(([, name = '', value = '']) => [name, decode(value)]))

/** The elements of one INDI vector: `<oneNumber name="RA">1.5</oneNumber>` and the like. A BLOB element holds its size. */
export function elementsOf(xml: string) {
  const elements: Record<string, string> = {}

  for (const [, tag = '', attributes = '', body = ''] of xml.matchAll(/<((?:one|def)(?:Number|Text|Switch|Light|BLOB))\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
    const { name, size } = attributesOf(attributes)

    if (name !== undefined) elements[name] = tag.endsWith('BLOB') ? (size ?? '') : decode(body.trim())
  }

  return elements
}
