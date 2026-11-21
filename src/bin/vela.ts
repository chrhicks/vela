import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { jetstream } from '@nats-io/jetstream'
import { Clock, Context, Effect, Fiber, Layer, Match, Scope, Stream } from 'effect'
import { runEntry } from '../capture/events.ts'
import { makeRunFile } from '../capture/runfile.ts'
import { makeCapture } from '../capture/run.ts'
import { makeFirstFramesCheck } from '../capture/first-frames.ts'
import { makeSender } from '../commands/sender.ts'
import { readConfig } from '../config.ts'
import { makeActivity } from '../activity/activity.ts'
import { announcesFrame } from '../frames/announce.ts'
import { frameEntry } from '../frames/entry.ts'
import { makeKeeper } from '../frames/keeper.ts'
import { makeNamer } from '../frames/names.ts'
import { frameDetail, listNight, makeDeveloped, makePreviews } from '../frames/library.ts'
import { makePreviewRgb } from '../frames/preview.ts'
import { nightOf } from '../frames/night.ts'
import { makeSsh } from '../frames/ssh.ts'
import { makeFrameStats, saveStats, solveFrame } from '../frames/stats.ts'
import { makeStacks, type StackCount } from '../stack/stacks.ts'
import { makePointing } from '../pointing/pointing.ts'
import { meridianLimitDegreesOf, siteOf } from '../pointing/target.ts'
import { makePrepare } from '../prepare/prepare.ts'
import { makeFocusDrift } from '../rig/focus.ts'
import { makeAutofocus } from '../focus/autofocus.ts'
import { makeAlign } from '../align/run.ts'
import { makeCentre } from '../pointing/centre.ts'
import { makeGoto } from '../pointing/goto.ts'
import { makeMeasureRequests, measuredOf, notKeptOf } from '../measure/rig.ts'
import { makeNight } from '../rig/night.ts'
import { makePicture } from '../rig/picture.ts'
import { makePage } from '../page/server.ts'
import { VelaSettings } from '../settings.ts'
import { Feed, FeedLive } from '../feed/feed.ts'
import { FeedServer, FeedSettings, Tonight } from '../feed/route.ts'
import { SkyNow } from '../feed/sky.ts'
import { Targets } from '../feed/targets.ts'
import { readSurvey, SurveySettings } from '../sky/survey.ts'
import { skyTonight } from '../sky/tonight.ts'
import { DevelopedFrames, FrameUndeveloped } from '../feed/crops.ts'
import { PreviewFailed, Previews } from '../feed/previews.ts'
import { StackPictures } from '../feed/stack.ts'
import { DetailSurveyKept, SurveyKept } from '../feed/survey.ts'
import { CommandLog, CommandRefused, Operations } from '../feed/commands.ts'
import { pressKey } from '../../state/pressing.ts'
import type { FilterAnswer } from '../../state/commands.ts'
import { deviceCommandsFrom } from '../controls/device-commands.ts'
import { Autofocusing, focusControls, FocusSettings } from '../controls/focus.ts'
import { CalibrationSettings, cameraControls, Capturing } from '../controls/camera.ts'
import { dewControls, DewSettings } from '../controls/dew.ts'
import { flatControls, FlatSettings, FlatsLog } from '../controls/flats.ts'
import { guidingControls, GuidingSettings, mountGuiding } from '../controls/guiding.ts'
import { FilterAnswers, StartLog, StartRunning, StartSettings, startControls, TargetCatalog, TargetCentring } from '../controls/start.ts'
import { rehearsalControls, RehearsalGoto, RehearsalLog, RehearsalSettings, rehearsalGoto } from '../controls/rehearse.ts'
import { RehearsalRunning, type Cancelled, type Routine } from '../controls/rehearsing.ts'
import { sweepControls, SweepFrames, SweepLog, SweepRecord, SweepRunSettings } from '../controls/sweep.ts'
import { makeSweepFrames } from '../sweep/frames.ts'
import { appendFile, mkdir } from 'node:fs/promises'
import { Centring, mountControls, MountGuiding, MountRuns, MountSettings } from '../controls/mount.ts'
import { catalogOf, readCatalog } from '../catalog/catalog.ts'
import { CatalogSettings } from '../catalog/database.ts'
import { makeHorizonNights } from '../catalog/horizon-night.ts'
import { makePlacedTargets } from '../catalog/placed.ts'
import { loadHorizon } from '../horizon/file.ts'
import { noHorizon } from '../horizon/horizon.ts'
import { HorizonNights } from '../feed/horizon-night.ts'
import { operationObjects } from '../../state/entries.ts'
import { NightName, RehearsalId, StartId, SweepId } from '../../state/entries.ts'
import { runHandledPromise, runHandledSync } from '../edge.ts'
import { ServiceStart, ServiceStartNow } from '../feed/start.ts'
import { makeReader, type Entry, type Message } from '../../state/entry.ts'
import { streamOf } from '../../state/stream.ts'
import { readWireBody } from '../stream/json.ts'
import { Broker, brokerOf, followRig, type Followed } from '../stream/follow.ts'
import { readHistory } from '../stream/history.ts'
import { keep, readKept } from '../remembered/kept.ts'
import { coolerFor, lastCentreNear, nothingRemembered, remember } from '../remembered/remembered.ts'
import { Recalled } from '../feed/remembered.ts'
import { keepLine } from '../review/keep.ts'
import { placeFrame } from '../review/place.ts'
import { makeReview, PictureUnavailable } from '../review/review.ts'
import { anthropicMessages, makeReviewer } from '../review/reviewer.ts'

