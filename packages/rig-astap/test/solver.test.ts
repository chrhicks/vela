import { chmod, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { astapVersion, createAstapSolver, solveFile, solveFrame, writeFits } from '@vela/rig-astap'
import { fakeAstap, frame, imageId, workDirectory } from './support.ts'

const hint = { raDegrees: 90, decDegrees: 10 }

const request = { imageId, hint, solverVersion: 'astap-fake' }

const signal = () => new AbortController().signal

let directory: string

beforeEach(async () => {
  directory = await workDirectory()
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function solverFor(executable: string, timeoutMs?: number) {
  const options = { executable, catalogPath: directory, fieldHeightDegrees: 1.2, workDirectory: directory }

  return createAstapSolver(timeoutMs ? { ...options, timeoutMs } : options)
}

describe('createAstapSolver', () => {
  it('widens the search radius until ASTAP solves, and reports the radius that worked', async () => {
    const { executable, log } = await fakeAstap(directory, { solvesFrom: 30 })
    const result = await solverFor(executable).solve(frame(), hint, signal())

    expect(result).toMatchObject({ status: 'solved', radiusDegrees: 30, centre: { raDegrees: 91.5, decDegrees: 10.25 } })
    expect((await readFile(log, 'utf8')).trim().split('\n').map(line => line.split(' ').at(line.split(' ').indexOf('-r') + 1))).toEqual(['10', '15', '30'])
  })

  it('passes the hint as hours and south-pole distance, and filters Bayer frames', async () => {
    const { executable, log } = await fakeAstap(directory, {})
    await solverFor(executable).solve(frame(), hint, signal())
    const args = (await readFile(log, 'utf8')).trim().split(' ')

    expect(args[args.indexOf('-ra') + 1]).toBe('6')
    expect(args[args.indexOf('-spd') + 1]).toBe('100')
    expect(args[args.indexOf('-fov') + 1]).toBe('1.2')
    expect(args.slice(args.indexOf('-check'), args.indexOf('-check') + 2)).toEqual(['-check', 'y'])
  })

  it('does not filter a mono frame', async () => {
    const { executable, log } = await fakeAstap(directory, {})
    await solverFor(executable).solve(frame({ color: { kind: 'mono' } }), hint, signal())

    expect(await readFile(log, 'utf8')).not.toContain('-check')
  })

  it('stops at the first radius when ASTAP finds too few stars', async () => {
    const { executable, log } = await fakeAstap(directory, { exit: 2 })
    const result = await solverFor(executable).solve(frame(), hint, signal())

    expect(result).toEqual({ status: 'no-solution', reason: 'too-few-stars', radiusDegrees: 10 })
    expect((await readFile(log, 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('reports no match once the whole sky has been searched', async () => {
    const { executable, log } = await fakeAstap(directory, { exit: 1 })
    const result = await solverFor(executable).solve(frame(), hint, signal())

    expect(result).toEqual({ status: 'no-solution', reason: 'no-match', radiusDegrees: 180 })
    expect((await readFile(log, 'utf8')).trim().split('\n')).toHaveLength(6)
  })

  it('leaves nothing behind in its work directory', async () => {
    const { executable } = await fakeAstap(directory, {})
    await solverFor(executable).solve(frame(), hint, signal())

    expect((await readdir(directory)).filter(name => name.startsWith('rig-astap-'))).toEqual([])
  })

  it('rejects a hint outside the sky and a configuration it cannot run', async () => {
    const { executable } = await fakeAstap(directory, {})

    await expect(solverFor(executable).solve(frame(), { raDegrees: 400, decDegrees: 0 }, signal())).rejects.toThrow('Invalid plate coordinates')
    expect(() => createAstapSolver({ executable, catalogPath: directory, fieldHeightDegrees: 0 })).toThrow('Invalid ASTAP configuration')
  })
})

describe('solveFrame', () => {
  it('turns a solution into a solve fact in ASTAP’s own J2000 frame', async () => {
    const { executable } = await fakeAstap(directory, { solvesFrom: 15 })
    const body = await solveFrame(solverFor(executable), request, frame(), signal())

    expect(body).toMatchObject({
      status: 'solved',
      imageId,
      solverVersion: 'astap-fake',
      hint: { raDegrees: 90, decDegrees: 10, radiusDegrees: 15 },
      centre: { raDegrees: 91.5, decDegrees: 10.25 },
      wcs: { width: 64, height: 48, referenceX: 32.5, referenceY: 24.5 },
    })
  })

  it('turns a failure into a fact with its reason', async () => {
    const noMatch = await fakeAstap(directory, { exit: 1 })
    expect(await solveFrame(solverFor(noMatch.executable), request, frame(), signal())).toMatchObject({ status: 'no-solution', reason: 'no-match' })

    const crash = await fakeAstap(directory, { exit: 3 })
    expect(await solveFrame(solverFor(crash.executable), request, frame(), signal())).toMatchObject({ status: 'no-solution', reason: 'solver-error', hint: null })
  })

  it('reports a timeout as a timeout, not as an error', async () => {
    const { executable } = await fakeAstap(directory, { sleepSeconds: 5 })
    const body = await solveFrame(solverFor(executable, 300), request, frame(), signal())

    expect(body).toMatchObject({ status: 'no-solution', reason: 'timeout' })
  })

  it('lets a cancelled solve escape, because it says nothing about the frame', async () => {
    const { executable } = await fakeAstap(directory, { sleepSeconds: 5 })
    const controller = new AbortController()
    const pending = solveFrame(solverFor(executable), request, frame(), controller.signal)
    setTimeout(() => controller.abort(new Error('cancelled')), 100)

    await expect(pending).rejects.toThrow('cancelled')
  })
})

describe('solveFile', () => {
  it('solves a saved FITS file', async () => {
    const { executable } = await fakeAstap(directory, {})
    const path = join(directory, 'saved.fits')
    await writeFile(path, writeFits(frame()))

    expect(await solveFile(solverFor(executable), request, path, signal())).toMatchObject({ status: 'solved' })
  })

  it('says the image is missing, or unreadable, instead of throwing', async () => {
    const { executable } = await fakeAstap(directory, {})
    const garbage = join(directory, 'garbage.fits')
    await writeFile(garbage, 'not a fits file')

    expect(await solveFile(solverFor(executable), request, join(directory, 'absent.fits'), signal())).toMatchObject({ reason: 'image-missing' })
    expect(await solveFile(solverFor(executable), request, garbage, signal())).toMatchObject({ reason: 'image-unreadable' })
  })
})

describe('astapVersion', () => {
  it('reads the version ASTAP prints for -h', async () => {
    const executable = join(directory, 'astap_cli')
    await writeFile(executable, '#!/bin/bash\necho "ASTAP astrometric solver version CLI-2026.09.01"\necho "Usage:"\n')
    await chmod(executable, 0o755)

    expect(await astapVersion(executable)).toBe('astap-CLI-2026.09.01')
  })

  it('fails when the program prints no version', async () => {
    const executable = join(directory, 'astap_cli')
    await writeFile(executable, '#!/bin/bash\necho hello\n')
    await chmod(executable, 0o755)

    await expect(astapVersion(executable)).rejects.toThrow('did not print a version')
  })
})
