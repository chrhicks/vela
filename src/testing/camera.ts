import { makeCapture, type CaptureSettings } from '../capture/run.ts'
import type { RunEvent } from '../capture/events.ts'
import type { ActiveRecord, RunFile } from '../capture/runfile.ts'
import { makeSender } from '../commands/sender.ts'
import { makePicture } from '../rig/picture.ts'
import type { Entry, Value } from '../stream/entry.ts'
import { connected, indiserver, startedAt, wire } from './entries.ts'

export type Exposure = 'file' | 'alert' | 'nothing' | 'retry'

export interface Sent {
  readonly property: string
  readonly values: Readonly<Record<string, Value>>
}

export interface CameraScript {
  readonly exposures: Exposure[]
  readonly refuse: Map<string, string>
  readonly silent: Set<string>
  readonly ignore: Set<string>
  readonly sent: Sent[]
}

const baseline: ReadonlyArray<readonly [string, Readonly<Record<string, Value>>, string]> = [
  ['CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 0 }, 'Idle'],
  ['CCD_FILE_PATH', { FILE_PATH: '' }, 'Idle'],
  ['UPLOAD_MODE', { UPLOAD_CLIENT: false, UPLOAD_LOCAL: true, UPLOAD_BOTH: false }, 'Ok'],
  ['UPLOAD_SETTINGS', { UPLOAD_DIR: '/home/example', UPLOAD_PREFIX: 'IMAGE_XXX' }, 'Ok'],
  ['CCD_FRAME_TYPE', { FRAME_LIGHT: true, FRAME_BIAS: false, FRAME_DARK: false, FRAME_FLAT: false }, 'Ok'],
  ['CCD_CONTROLS', { Gain: 100, Offset: 50 }, 'Ok'],
  ['CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: 27 }, 'Ok'],
  ['CCD_COOLER', { COOLER_ON: false, COOLER_OFF: true }, 'Ok'],
]

export const spoolDir = '/spool'

export const fastSettings: CaptureSettings = { device: 'primary', spoolDir, settleMs: 60, exposureSilenceMs: 40, failuresInRow: 3, silenceMs: 60_000 }

export function fakeCamera(options: { exposures?: Exposure[]; settings?: Partial<CaptureSettings>; omit?: string[] } = {}) {
  const picture = makePicture()
  const events: RunEvent[] = []
  const script: CameraScript = { exposures: options.exposures ?? [], refuse: new Map(), silent: new Set(), ignore: new Set(), sent: [] }
  const files = new Set<string>()
  let tick = 0
  let ids = 0
  let fileNumber = 0
  let recorded: Partial<ActiveRecord> | undefined

  const runFile: RunFile = {
    read: () => recorded,
    write: record => {
      recorded = record
    },
    clear: () => {
      recorded = undefined
    },
  }

  const feed = (entry: Entry) => {
    picture.apply(entry, Date.now())
    sender.answered(entry)
    capture.observe(entry)
  }

  const set = (property: string, values: Readonly<Record<string, Value>>, state = 'Ok') => feed(wire(startedAt + (tick += 1), 'set', 'primary', property, values, state))

  const answer = (id: string, property: string, result: 'written' | 'refused', reason?: string) =>
    feed({ id: `client:${id}`, kind: 'client.command', at: startedAt + (tick += 1), run: 'run-a', body: { id, by: 'vela', device: 'primary', property, result, ...(reason === undefined ? {} : { reason }) } })

  function expose() {
    const behaviour = script.exposures.shift() ?? 'file'

    if (behaviour === 'nothing') return

    set('CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 1 }, 'Busy')

    if (behaviour === 'retry') {
      const timeLeft = [0.5, 1, 0.5]

      timeLeft.forEach((left, index) => setTimeout(() => set('CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: left }, 'Busy'), 20 * (index + 1)))
    }

    setTimeout(() => {
      if (behaviour === 'alert') {
        set('CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 0 }, 'Alert')

        return
      }

      const prefix = String(picture.property('primary', 'UPLOAD_SETTINGS')?.values['UPLOAD_PREFIX'])
      const path = `${spoolDir}/${prefix.replace('XXX', String((fileNumber += 1)).padStart(3, '0'))}.fits`

      files.add(path)
      set('CCD_FILE_PATH', { FILE_PATH: path }, 'Ok')
      set('CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 0 }, 'Ok')
    }, behaviour === 'retry' ? 80 : 2)
  }

  function handle(payload: string) {
    const command = JSON.parse(payload) as { id: string; property: string; values: Record<string, Value> }

    script.sent.push({ property: command.property, values: command.values })

    if (script.silent.has(command.property)) return

    setTimeout(() => {
      const refusal = script.refuse.get(command.property)

      if (refusal !== undefined) return answer(command.id, command.property, 'refused', refusal)

      answer(command.id, command.property, 'written')

      if (command.property === 'CCD_EXPOSURE') return expose()
      if (command.property === 'CCD_ABORT_EXPOSURE') return set('CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 0 }, 'Idle')
      if (command.property === 'CCD_TEMPERATURE' || script.ignore.has(command.property)) return

      set(command.property, command.values)
    }, 1)
  }

  const sender = makeSender({ publish: (_subject, payload) => handle(payload), newId: () => `vela-${(ids += 1)}`, answerTimeoutMs: 30, by: 'vela' })

  const capture = makeCapture({
    picture,
    sender,
    settings: { ...fastSettings, ...options.settings },
    runFile,
    now: Date.now,
    newRunId: () => 'run-1',
    emit: event => void events.push(event),
    onChange: () => undefined,
  })

  feed(connected(startedAt))
  feed(indiserver(startedAt + 1, 'connected'))

  for (const [property, values, state] of baseline) if (!(options.omit ?? []).includes(property)) feed(wire(startedAt + (tick += 2), 'def', 'primary', property, values, state))

  picture.caughtUp()

  return { picture, capture, script, events, files, runFile, plantRunFile: (record: Partial<ActiveRecord>) => void (recorded = record), feed, set }
}

export const request = { object: 'M 31', frameType: 'dark', exposureSeconds: 0.01, count: 3, gain: 200, offset: 50, cooler: 'on', setpoint: -10 }
