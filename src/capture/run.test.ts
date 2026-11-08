import { describe, expect, it } from 'vitest'
import { fakeCamera, request, spoolDir } from '../testing/camera.ts'

function kinds(events: ReadonlyArray<{ kind: string }>) {
  return events.map(event => event.kind)
}

async function runToEnd(camera: ReturnType<typeof fakeCamera>, body: unknown = request) {
  const started = camera.capture.start(body)

  if (!started.ok) throw new Error(started.reason)

  await started.done

  return camera.capture.view().last
}

describe('a capture run on a scripted camera', () => {
  it('counts a frame when its file appears, and on the first frame commands only what differs', async () => {
    const camera = fakeCamera()
    const ending = await runToEnd(camera)

    expect(ending).toMatchObject({ reason: 'done', counted: 3, failed: 0 })
    expect(camera.script.sent.slice(0, 8)).toEqual([
      { property: 'FITS_HEADER', values: { KEYWORD_NAME: 'INDI_CLEAR', KEYWORD_VALUE: '', KEYWORD_COMMENT: '' } },
      { property: 'CCD_TEMPERATURE', values: { CCD_TEMPERATURE_VALUE: -10 } },
      { property: 'CCD_COOLER', values: { COOLER_ON: true, COOLER_OFF: false } },
      { property: 'CCD_FRAME_TYPE', values: { FRAME_DARK: true } },
      { property: 'CCD_CONTROLS', values: { Gain: 200 } },
      { property: 'UPLOAD_SETTINGS', values: { UPLOAD_DIR: spoolDir, UPLOAD_PREFIX: 'M-31_dark_XXX' } },
      { property: 'CCD_EXPOSURE', values: { CCD_EXPOSURE_VALUE: 0.01 } },
      { property: 'CCD_EXPOSURE', values: { CCD_EXPOSURE_VALUE: 0.01 } },
    ])
    expect(camera.script.sent).toHaveLength(9)
    expect(kinds(camera.events)).toEqual(['started', 'exposed', 'exposed', 'exposed', 'ended'])
    expect(camera.runFile.read()).toBeUndefined()
  })

  it('names the object in every light frame and clears custom header keys at the start of a run', async () => {
    const camera = fakeCamera()

    await runToEnd(camera, { ...request, frameType: 'light', object: 'M 31' })

    const headers = camera.script.sent.filter(sent => sent.property === 'FITS_HEADER').map(sent => sent.values['KEYWORD_NAME'])

    expect(headers).toEqual(['INDI_CLEAR', 'OBJECT', 'OBJECT', 'OBJECT'])
    expect(camera.script.sent.find(sent => sent.values['KEYWORD_NAME'] === 'OBJECT')?.values['KEYWORD_VALUE']).toBe('M 31')
  })

  it('writes TELESCOP from the settings before every frame when one is set', async () => {
    const camera = fakeCamera({ settings: { telescope: 'Example 400' } })

    await runToEnd(camera)

    const telescopes = camera.script.sent.filter(sent => sent.property === 'FITS_HEADER' && sent.values['KEYWORD_NAME'] === 'TELESCOP')

    expect(telescopes).toHaveLength(3)
    expect(telescopes[0]?.values['KEYWORD_VALUE']).toBe('Example 400')
  })

  it('labels each saved file with the run, the sequence and the frame number', async () => {
    const camera = fakeCamera()

    await runToEnd(camera)

    expect(camera.capture.labelOf('M-31_dark_001.fits')).toEqual({ run: 'run-1', sequence: 'M-31_dark', frame: 1 })
    expect(camera.capture.labelOf('M-31_dark_003.fits')).toEqual({ run: 'run-1', sequence: 'M-31_dark', frame: 3 })
  })

  it('aborts a frame that goes Alert, records it, and goes on until the wanted number are counted', async () => {
    const camera = fakeCamera({ exposures: ['file', 'alert', 'file', 'file'] })
    const ending = await runToEnd(camera)

    expect(ending).toMatchObject({ reason: 'done', counted: 3, failed: 1 })
    expect(camera.script.sent.filter(sent => sent.property === 'CCD_ABORT_EXPOSURE')).toHaveLength(1)
    expect(camera.events.filter(event => event.kind === 'failed')).toMatchObject([{ body: { attempt: 2, why: 'alert' } }])
    expect(camera.capture.labelOf('M-31_dark_002.fits')).toMatchObject({ frame: 2 })
    expect(camera.capture.labelOf('M-31_dark_003.fits')).toMatchObject({ frame: 3 })
  })

  it('waits out a retry, where the time left jumps back up, and counts the frame', async () => {
    const camera = fakeCamera({ exposures: ['retry'] })
    const ending = await runToEnd(camera, { ...request, count: 1 })

    expect(ending).toMatchObject({ reason: 'done', counted: 1, failed: 0 })
    expect(camera.script.sent.some(sent => sent.property === 'CCD_ABORT_EXPOSURE')).toBe(false)
  })

  it('fails a frame when the camera sends no CCD_EXPOSURE update for the silence setting', async () => {
    const camera = fakeCamera({ exposures: ['nothing', 'file'] })
    const ending = await runToEnd(camera, { ...request, count: 1 })

    expect(ending).toMatchObject({ reason: 'done', counted: 1, failed: 1 })
    expect(camera.events.filter(event => event.kind === 'failed')).toMatchObject([{ body: { why: 'silent' } }])
  })

  it('stops after the failure limit in a row and keeps what was counted', async () => {
    const camera = fakeCamera({ exposures: ['file', 'alert', 'alert', 'alert', 'file'] })
    const ending = await runToEnd(camera, { ...request, count: 10 })

    expect(ending).toMatchObject({ reason: 'failures', counted: 1, failed: 3, detail: '3 exposures in a row failed' })
  })

  it('does not stop for failures that are not in a row', async () => {
    const camera = fakeCamera({ exposures: ['alert', 'alert', 'file', 'alert', 'alert', 'file'] })

    expect(await runToEnd(camera, { ...request, count: 2 })).toMatchObject({ reason: 'done', counted: 2, failed: 4 })
  })

  it('stops from the page: writes the abort, ends the run and keeps the frames already saved', async () => {
    const camera = fakeCamera({ exposures: ['file', 'nothing'] })
    const started = camera.capture.start({ ...request, count: 5, exposureSeconds: 5 })

    if (!started.ok) throw new Error(started.reason)

    while (camera.capture.view().run?.counted !== 1) await new Promise(resolve => setTimeout(resolve, 2))
    while (camera.capture.view().run?.secondsLeft === undefined) await new Promise(resolve => setTimeout(resolve, 2))

    expect(await camera.capture.stop()).toBe(true)
    await started.done

    expect(camera.capture.view().last).toMatchObject({ reason: 'stopped', counted: 1, detail: 'Stop pressed, abort written' })
    expect(camera.script.sent.at(-1)).toEqual({ property: 'CCD_ABORT_EXPOSURE', values: { ABORT: true } })
    expect(camera.capture.view().run).toBeUndefined()
  })

  it('counts a frame in progress when Stop is pressed only if its file appears', async () => {
    const camera = fakeCamera({ exposures: ['nothing'] })
    const started = camera.capture.start({ ...request, count: 2, exposureSeconds: 5 })

    if (!started.ok) throw new Error(started.reason)

    while (camera.capture.view().run?.secondsLeft === undefined) await new Promise(resolve => setTimeout(resolve, 2))
    await camera.capture.stop()
    await started.done

    expect(camera.capture.view().last).toMatchObject({ reason: 'stopped', counted: 0 })
  })

  it('answers Stop with false when nothing is running', async () => {
    expect(await fakeCamera().capture.stop()).toBe(false)
  })

  it('marks a run found in the run file as interrupted, once, and clears the file', () => {
    const camera = fakeCamera()

    camera.plantRunFile({ run: 'run-old', startedAt: 1, object: 'M 31', frameType: 'light', count: 10, counted: 4 })

    expect(camera.capture.recoverInterrupted()).toMatchObject({ run: 'run-old', reason: 'interrupted', counted: 4 })
    expect(camera.capture.view().last).toMatchObject({ reason: 'interrupted', run: 'run-old' })
    expect(camera.events).toMatchObject([{ kind: 'ended', run: 'run-old', body: { reason: 'interrupted', counted: 4 } }])
    expect(camera.runFile.read()).toBeUndefined()
    expect(camera.capture.recoverInterrupted()).toBeUndefined()
  })

  it('writes the run file while running and does not resume anything on start', async () => {
    const camera = fakeCamera({ exposures: ['file', 'nothing'] })
    const started = camera.capture.start({ ...request, count: 5, exposureSeconds: 5 })

    if (!started.ok) throw new Error(started.reason)

    while (camera.capture.view().run?.counted !== 1) await new Promise(resolve => setTimeout(resolve, 2))

    expect(camera.runFile.read()).toMatchObject({ run: 'run-1', counted: 1, count: 5 })

    while (camera.capture.view().run?.secondsLeft === undefined) await new Promise(resolve => setTimeout(resolve, 2))
    await camera.capture.stop()
    await started.done
  })
})

