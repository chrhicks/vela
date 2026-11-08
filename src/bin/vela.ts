import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { jetstream } from '@nats-io/jetstream'
import { runEntry, runSubject } from '../capture/events.ts'
import { makeRunFile } from '../capture/runfile.ts'
import { makeCapture } from '../capture/run.ts'
import { makeSender } from '../commands/sender.ts'
import { readConfig } from '../config.ts'
import { announcesFrame } from '../frames/announce.ts'
import { frameEntry, frameSubject } from '../frames/entry.ts'
import { makeKeeper } from '../frames/keeper.ts'
import { listNight, makePreviews } from '../frames/library.ts'
import { nightOf } from '../frames/night.ts'
import { makeSsh } from '../frames/ssh.ts'
import { makePointing } from '../pointing/pointing.ts'
import { makePrepare } from '../prepare/prepare.ts'
import { makeNight } from '../rig/night.ts'
import { makePicture } from '../rig/picture.ts'
import { makePage } from '../page/server.ts'
import { VelaSettings } from '../settings.ts'
import { readEntry } from '../stream/entry.ts'
import { followRig } from '../stream/follow.ts'

const settings = readConfig(VelaSettings, process.argv[2])
const frames = settings.frames
const naming = { zone: frames.nightZone, changesAtHour: frames.nightChangesAtHour }
const picture = makePicture()
const nightSettings = { devices: settings.devices, silenceMs: settings.silenceSeconds * 1000, focuserNudgeSteps: settings.prepare.focuserNudgeSteps }

function lost(reason: string): never {
  console.error(`vela: ${reason}`)
  process.exit(1)
}

const sender = makeSender({
  publish: (subject, payload) => following.connection.publish(subject, payload),
  rigRun: () => picture.rig()?.run,
  now: Date.now,
  newId: () => `vela-${randomUUID()}`,
  answerTimeoutMs: settings.capture.commandAnswerSeconds * 1000,
  by: 'vela',
})
const prepare = makePrepare({ picture, sender, settings: { focuser: settings.devices.focuser, box: settings.devices.box, focuserNudgeSteps: settings.prepare.focuserNudgeSteps } })
const pointing = makePointing({ picture, sender, settings: { mount: settings.devices.mount, searchResults: settings.pointing.searchResults }, now: Date.now })
const capture = makeCapture({
  picture,
  sender,
  settings: {
    device: settings.devices.primary,
    spoolDir: frames.spoolDir,
    settleMs: settings.capture.settleSeconds * 1000,
    exposureMarginMs: settings.capture.exposureMarginSeconds * 1000,
    failuresInRow: settings.capture.failuresInRow,
    silenceMs: settings.silenceSeconds * 1000,
  },
  runFile: makeRunFile(settings.capture.runFile),
  now: Date.now,
  newRunId: () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''),
  emit: event => {
    jetstream(following.connection)
      .publish(runSubject, JSON.stringify(runEntry(event, frames.rig, Date.now())))
      .catch((error: unknown) => console.error(`vela: could not publish the ${event.kind} entry of run ${event.run}: ${String(error)}`))
  },
  onChange: () => page.captureChanged(),
})
const page = makePage({
  night: () => makeNight(picture, nightSettings, Date.now()),
  refreshMs: settings.pageRefreshSeconds * 1000,
  frames: () => listNight(frames.keepDir, nightOf(Date.now(), naming)),
  preview: makePreviews(frames.keepDir, frames.preview).get,
  capture: { view: () => capture.view(), start: request => capture.start(request), stop: () => capture.stop() },
  prepare: request => prepare.act(request),
  pointing,
})

const keeper = makeKeeper({
  ssh: makeSsh(frames.host, frames.sshTimeoutSeconds * 1000),
  labelOf: capture.labelOf,
  settings: { spoolDir: frames.spoolDir, keepDir: frames.keepDir, naming, copyAttempts: frames.copyAttempts, copyRetryMs: frames.copyRetrySeconds * 1000 },
  now: Date.now,
  sleep: ms => sleep(ms),
  onKept: frame => {
    page.framesChanged()
    jetstream(following.connection)
      .publish(frameSubject, JSON.stringify(frameEntry(frame, frames.rig, Date.now())))
      .catch((error: unknown) => console.error(`vela: could not publish the entry for ${frame.file}: ${String(error)}`))
  },
  onProblem: message => console.error(`vela: ${message}`),
})

const following = await followRig({
  broker: settings.broker,
  readBatch: settings.historyReadBatch,
  onMessage: message => {
    const entry = readEntry(message.text)

    if (entry === undefined) return

    picture.apply(entry, Date.now())
    sender.answered(entry)
    capture.observe(entry)
    pointing.observe(entry)
    if (announcesFrame(entry, settings.devices.primary)) void keeper.requestScan()
  },
  onCaughtUp: () => picture.caughtUp(),
})

void following.connection.closed().then(error => lost(`broker connection lost${error ? `: ${error.message}` : ''}`))
following.done.then(
  () => lost('the stream reader ended'),
  (error: unknown) => lost(`the stream reader failed: ${String(error)}`),
)

void keeper.requestScan()

page.server.listen(settings.port, '127.0.0.1', () => console.error(`vela: http://127.0.0.1:${settings.port}/`))