const settings = readConfig(VelaSettings, process.argv[2])
const stream = streamOf(settings.environment)
const readMessage = makeReader(stream)
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
  subjectOf: stream.command,
  publish: (subject, payload) => broker.connection.publish(subject, payload),
  newId: () => `vela-${randomUUID()}`,
  answerTimeoutMs: settings.capture.commandAnswerSeconds * 1000,
  by: 'vela',
  now: Date.now,
})
const prepare = makePrepare({ picture, sender, settings: { focuser: settings.devices.focuser, box: settings.devices.box, camera: settings.devices.primary, focuserNudgeSteps: settings.prepare.focuserNudgeSteps } })
const catalog = runHandledSync(
  readCatalog.pipe(
    Effect.provide(Layer.succeed(CatalogSettings, settings.catalog)),
    Effect.catchTag('CatalogUnreadable', ({ database, reason }) =>
      Effect.sync(() => {
        console.error(`vela: no target catalog, only typed positions can be found: ${database}: ${reason}. Run src/bin/catalog-setup.ts`)

        return catalogOf([], [])
      }),
    ),
  ),
)
const surveyOf = (config: typeof settings.sky, missing: string) =>
  runHandledPromise(
    readSurvey.pipe(
      Effect.provide(Layer.succeed(SurveySettings, config)),
      Effect.catchTag('SurveyUnreadable', ({ path, reason }) =>
        Effect.sync(() => {
          console.error(`vela: ${missing}: ${path}: ${reason}`)

          return null
        }),
      ),
    ),
  )

const surveyKept = await surveyOf(settings.sky, 'no sky survey, the picker shows no sky picture. Run src/bin/sky-setup.ts')
const detailSurveyKept = await surveyOf(settings.skyDetail, 'no detail survey, the picker has no full-size view. Run src/bin/sky-setup.ts with detail')

const horizon = await runHandledPromise(loadHorizon(settings.horizonFile))

let remembered = nothingRemembered

const placedTargets = makePlacedTargets({
  catalog,
  site: () => siteOf(picture, settings.devices.mount),
  lastCentreNear: position => lastCentreNear(remembered, position, settings.pointing.sameFramingDegrees),
  lastCoolerFor: id => coolerFor(remembered, id),
  horizon,
  settings: settings.pointing,
})
const horizonNights = makeHorizonNights({
  catalog,
  site: () => siteOf(picture, settings.devices.mount),
  horizon,
  horizonFileLoaded: horizon !== noHorizon,
  meridianLimitDegrees: () => meridianLimitDegreesOf(picture, settings.devices.mount),
  cameraAngleDegrees: () => remembered.cameraAngle?.degrees,
  naming,
  settings: { ...settings.horizonNight, upLineDegrees: settings.pointing.upLineDegrees },
})
const pointing = makePointing({ picture, catalog, sender, settings: { mount: settings.devices.mount, searchResults: settings.pointing.searchResults }, now: Date.now })
const capture = makeCapture({
  picture,
  sender,
  settings: {
    device: settings.devices.primary,
    spoolDir: frames.spoolDir,
    measureDir: frames.measureDir,
    settleMs: settings.capture.settleSeconds * 1000,
    exposureSilenceMs: settings.capture.exposureSilenceSeconds * 1000,
    failuresInRow: settings.capture.failuresInRow,
    telescope: settings.capture.telescope,
    filterNames: settings.capture.filterNames,
    filterInSuffix: settings.capture.filterInSuffix,
  },
  runFile: makeRunFile(settings.capture.runFile),
  nextName: makeNamer({ night: () => nightOf(Date.now(), naming), kept: night => readdir(join(frames.keepDir, night)) }),
  now: Date.now,
  newRunId: () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''),
  emit: event => {
    jetstream(broker.connection)
      .publish(stream.vela('run'), JSON.stringify(runEntry(event, frames.rig, Date.now())))
      .catch((error: unknown) => console.error(`vela: could not publish the ${event.kind} entry of run ${event.run}: ${String(error)}`))
  },
  onChange: () => page.captureChanged(),
})
const publishEntry = (subject: string, kind: string, id: string, body: Readonly<Record<string, unknown>>) => {
  const at = Date.now()

  jetstream(broker.connection)
    .publish(subject, JSON.stringify({ v: 2, id: `${kind}:${id}:${at}`, rig: frames.rig, kind, at, source: 'vela', body }))
    .catch((error: unknown) => console.error(`vela: could not publish ${kind}: ${String(error)}`))
}
const autofocus = makeAutofocus({
  picture,
  sender,
  capture,
  publish: (kind, body) => publishEntry(stream.vela('focus'), `vela.focus.${kind}`, String(body['run']), body),
  settings: { focuser: devices.focuser, camera: devices.primary, ...settings.autofocus },
})
const align = makeAlign({
  picture,
  sender,
  capture,
  publish: (kind, body) => publishEntry(stream.vela('align'), `vela.align.${kind}`, `${String(body['run'])}:${String(body['frame'] ?? '')}`, body),
  settings: { mount: devices.mount, camera: devices.primary, ...settings.align },
  now: Date.now,
})
const sweepGoto = makeGoto({ picture, sender, mount: devices.mount })
const centre = makeCentre({
  picture,
  pointing,
  capture,
  publish: (kind, body) => publishEntry(stream.vela('centre'), `vela.centre.${kind}`, `${String(body['run'])}:${String(body['frame'] ?? '')}`, body),
  settings: { mount: devices.mount, camera: devices.primary, ...settings.centre },
  now: Date.now,
})
const previews = makePreviews(frames.keepDir, frames.preview)
const developedFrames = makeDeveloped(frames.keepDir, frames.preview)