describe('what a run does with commands that do not work', () => {
  it('ends the run, saying why, when a command is refused', async () => {
    const camera = fakeCamera()

    camera.script.refuse.set('CCD_FRAME_TYPE', 'CCD_FRAME_TYPE is kept by the rig file')

    expect(await runToEnd(camera)).toMatchObject({ reason: 'refused', detail: 'CCD_FRAME_TYPE: CCD_FRAME_TYPE is kept by the rig file', counted: 0 })
    expect(camera.script.sent.filter(sent => sent.property === 'CCD_EXPOSURE')).toHaveLength(0)
  })

  it('ends the run as unknown when a command gets no answer, and never sends it again', async () => {
    const camera = fakeCamera()

    camera.script.silent.add('CCD_CONTROLS')

    expect(await runToEnd(camera)).toMatchObject({ reason: 'unknown', detail: expect.stringContaining('CCD_CONTROLS: no answer') })
    expect(camera.script.sent.filter(sent => sent.property === 'CCD_CONTROLS')).toHaveLength(1)
  })

  it('ends the run as unknown when a command was written but the stream never shows it', async () => {
    const camera = fakeCamera()

    camera.script.ignore.add('CCD_FRAME_TYPE')

    expect(await runToEnd(camera)).toMatchObject({ reason: 'unknown', detail: expect.stringContaining('CCD_FRAME_TYPE was written but the stream does not show it') })
    expect(camera.script.sent.filter(sent => sent.property === 'CCD_FRAME_TYPE')).toHaveLength(1)
  })

  it('aborts and ends the run as unknown when the exposure command gets no answer', async () => {
    const camera = fakeCamera()

    camera.script.silent.add('CCD_EXPOSURE')

    expect(await runToEnd(camera)).toMatchObject({ reason: 'unknown', counted: 0 })
    expect(camera.script.sent.filter(sent => sent.property === 'CCD_EXPOSURE')).toHaveLength(1)
    expect(camera.script.sent.at(-1)?.property).toBe('CCD_ABORT_EXPOSURE')
  })
})

