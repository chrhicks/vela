import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { scrubFile } from './scrub.ts'
import { committedFixtures, scrubRepository } from './scrub-repository.ts'

const card = (text: string) => text.padEnd(80, ' ')

function fits(...cards: string[]): Buffer {
  const header = [card('SIMPLE  =                    T'), ...cards.map(card), card('END')].join('')

  return Buffer.concat([Buffer.from(header.padEnd(2880, ' '), 'latin1'), Buffer.alloc(2880)])
}

const scrub = (path: string, text: string | Buffer) => scrubFile(path, Buffer.from(text)).map(finding => `${finding.line} ${finding.rule}`)

test('INDI site elements and latitude or longitude fields are flagged unless they are a made-up site', () => {
  const real = '<defNumberVector device="M" name="GEOGRAPHIC_COORD"><defNumber name="LAT">12.5</defNumber><defNumber name="LONG">250.25</defNumber></defNumberVector>'
  const fake = '<defNumberVector device="M" name="GEOGRAPHIC_COORD"><defNumber name="LAT">33.45</defNumber><defNumber name="LONG">247.93</defNumber></defNumberVector>'

  expect(scrub('t.xml', `${fake}\n${real}`)).toEqual(['2 indi-site'])
  expect(scrub('t.txt', 'sent GEOGRAPHIC_COORD LAT=33.45 LONG=247.93 ELEV=0\nsent GEOGRAPHIC_COORD LAT=12.5 LONG=250.25')).toEqual(['2 indi-site'])
  expect(scrub('t.json', '{ "latitudeDegrees": 33.45, "longitudeDegrees": -112.07 }\n{ "latitudeDegrees": 12.5 }\n{ "longitudeDegrees": 250.25 }')).toEqual(['2 site-coordinate', '3 site-coordinate'])
  expect(scrub('t.json', '{ "latitudeDegrees": 10, "longitudeDegrees": 20 }')).toEqual([])
})

test('a serial path is flagged unless it is a placeholder committed on purpose', () => {
  expect(scrub('t.json', '"port": "/dev/serial/by-id/usb-ZWO_Systems_ZWO_Device_123456-if00"')).toEqual([])
  expect(scrub('t.json', '"port": "/dev/serial/by-id/usb-ZWO_Systems_ZWO_Device_A1B2C3D4E5-if00"')).toEqual(['1 serial-by-id'])
})

test('FITS location cards are flagged by card number, in a real header and in header text', () => {
  expect(scrub('t.fits', fits('EXPTIME =                  1.0', 'SITELAT = 12.5', 'OBJCTRA = 00 42 44'))).toEqual(['3 fits-location-card', '4 fits-location-card'])
  expect(scrub('t.fits', fits('EXPTIME =                  1.0'))).toEqual([])
  expect(scrub('t.json', '{ "header": "SITELONG = -100.25 / site longitude" }')).toEqual(['1 fits-location-card'])
  expect(scrub('t.json', '{ "header": "EXPTIME = 1.0" }')).toEqual([])
})

test('a mount log that pairs UTC with local sidereal time is flagged when the time implies a longitude other than a made-up one', () => {
  const log = (longitude: number) => {
    const at = Date.UTC(2030, 0, 1, 3)
    const days = at / 86_400_000 + 2440587.5 - 2451545.0
    const sidereal = (((18.697374558 + 24.06570982441908 * days + longitude / 15) % 24) + 24) % 24

    return `utc,ra_h,lst_h\n2030-01-01T03:00:00,1.5,${sidereal}\n`
  }

  expect(scrub('mount.csv', log(-112.07))).toEqual([])
  expect(scrub('mount.csv', log(20))).toEqual([])
  expect(scrub('mount.csv', log(-100.25))).toEqual(['2 implied-site-longitude'])
  expect(scrub('other.csv', 'a,b\n1,2\n')).toEqual([])
})

test('a finding names the file, line and rule but never the value it found', () => {
  const findings = scrubFile('t.json', Buffer.from('{ "latitudeDegrees": 12.3456 }'))

  expect(findings).toEqual([{ path: 't.json', line: 1, rule: 'site-coordinate' }])
  expect(JSON.stringify(findings)).not.toContain('12.3456')
})

test('fixtures are the tracked data files, not source and not images', () => {
  expect(committedFixtures(['a/fixtures/x.json', 'a/b.test.ts', 'rec/traffic.jsonl', 'f.fits', 'a/fixtures/p.png', 'pnpm-lock.yaml', 'x/y.golden.json', 'src/index.ts'])).toEqual([
    'a/fixtures/x.json',
    'rec/traffic.jsonl',
    'f.fits',
    'x/y.golden.json',
  ])
})

const roots: string[] = []

afterEach(() => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function repository(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'scrub-'))

  roots.push(root)
  execFileSync('git', ['-C', root, 'init', '-q'])

  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }

  execFileSync('git', ['-C', root, 'add', '-A'])

  return root
}

test('a committed fixture that holds a real site fails the scrub of its repository, and a clean one does not', async () => {
  const clean = await repository({ 'fixtures/ok.json': '{ "latitudeDegrees": 10, "longitudeDegrees": 20 }' })

  expect(scrubRepository(clean)).toMatchObject({ scanned: ['fixtures/ok.json'], findings: [], staleExceptions: [] })

  const bad = await repository({
    'fixtures/ok.json': '{ "latitudeDegrees": 10 }',
    'fixtures/site.fits': fits('SITELAT = 12.5'),
    'tapes/night/traffic.jsonl': '{"xml":"<oneNumber name=\\"LONG\\">250.25</oneNumber>"}',
  })

  expect(scrubRepository(bad).findings).toEqual([
    { path: 'fixtures/site.fits', line: 2, rule: 'fits-location-card' },
    { path: 'tapes/night/traffic.jsonl', line: 1, rule: 'indi-site' },
  ])
})

test('no committed fixture of this repository holds a real site, a location card or a serial path, and every known exception still applies', () => {
  const report = scrubRepository(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'))

  expect(report.scanned.length).toBeGreaterThan(10)
  expect(report.findings).toEqual([])
  expect(report.staleExceptions).toEqual([])
})