const page = makePage({
  night: () => makeNight(picture, nightSettings, Date.now()),
  focus: () => focusDrift.view(),
  refreshMs: settings.pageRefreshSeconds * 1000,
  frames: () => listNight(frames.keepDir, nightOf(Date.now(), naming)),
  preview: previews.get,
  frame: (night, file) => frameDetail(frames.keepDir, night, file),
  activity: () => ({ ...activity.view(Date.now()), viewer: settings.streamViewer }),
  capture: { view: () => capture.view(), start: request => capture.start(request), stop: () => capture.stop() },
  prepare: request => prepare.act(request),
  pointing,
  runs: { autofocus, align, centre },
  copies: { left: () => keeper.left(), again: () => void keeper.requestScan() },
})

const measureStats = makeFrameStats(settings.stars, (step, path, error) => console.error(`vela: ASTAP ${step === 'solve' ? 'solve' : 'star list'} failed for ${path}: ${String(error)}`))
const stars = settings.stars
const stacks = makeStacks({
  keepDir: frames.keepDir,
  preview: frames.preview,
  solve: (path, near, fieldDegrees) => (stars?.catalog === undefined ? Promise.resolve('') : solveFrame(stars.program, stars.catalog, path, near, stars.solveRadiusDegrees, fieldDegrees)),
  failed: (file, error) => console.error(`vela: could not stack ${file}: ${String(error)}`),
})
const publishStack = (count: StackCount | undefined) => {
  if (count !== undefined) publishEntry(stream.vela('stack'), 'vela.stack', `${count.sequence}:${count.frames}:${count.leftOut}`, { ...count })
}
const review = makeReview({
  settings: settings.review,
  reviewer: makeReviewer(settings.review, anthropicMessages()),
  picture: (night, file) =>
    Effect.tryPromise({ try: () => readFile(join(frames.keepDir, night, file)).then(bytes => makePreviewRgb(bytes, frames.preview)), catch: cause => new PictureUnavailable({ night, file, cause }) }),
  placed: (night, file) => Effect.promise(() => statsQueue.then(() => placeFrame(frames.keepDir, night, file)).catch(() => undefined)),
  horizon,
  publish: (kind, id, body) => publishEntry(stream.vela('review'), `vela.review.${kind}`, id, body),
  keep: keepLine(settings.review.answersFile),
  report: line => console.error(`vela: ${line}`),
  live: () => caughtUp,
  now: Date.now,
  newId: () => randomUUID(),
})

if (settings.review.enabled) console.error(`vela: frame review is on, asking ${settings.review.models.join(' and ')}; it needs the sign-in from ant auth login`)

let statsQueue: Promise<void> = Promise.resolve()

function measureKept(frame: { readonly night: string; readonly file: string; readonly sequence?: string }) {
  const path = join(frames.keepDir, frame.night, frame.file)

  statsQueue = statsQueue
    .then(async () => {
      const stats = await measureStats(path)

      await saveStats(path, stats)
      page.framesChanged()
      publishEntry(stream.vela('frame'), 'vela.frame.stats', frame.file, { night: frame.night, file: frame.file, ...(frame.sequence === undefined ? {} : { sequence: frame.sequence }), ...stats })
      publishStack(await stacks.add(frame, stats.solution))
    })
    .catch((error: unknown) => console.error(`vela: could not measure ${frame.file}: ${String(error)}`))
}