describe('the cooler across frames', () => {
  it('writes the setpoint again only after the cooler is found off', async () => {
    const camera = fakeCamera({ exposures: ['file', 'file', 'file'] })
    const started = camera.capture.start({ ...request, count: 3 })

    if (!started.ok) throw new Error(started.reason)

    while (camera.capture.view().run?.counted !== 1) await new Promise(resolve => setTimeout(resolve, 1))

    camera.set('CCD_COOLER', { COOLER_ON: false, COOLER_OFF: true })
    await started.done

    const coolerWrites = camera.script.sent.filter(sent => sent.property === 'CCD_COOLER' || sent.property === 'CCD_TEMPERATURE')

    expect(coolerWrites.map(sent => sent.property)).toEqual(['CCD_TEMPERATURE', 'CCD_COOLER', 'CCD_TEMPERATURE', 'CCD_COOLER'])
  })

  it('leaves the cooler alone when asked to keep it', async () => {
    const camera = fakeCamera({ omit: ['CCD_COOLER', 'CCD_TEMPERATURE'] })

    await runToEnd(camera, { ...request, cooler: 'keep', setpoint: -10 })

    expect(camera.script.sent.some(sent => sent.property === 'CCD_COOLER' || sent.property === 'CCD_TEMPERATURE')).toBe(false)
  })

  it('turns the cooler off when it is on and the run wants it off, and does not write a setpoint', async () => {
    const camera = fakeCamera()

    camera.set('CCD_COOLER', { COOLER_ON: true, COOLER_OFF: false })
    await runToEnd(camera, { ...request, cooler: 'off', count: 1 })

    expect(camera.script.sent.filter(sent => sent.property === 'CCD_COOLER')).toEqual([{ property: 'CCD_COOLER', values: { COOLER_ON: false, COOLER_OFF: true } }])
    expect(camera.script.sent.some(sent => sent.property === 'CCD_TEMPERATURE')).toBe(false)
  })
})

describe('starting a run', () => {
  it('refuses a run while one is going', async () => {
    const camera = fakeCamera({ exposures: ['nothing'] })
    const started = camera.capture.start({ ...request, exposureSeconds: 5 })

    if (!started.ok) throw new Error(started.reason)

    expect(camera.capture.start(request)).toEqual({ ok: false, reason: 'a capture is already running' })
    await camera.capture.stop()
    await started.done
  })

  it('refuses when the camera is not saving frames on the rig computer', () => {
    const camera = fakeCamera()

    camera.set('UPLOAD_MODE', { UPLOAD_CLIENT: true, UPLOAD_LOCAL: false, UPLOAD_BOTH: false })

    expect(camera.capture.start(request)).toMatchObject({ ok: false, reason: expect.stringContaining('not saving frames on the rig computer') })
  })

  it('refuses when the camera is already exposing', () => {
    const camera = fakeCamera()

    camera.set('CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 30 }, 'Busy')

    expect(camera.capture.start(request)).toEqual({ ok: false, reason: 'the camera is already exposing' })
  })

  it('refuses when the camera lacks a property the run needs to set', () => {
    expect(fakeCamera({ omit: ['CCD_COOLER'] }).capture.start(request)).toEqual({ ok: false, reason: 'the camera has no CCD_COOLER on the stream' })
  })

  it('refuses a request that is not a capture request', () => {
    expect(fakeCamera().capture.start({ ...request, count: 0 })).toMatchObject({ ok: false })
  })
})
