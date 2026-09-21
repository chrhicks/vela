import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capturePreviews } from './legacy-preview.js'
import { corpus } from './corpus.js'
import { readFrame } from './read-frame.js'
import { neutralPreviews } from './treatment.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const output = resolve(root, 'apps/workshop/.local/preview-color')

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

const rig = hash('348c775f-d075-4cfe-90a3-b8e74d84b244')

const manifest = []

await mkdir(output, { recursive: true })

for (const fixture of corpus) {
  const source = fixture.source ?? `saved-images/${rig}/${hash(fixture.id)}/original.fits`
  const path = resolve(root, 'data', source)
  const original = await readFile(path)
  const sha256 = hash(original)
  const siblings = 'source' in fixture ? [] : ['preview.png', 'fit.png', 'metadata.json']
  const retainedHashes = await Promise.all(siblings.map(async name => ({ name, sha256: hash(await readFile(resolve(dirname(path), name))) })))
  const frame = readFrame(original)
  const current = await capturePreviews(frame.width, frame.height, frame.pixels, frame.color)
  const neutral = await neutralPreviews(frame)

  for (const [treatment, images] of [['current', current], ['neutral', neutral]] as const) {
    await writeFile(resolve(output, `${fixture.key}-${treatment}-native.png`), images.native)
    await writeFile(resolve(output, `${fixture.key}-${treatment}-fit.png`), images.fit ?? images.native)
  }

  if (hash(await readFile(path)) !== sha256) throw new Error(`Original changed: ${fixture.key}`)

  for (const retained of retainedHashes) {
    if (hash(await readFile(resolve(dirname(path), retained.name))) !== retained.sha256) throw new Error(`Retained artifact changed: ${retained.name}`)
  }

  const entry = { ...fixture, source, sha256, retainedHashes, width: frame.width, height: frame.height, color: frame.color, range: neutral.range, estimate: neutral.estimate }
  manifest.push(entry)
  console.log(fixture.key, JSON.stringify(neutral.estimate), sha256)
}

await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ renderer: 'background-offset-v1-workshop', baseline: '59fa6da', fixtures: manifest }, null, 2))