statsQueue = statsQueue.then(() => stacks.rebuild(nightOf(Date.now(), naming), publishStack)).catch((error: unknown) => console.error(`vela: could not rebuild tonight's stacks: ${String(error)}`))

const keeper = makeKeeper({
  ssh: makeSsh(frames.host, frames.sshTimeoutSeconds * 1000),
  labelOf: capture.labelOf,
  settings: { spoolDir: frames.spoolDir, keepDir: frames.keepDir, naming, copyAttempts: frames.copyAttempts, copyRetryMs: frames.copyRetrySeconds * 1000 },
  now: Date.now,
  sleep: ms => sleep(ms),
  onKept: frame => {
    page.framesChanged()
    measureKept(frame)
    jetstream(broker.connection)
      .publish(stream.vela('frame'), JSON.stringify(frameEntry(frame, frames.rig, Date.now())))
      .catch((error: unknown) => console.error(`vela: could not publish the entry for ${frame.file}: ${String(error)}`))
  },
  onProblem: message => console.error(`vela: ${message}`),
  onLeft: left => {
    publishEntry(stream.vela('copy'), 'vela.copy.left', left.what, { what: left.what, reason: left.reason })
  },
})

const requestMeasure = makeMeasureRequests({ subject: stream.command('measure'), publish: (subject, payload) => broker.connection.publish(subject, payload), newId: () => `vela-${randomUUID()}`, by: 'vela' })

function frameSaved(entry: Entry) {
  const path = readWireBody(entry)?.elements['FILE_PATH']
  const label = typeof path === 'string' ? capture.labelOf(basename(path)) : undefined

  if (label?.measure !== undefined) requestMeasure(basename(String(path)), label.measure, label.keep)
  else void keeper.requestScan()
}

const started = (result: { readonly ok: true } | { readonly ok: false; readonly reason: string }) =>
  result.ok ? Effect.void : Effect.fail(new CommandRefused({ refusal: { code: 'refused', text: result.reason } }))

const answerFilter = (filter: FilterAnswer) => Effect.sync(() => publishEntry(stream.vela('filter'), 'vela.filter', filter, { filter }))

const launchOperations = {
  startAlignment: Effect.suspend(() => started(align.start({ exposureSeconds: settings.launch.alignExposureSeconds }))),
  finishAlignment: Effect.suspend(() =>
    capture.view().run?.object === operationObjects.align
      ? Effect.promise(() => capture.stop()).pipe(Effect.asVoid)
      : Effect.fail(new CommandRefused({ refusal: { code: 'refused', text: 'no alignment is running' } })),
  ),
  answerFilter: (filter: FilterAnswer) =>
    answerFilter(filter).pipe(
      Effect.andThen(
        Effect.suspend(() =>
          started(autofocus.start({ step: settings.launch.autofocusStep, samples: settings.launch.autofocusSamples, exposureSeconds: settings.launch.autofocusExposureSeconds[filter] })),
        ),
      ),
    ),
}

let startRoutine: Fiber.Fiber<void> | undefined

const cancelStart = Effect.suspend(() => (startRoutine === undefined ? Effect.void : Fiber.interrupt(startRoutine)))

let rehearsalRoutine: Fiber.Fiber<void> | undefined
let rehearsalEnding: Cancelled = 'pressed'
let rehearsalKind: Routine | undefined

const cancelRehearsal = (ending: Cancelled) =>
  Effect.suspend(() => {
    const routine = rehearsalRoutine

    if (routine === undefined) return Effect.succeed(false)

    rehearsalEnding = ending

    return Fiber.interrupt(routine).pipe(Effect.as(true))
  })

const rehearsalServices = Layer.mergeAll(
  Layer.succeed(RehearsalGoto, rehearsalGoto(sweepGoto)),
  Layer.succeed(RehearsalLog, {
    started: body => Effect.sync(() => publishEntry(stream.vela('sweep'), 'vela.sweep.started', body.rehearsal, body)),
    moved: body => Effect.sync(() => publishEntry(stream.vela('sweep'), 'vela.sweep.move', `${body.rehearsal}:${body.move}`, body)),
    ended: body => Effect.sync(() => publishEntry(stream.vela('sweep'), 'vela.sweep.ended', body.rehearsal, body)),
  }),
  Layer.succeed(RehearsalRunning, {
    busy: Effect.sync(() => rehearsalRoutine !== undefined),
    which: Effect.sync(() => (rehearsalRoutine === undefined ? undefined : rehearsalKind)),
    began: (routine, which) =>
      Effect.sync(() => {
        rehearsalRoutine = routine
        rehearsalKind = which
      }).pipe(
        Effect.andThen(
          Effect.forkDetach(
            Fiber.await(routine).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (rehearsalRoutine === routine) rehearsalRoutine = undefined
                }),
              ),
            ),
          ),
        ),
        Effect.asVoid,
      ),
    cancelled: Effect.sync(() => rehearsalEnding),
  }),
  Layer.succeed(RehearsalSettings, { sweep: settings.sweep, rigSilentAfterSeconds: settings.silenceSeconds, newId: Effect.sync(() => RehearsalId.make(`rehearsal-${randomUUID()}`)) }),
)

