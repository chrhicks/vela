import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { jetstream } from '@nats-io/jetstream'
import { runEntry, runSubject } from '../capture/events.ts'
import { makeRunFile } from '../capture/runfile.ts'
import { makeCapture } from '../capture/run.ts'
import { makeSender } from '../commands/sender.ts'
import { readConfig } from '../config.ts'
import { makeActivity } from '../activity/activity.ts'
import { announcesFrame } from '../frames/announce.ts'
import { frameEntry, frameSubject } from '../frames/entry.ts'
import { makeKeeper } from '../frames/keeper.ts'
import { frameDetail, listNight, makePreviews } from '../frames/library.ts'
import { nightOf } from '../frames/night.ts'
import { makeSsh } from '../frames/ssh.ts'
import { makePointing } from '../pointing/pointing.ts'
import { makePrepare } from '../prepare/prepare.ts'
import { makeFocusDrift } from '../rig/focus.ts'
import { focusSubject, makeAutofocus } from '../focus/autofocus.ts'
import { makeAstap } from '../measure/astap.ts'
import { alignSubject, makeAlign } from '../align/run.ts'
import { readCards } from '../frames/library.ts'
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

const devices = settings.devices
const focusDrift = makeFocusDrift(devices.focuser)
const activity = makeActivity({
  titles: { [devices.mount]: 'Mount', [devices.primary]: 'Main camera', [devices.guide]: 'Guide camera', [devices.focuser]: 'Focuser', [devices.box]: 'Power box' },
  nightOf: at => nightOf(at, naming),
})

function lost(reason: string): never {
  console.error(`vela: ${reason}`)
  process.exit(1)
}

const sender = makeSender({
  publish: (subject, payload) => following.connection.publish(subject, payload),
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
    exposureSilenceMs: settings.capture.exposureSilenceSeconds * 1000,
    failuresInRow: settings.capture.failuresInRow,
    telescope: settings.capture.telescope,
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
const astap = makeAstap(settings.astap)
const keptPath = (frame: { readonly night: string; readonly file: string }) => join(frames.keepDir, frame.night, frame.file)
const publishEntry = (subject: string, kind: string, id: string, body: Readonly<Record<string, unknown>>) => {
  const at = Date.now()

  jetstream(following.connection)
    .publish(subject, JSON.stringify({ v: 2, id: `${kind}:${id}:${at}`, rig: frames.rig, kind, at, source: 'vela', body }))
    .catch((error: unknown) => console.error(`vela: could not publish ${kind}: ${String(error)}`))
}
const autofocus = makeAutofocus({
  picture,
  sender,
  capture,
  analyse: frame => astap.analyse(keptPath(frame)),
  publish: (kind, body) => publishEntry(focusSubject, `vela.focus.${kind}`, String(body['run']), body),
  settings: { focuser: devices.focuser, camera: devices.primary },
})
const align = makeAlign({
  picture,
  sender,
  capture,
  solve: frame => astap.solve(keptPath(frame)),
  cards: frame => readCards(keptPath(frame)),
  publish: (kind, body) => publishEntry(alignSubject, `vela.align.${kind}`, `${String(body['run'])}:${String(body['frame'] ?? '')}`, body),
  settings: { mount: devices.mount, camera: devices.primary, ...settings.align },
  now: Date.now,
})
const page = makePage({
  night: () => makeNight(picture, nightSettings, Date.now()),
  focus: () => focusDrift.view(),
  refreshMs: settings.pageRefreshSeconds * 1000,
  frames: () => listNight(frames.keepDir, nightOf(Date.now(), naming)),
  preview: makePreviews(frames.keepDir, frames.preview).get,
  frame: (night, file) => frameDetail(frames.keepDir, night, file),
  activity: () => ({ ...activity.view(Date.now()), viewer: settings.streamViewer }),
  capture: { view: () => capture.view(), start: request => capture.start(request), stop: () => capture.stop() },
  prepare: request => prepare.act(request),
  pointing,
  runs: { autofocus, align },
})

const keeper = makeKeeper({
  ssh: makeSsh(frames.host, frames.sshTimeoutSeconds * 1000),
  labelOf: capture.labelOf,
  settings: { spoolDir: frames.spoolDir, keepDir: frames.keepDir, naming, copyAttempts: frames.copyAttempts, copyRetryMs: frames.copyRetrySeconds * 1000 },
  now: Date.now,
  sleep: ms => sleep(ms),
  onKept: frame => {
    page.framesChanged()
    void autofocus.kept(frame)
    void align.kept(frame)
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
    focusDrift.observe(entry)
    autofocus.observe(entry)
    align.observe(entry)

    const item = activity.observe(entry)

    if (item !== undefined) page.activityAdded(item)
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