const sweepFrames = makeSweepFrames({
  picture,
  capture: { start: (request, between, measure, keep) => capture.start(request, between, measure, keep), labelOf: capture.labelOf, stop: () => capture.stop() },
  camera: devices.primary,
  measure: ['solve', 'stars'],
  onKept: () => void keeper.requestScan(),
})

const sweepServices = Layer.mergeAll(
  Layer.succeed(SweepFrames, {
    begin: exposureSeconds => Effect.suspend(() => started(sweepFrames.begin(exposureSeconds))),
    take: Effect.promise(() => sweepFrames.take()),
    problems: Effect.sync(() => sweepFrames.problems()),
    end: Effect.promise(() => sweepFrames.end()),
  }),
  Layer.succeed(SweepLog, {
    started: body => Effect.sync(() => publishEntry(stream.vela('sweep'), 'vela.sweep.run.started', body.sweep, body)),
    framed: body => Effect.sync(() => publishEntry(stream.vela('sweep'), 'vela.sweep.frame', `${body.sweep}:${body.file}`, body)),
    columned: body => Effect.sync(() => publishEntry(stream.vela('sweep'), 'vela.sweep.column', `${body.sweep}:${body.column}`, body)),
    alerted: body => Effect.sync(() => publishEntry(stream.vela('sweep'), 'vela.sweep.alert', `${body.sweep}:${body.column}`, body)),
    ended: body => Effect.sync(() => publishEntry(stream.vela('sweep'), 'vela.sweep.run.ended', body.sweep, body)),
  }),
  Layer.succeed(SweepRecord, {
    append: (record, at, line) => {
      const folder = join(settings.sweep.recordDir, nightOf(at, naming))

      return Effect.tryPromise({
        try: () => mkdir(folder, { recursive: true }).then(() => appendFile(join(folder, `${record}.jsonl`), `${JSON.stringify(line)}\n`)),
        catch: error => (error instanceof Error ? error.message : String(error)),
      })
    },
  }),
  Layer.succeed(SweepRunSettings, { sweep: settings.sweep, rigSilentAfterSeconds: settings.silenceSeconds, newId: Effect.sync(() => SweepId.make(`sweep-${randomUUID()}`)) }),
)

const startServices = Layer.mergeAll(
  Layer.succeed(TargetCatalog, { find: id => catalog.find(id) }),
  Layer.succeed(TargetCentring, { centre: id => Effect.suspend(() => started(centre.start({ id, exposureSeconds: settings.controls.centreExposureSeconds }))) }),
  Layer.succeed(FilterAnswers, { answer: answerFilter }),
  Layer.succeed(StartLog, { report: step => Effect.sync(() => publishEntry(stream.vela('target'), 'vela.target.step', `${step.start}:${step.step}:${step.outcome}`, step)) }),
  Layer.succeed(StartRunning, {
    busy: Effect.sync(() => startRoutine !== undefined),
    began: routine =>
      Effect.sync(() => {
        startRoutine = routine
      }).pipe(
        Effect.andThen(
          Effect.forkDetach(
            Fiber.await(routine).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (startRoutine === routine) startRoutine = undefined
                }),
              ),
            ),
          ),
        ),
        Effect.asVoid,
      ),
  }),
  Layer.succeed(StartSettings, {
    ...settings.start,
    rigSilentAfterSeconds: settings.silenceSeconds,
    autofocusExposureSeconds: settings.launch.autofocusExposureSeconds,
    newId: Effect.sync(() => StartId.make(`start-${randomUUID()}`)),
  }),
)

const mountRuns = Layer.succeed(MountRuns, {
  endRun: cancelRehearsal('pressed').pipe(Effect.andThen(cancelStart), Effect.andThen(Effect.promise(() => capture.stop()))),
  stopRehearsal: cancelRehearsal('stopped'),
  idle: Effect.promise(() => capture.whenIdle()),
  pause: Effect.sync(() => capture.pause()),
  parked: Effect.promise(() => capture.whenParked()),
  resume: Effect.sync(() => capture.resume()),
})

const centring = Layer.succeed(Centring, {
  centreOn: target =>
    Effect.suspend(() => {
      const found = catalog.search(target, 1)[0]

      if (found === undefined) return Effect.fail(new CommandRefused({ refusal: { code: 'unknown-target', text: target } }))

      return started(centre.start({ id: found.id, exposureSeconds: settings.controls.centreExposureSeconds })).pipe(Effect.as(found.commonName ?? found.name))
    }),
})

const autofocusing = Layer.succeed(Autofocusing, {
  start: exposureSeconds => Effect.suspend(() => started(autofocus.start({ step: settings.launch.autofocusStep, samples: settings.launch.autofocusSamples, exposureSeconds }))),
  run: exposureSeconds =>
    Effect.suspend(() => {
      const result = autofocus.start({ step: settings.launch.autofocusStep, samples: settings.launch.autofocusSamples, exposureSeconds })

      return result.ok ? Effect.promise(() => result.done).pipe(Effect.map(ending => ending.reason)) : Effect.fail(new CommandRefused({ refusal: { code: 'refused', text: result.reason } }))
    }),
})

const capturing = Layer.succeed(Capturing, {
  busy: Effect.sync(() => capture.view().run !== undefined),
  start: request => Effect.suspend(() => started(capture.start(request))),
  finished: Effect.promise(() => capture.whenIdle()).pipe(Effect.map(() => capture.view().last?.reason)),
})

const flatsLog = Layer.succeed(FlatsLog, { tried: flatTry => Effect.sync(() => publishEntry(stream.vela('flats'), 'vela.flats.exposure', String(flatTry.exposureSeconds), { ...flatTry })) })

const OperationsLive = Layer.effect(Operations, Effect.map(Effect.all([mountControls, focusControls, cameraControls, dewControls, flatControls, guidingControls, startControls, rehearsalControls, sweepControls]), ([mount, focus, camera, dew, flats, guiding, start, rehearsal, sweeping]) => ({ ...launchOperations, ...mount, ...focus, ...camera, ...dew, ...flats, ...guiding, ...start, ...rehearsal, ...sweeping }))).pipe(Layer.provide(Layer.effect(MountGuiding, mountGuiding)), Layer.provide(startServices), Layer.provide(rehearsalServices), Layer.provide(sweepServices), Layer.provide(Layer.succeed(GuidingSettings, { settle: { pixels: settings.controls.guideSettlePixels, time: settings.controls.guideSettleSeconds, timeout: settings.controls.guideSettleTimeoutSeconds }, replySeconds: settings.controls.guiderReplySeconds, connectSeconds: settings.controls.guiderConnectSeconds, newId: Effect.sync(() => `vela-guider-${randomUUID()}`) })), Layer.provide(flatsLog), Layer.provide(Layer.succeed(FlatSettings, { startSeconds: settings.controls.flatStartSeconds, lowAdu: settings.controls.flatLowAdu, highAdu: settings.controls.flatHighAdu, minSeconds: settings.controls.biasExposureSeconds, maxSeconds: settings.controls.flatMaxSeconds, tries: settings.controls.flatTries, measureSeconds: settings.controls.flatMeasureSeconds })), Layer.provide(Layer.succeed(CalibrationSettings, { biasExposureSeconds: settings.controls.biasExposureSeconds })), Layer.provide(Layer.succeed(DewSettings, { channel: settings.controls.dewChannel })), Layer.provide(mountRuns), Layer.provide(centring), Layer.provide(autofocusing), Layer.provide(capturing), Layer.provide(Layer.succeed(FocusSettings, { moveSeconds: settings.controls.focusMoveSeconds })), Layer.provide(Layer.succeed(MountSettings, { nudgeRates: { slow: settings.controls.nudgeSlowRate, fast: settings.controls.nudgeFastRate }, flipSettleSeconds: settings.controls.flipSettleSeconds, guidingSettleSeconds: settings.controls.guideSettleTimeoutSeconds + settings.controls.guiderReplySeconds })))

const startAnnounced = Layer.effectDiscard(
  Effect.gen(function* () {
    const { connection } = yield* Broker
    const { token } = yield* ServiceStart
    const at = Date.now()

    yield* Effect.tryPromise({
      try: () => jetstream(connection).publish(stream.vela('started'), JSON.stringify({ v: 2, id: `vela.started:${token}:${at}`, rig: frames.rig, kind: 'vela.started', at, source: 'vela', body: { token } })),
      catch: error => String(error),
    }).pipe(Effect.catch(issue => Effect.sync(() => console.error(`vela: could not publish vela.started: ${issue}`))))
  }),
)

const feedApp = FeedServer.pipe(
  Layer.provide(OperationsLive),
  Layer.provideMerge(FeedLive),
  Layer.provide(startAnnounced),
  Layer.provide(Layer.mergeAll(
      ServiceStartNow,
      Layer.succeed(Tonight, { nightOf: at => NightName.make(nightOf(at, naming)) }),
      Layer.succeed(Recalled, {
        now: Effect.sync(() => ({
          lastLight: remembered.lastLight === undefined ? null : { exposureSeconds: remembered.lastLight.exposureSeconds, frames: remembered.lastLight.frames ?? null },
          cameraAngleDegrees: remembered.cameraAngle?.degrees ?? null,
        })),
      }),
      Layer.succeed(SurveyKept, { survey: surveyKept, tilesDir: settings.sky.tilesDir }),
      Layer.succeed(DetailSurveyKept, { survey: detailSurveyKept, tilesDir: settings.skyDetail.tilesDir }),
      Layer.succeed(DevelopedFrames, { get: (night, file) => Effect.tryPromise({ try: () => developedFrames.get(night, file), catch: cause => new FrameUndeveloped({ night, file, cause }) }) }),
      Layer.succeed(Previews, { get: (night, file) => Effect.tryPromise({ try: () => previews.get(night, file), catch: cause => new PreviewFailed({ night, file, cause }) }) }),
      Layer.succeed(StackPictures, { picture: (night, sequence) => Effect.sync(() => stacks.picture(night, sequence)), shape: (night, sequence) => Effect.sync(() => stacks.shape(night, sequence)), crop: (night, sequence, box) => Effect.sync(() => stacks.crop(night, sequence, box)) }),
      Layer.succeed(CommandLog, {
        newId: Effect.sync(() => randomUUID()),
        pressed: (id, request) => Effect.sync(() => publishEntry(stream.vela('command'), 'vela.command.pressed', id, { id, command: request.command, key: pressKey(request) })),
        answered: (id, command) => Effect.sync(() => publishEntry(stream.vela('command'), 'vela.command.answered', id, { id, command })),
      }),
      Layer.succeed(SkyNow, {
        tonight: Effect.map(Clock.currentTimeMillis, at => {
          const site = siteOf(picture, settings.devices.mount)

          return site === undefined ? null : skyTonight(site, at)
        }),
      }),
      Layer.succeed(HorizonNights, { night: (id, at) => horizonNights.night(id, at) }),
      Layer.succeed(Targets, {
        search: text => Effect.map(Clock.currentTimeMillis, at => placedTargets.search(text, at)),
        bestPlaced: asked => Effect.map(Clock.currentTimeMillis, at => placedTargets.bestPlaced(at, asked)),
        facts: id => Effect.map(Clock.currentTimeMillis, at => placedTargets.facts(id, at)),
        size: catalog.size,
      }),
      deviceCommandsFrom({ send: (command, signal) => sender.send(command, signal), ask: (request, signal) => sender.ask(request, signal), tell: (device, body) => sender.tell(device, body), deviceIds: settings.devices, answerSeconds: settings.capture.commandAnswerSeconds }),
      Layer.succeed(FeedSettings, { ...settings.feed, firstFrames: settings.firstFrames, rigSilentAfterSeconds: settings.silenceSeconds, picker: { wheelPixelsPerDoubling: settings.pointing.wheelPixelsPerDoubling, zoomGlideMs: settings.pointing.zoomGlideMs }, launch: { alignGoodArcmin: settings.launch.alignGoodArcmin, alignMovedArcmin: settings.launch.alignMovedArcmin }, controls: { nudgeHoldMs: settings.controls.nudgeHoldMs, focusSteps: settings.controls.focusSteps, autofocusExposureSeconds: settings.launch.autofocusExposureSeconds, coolerCelsius: settings.controls.coolerCelsius, dewChannel: settings.controls.dewChannel, dewPercent: settings.controls.dewPercent, testFrameSeconds: settings.controls.testFrameSeconds, calibrationFrames: settings.controls.calibrationFrames } }),
    )),
)
const servicesScope = runHandledSync(Scope.make())
const { feed, broker } = await runHandledPromise(
  Layer.buildWithScope(Layer.provideMerge(feedApp, brokerOf(settings.broker)), servicesScope).pipe(
    Effect.map(context => ({ feed: Context.get(context, Feed), broker: Context.get(context, Broker) })),
    Effect.catchTags({
      BrokerUnreachable: error => Effect.sync(() => lost(`the broker at ${error.servers} could not be reached: ${error.issue}`)),
      ServeError: error => Effect.sync(() => lost(`the event stream could not listen on ${settings.feed.host}:${settings.feed.port}: ${String(error.cause)}`)),
      PlatformError: error => Effect.sync(() => lost(`the web app could not be served from ${settings.feed.webRoot}: ${error.message}`)),
    }),
  ),
)

function observe(entry: Entry) {
  picture.apply(entry, Date.now())
  sender.answered(entry)
  capture.observe(entry)
  pointing.observe(entry)
  focusDrift.observe(entry)
  review.observe(entry)
  autofocus.observe(entry)
  align.observe(entry)
  centre.observe(entry)
  sweepGoto.observe(entry)

  const item = activity.observe(entry)

  if (item !== undefined) page.activityAdded(item)
  const measured = measuredOf(entry, 'vela')
  const notKept = notKeptOf(entry, 'vela')

  if (notKept !== undefined) sweepFrames.notKept(notKept.file, notKept.reason)
  if (measured !== undefined) {
    sweepFrames.measured(measured)
    align.measured(measured)
    centre.measured(measured)
    autofocus.measured(measured)
  }
  if (announcesFrame(entry, settings.devices.primary)) frameSaved(entry)
}

const logProblem = (line: string) => Effect.sync(() => console.error(`vela: ${line}`))

let caughtUp = false
let keptReadable = true

const keepRemembered = Effect.suspend(() => (keptReadable ? keep(settings.rememberedFile, remembered) : Effect.void)).pipe(
  Effect.catchTag('RememberedUnwritable', error => logProblem(`what Vela remembers could not be kept in ${error.path}: ${error.reason}`)),
)

const firstFramesCheck = makeFirstFramesCheck({
  limits: settings.firstFrames,
  announce: checked => publishEntry(stream.vela('first-frames'), 'vela.first-frames', checked.run, checked),
})

const handleMessage = (message: Message) =>
  Effect.fromResult(readMessage(message)).pipe(
    Effect.tap(entry =>
      feed.receive(entry).pipe(
        Effect.catchTags({
          MalformedEntry: error => logProblem(`${error.kind} #${error.seq} is malformed: ${error.issue}`),
          MalformedReading: error => logProblem(`device reading #${error.seq} is malformed: ${error.issue}`),
        }),
      ),
    ),
    Effect.tap(entry =>
      Effect.suspend(() => {
        const before = remembered

        remembered = remember(before, entry)

        return caughtUp && remembered !== before ? keepRemembered : Effect.void
      }),
    ),
    Effect.tap(entry => Effect.sync(() => observe(entry))),
    Effect.tap(() => Effect.flatMap(feed.current, rig => Effect.sync(() => (caughtUp ? firstFramesCheck.observe(rig) : undefined)))),
    Effect.catchTag('UnreadableMessage', error => logProblem(`${error.subject} #${error.seq} could not be read: ${error.issue}`)),
    Effect.asVoid,
  )

const handleFollowed = (followed: Followed) =>
  Match.valueTags(followed, {
    Message: ({ message }) => handleMessage(message),
    CaughtUp: () =>
      Effect.sync(() => {
        caughtUp = true
        picture.caughtUp()
        capture.recoverInterrupted()
      }).pipe(Effect.andThen(keepRemembered)),
  })

remembered = await runHandledPromise(
  readKept(settings.rememberedFile).pipe(
    Effect.catchTag('RememberedUnreadable', error =>
      logProblem(`what Vela remembers could not be read from ${error.path}: ${error.reason}. Nothing is kept until that file is fixed or removed`).pipe(
        Effect.andThen(
          Effect.sync(() => {
            keptReadable = false

            return remembered
          }),
        ),
      ),
    ),
  ),
)

remembered = await runHandledPromise(
  readHistory({ stream, subjects: [stream.vela('run'), stream.vela('centre'), stream.client, stream.sent(settings.devices.primary)], readBatch: settings.historyReadBatch, read: readMessage }).pipe(
    Effect.map(entries => entries.reduce(remember, remembered)),
    Effect.provideService(Broker, broker),
    Effect.catchTag('StreamUnreadable', error => logProblem(`what was used last could not be read from ${error.stream}: ${error.issue}`).pipe(Effect.as(remembered))),
  ),
)

void keeper.requestScan()

page.server.listen(settings.port, '127.0.0.1', () => console.error(`vela: http://127.0.0.1:${settings.port}/`))

await runHandledPromise(
  followRig({
    stream,
    readBatch: settings.historyReadBatch,
    read: readMessage,
    onUnreadable: error => runHandledSync(logProblem(`${error.subject} #${error.seq} could not be read while finding the rig's latest connection: ${error.issue}`)),
  }).pipe(
    Stream.runForEach(handleFollowed),
    Effect.provideService(Broker, broker),
    Effect.catchTags({
      StreamUnreadable: error => Effect.sync(() => lost(`the stream ${error.stream} could not be read (${error.step}): ${error.issue}`)),
      BrokerLost: error => Effect.sync(() => lost(`broker connection lost${error.issue === undefined ? '' : `: ${error.issue}`}`)),
      FollowEnded: error => Effect.sync(() => lost(`the stream ${error.stream} ended`)),
    }),
  ),
)
