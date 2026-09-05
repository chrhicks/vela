import Fastify from 'fastify'
import type { FastifyRequest } from 'fastify'
import type { Star } from './catalog.js'
import { SimulatorError, SimulatorRuntime, imageHeight, imageWidth } from './runtime.js'

function parameters(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new SimulatorError(0x401, 'Expected named parameters')
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const name = key.toLowerCase()
    if (Object.hasOwn(result, name)) throw new SimulatorError(0x401, `Duplicate parameter ${key}`)
    result[name] = item
  }
  return result
}
function numberParameter(params: Record<string, unknown>, key: string) {
  const value = params[key]
  if ((typeof value !== 'number' && typeof value !== 'string') || value === ''
    || (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) throw new SimulatorError(0x401, `Invalid ${key}`)
  const number = Number(value)
  if (!Number.isFinite(number)) throw new SimulatorError(0x401, `Invalid ${key}`)
  return number
}
function booleanParameter(params: Record<string, unknown>, key: string) {
  const value = params[key]
  if (value === true || typeof value === 'string' && value.toLowerCase() === 'true') return true
  if (value === false || typeof value === 'string' && value.toLowerCase() === 'false') return false
  throw new SimulatorError(0x401, `Invalid ${key}`)
}
function axisParameter(params: Record<string, unknown>) {
  const axis = numberParameter(params, 'axis')
  if (![0, 1, 2].includes(axis)) throw new SimulatorError(0x401, 'Invalid axis')
  return axis
}

export function buildSimulator({ stars, now }: { stars: readonly Star[]; now?: () => number }) {
  const app = Fastify({ routerOptions: { ignoreTrailingSlash: true, caseSensitive: false } })
  const runtime = new SimulatorRuntime(stars, now)
  let transaction = 0
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    const params: Record<string, unknown> = {}
    for (const [key, value] of new URLSearchParams(body as string)) {
      const name = key.toLowerCase()
      params[name] = Object.hasOwn(params, name) ? [params[name], value] : value
    }
    done(null, params)
  })
  app.get('/simulator/state', async () => runtime.state())
  function control(request: FastifyRequest, action: (body: Record<string, unknown>) => void) {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new SimulatorError(0x401, 'Simulator controls require JSON')
    if (request.headers.origin && !['http://localhost:5177', 'http://127.0.0.1:5177', 'http://localhost:7850', 'http://127.0.0.1:7850'].includes(request.headers.origin)) throw new SimulatorError(0x401, 'Origin is not permitted')
    action(parameters(request.body))
    return runtime.state()
  }
  app.put('/simulator/adjust', async request => control(request, body => {
    if (typeof body.altitudearcsec !== 'number' || typeof body.azimutharcsec !== 'number') throw new SimulatorError(0x401, 'Offsets must be numbers')
    runtime.adjust(body.altitudearcsec, body.azimutharcsec)
  }))
  app.put('/simulator/camera', async request => control(request, body => {
    if (typeof body.obscured !== 'boolean') throw new SimulatorError(0x401, 'Obscured must be a boolean')
    runtime.setObscured(body.obscured)
  }))
  app.post('/simulator/reset', async request => control(request, body => {
    if (body.preset !== 'large-error' && body.preset !== 'near-aligned' && body.preset !== 'aligned') throw new SimulatorError(0x401, 'Unknown preset')
    runtime.reset(body.preset)
  }))
  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : 'Invalid request'
    if (request.url.startsWith('/simulator/')) return reply.code(error instanceof SimulatorError && error.number === 0x40b ? 409 : 400).send({ error: message })
    const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500
    return reply.code(status).send({ error: message })
  })
  app.get('/management/apiversions', async () => ({ Value: [1], ClientTransactionID: 0, ServerTransactionID: ++transaction, ErrorNumber: 0, ErrorMessage: '' }))
  app.get('/management/v1/description', async () => ({ Value: { ServerName: 'Vela Rig Simulator', Manufacturer: 'Vela', ManufacturerVersion: '0.0.0', Location: 'Local development' }, ClientTransactionID: 0, ServerTransactionID: ++transaction, ErrorNumber: 0, ErrorMessage: '' }))
  app.get('/management/v1/configureddevices', async () => ({ Value: [
    { DeviceName: 'Simulator Camera', DeviceType: 'Camera', DeviceNumber: 0, UniqueID: 'vela-simulator-camera' },
    { DeviceName: 'Simulator Telescope', DeviceType: 'Telescope', DeviceNumber: 0, UniqueID: 'vela-simulator-telescope' },
  ], ClientTransactionID: 0, ServerTransactionID: ++transaction, ErrorNumber: 0, ErrorMessage: '' }))
  app.route<{ Params: { device: string; number: string; member: string } }>({
    method: ['GET', 'PUT'], url: '/api/v1/:device/:number/:member',
    handler: async (request, reply) => {
      const envelope = { ClientTransactionID: 0, ServerTransactionID: ++transaction, ErrorNumber: 0, ErrorMessage: '' }
      try {
        const params = parameters(request.method === 'GET' ? request.query : request.body)
        for (const key of ['clientid', 'clienttransactionid']) {
          if (params[key] === undefined) continue
          const id = numberParameter(params, key)
          if (!Number.isInteger(id) || id < 0 || id > 4294967295) throw new SimulatorError(0x401, `Invalid ${key}`)
          if (key === 'clienttransactionid') envelope.ClientTransactionID = id
        }
        const device = request.params.device.toLowerCase()
        const member = request.params.member.toLowerCase()
        if (!['camera', 'telescope'].includes(device) || request.params.number !== '0') return reply.code(404).send({ error: 'Unknown simulator device' })
        const kind = device as 'camera' | 'telescope'
        const state = runtime.state()
        if (member === 'connected') {
          if (request.method === 'GET') return { ...envelope, Value: kind === 'camera' ? state.cameraConnected : state.telescopeConnected }
          runtime.connect(kind, booleanParameter(params, 'connected'))
          return envelope
        }
        const common: Record<string, unknown> = { name: `Simulator ${kind === 'camera' ? 'Camera' : 'Telescope'}`,
          description: 'Development-only Vela sky simulator', driverinfo: 'Bounded Alpaca subset for local development',
          driverversion: '0.0.0', interfaceversion: 3, supportedactions: [] }
        if (request.method === 'GET' && Object.hasOwn(common, member)) return { ...envelope, Value: common[member] }
        runtime.requireConnected(kind)
        if (request.method === 'GET') {
          if (kind === 'camera') {
            const values: Record<string, unknown> = { camerastate: state.cameraActivity === 'exposing' ? 2 : 0,
              imageready: state.imageReady, cameraxsize: imageWidth, cameraysize: imageHeight,
              numx: imageWidth, numy: imageHeight, startx: 0, starty: 0, binx: 1, biny: 1,
              maxbinx: 1, maxbiny: 1, sensortype: 0, sensorname: 'Synthetic monochrome',
              maxadu: 32767, pixelsizex: 3.76, pixelsizey: 3.76, canabortexposure: true,
              canstopexposure: false, canasymmetricbin: false, cansetccdtemperature: false,
              cangetcoolerpower: false, hasshutter: true, exposuremin: 0, exposuremax: 3600, exposureresolution: 0.001 }
            if (Object.hasOwn(values, member)) return { ...envelope, Value: values[member] }
            if (member === 'imagearray') return { ...envelope, Type: 2, Rank: 2, Value: runtime.image() }
            if (member === 'lastexposureduration') return { ...envelope, Value: runtime.lastExposure().duration }
            if (member === 'lastexposurestarttime') return { ...envelope, Value: runtime.lastExposure().timestamp }
          } else {
            const values: Record<string, unknown> = { atpark: false, athome: false, slewing: state.raRateDegreesPerSecond !== 0,
              tracking: state.tracking, rightascension: state.rightAscensionHours, declination: state.declinationDegrees,
              cansettracking: true, canpark: false, canunpark: false, canfindhome: false, canslew: false,
              canslewasync: false, cansync: false, canpulseguide: false, equatorialsystem: 0,
              alignmentmode: 2, sitelatitude: 40 }
            if (Object.hasOwn(values, member)) return { ...envelope, Value: values[member] }
            if (member === 'canmoveaxis') return { ...envelope, Value: axisParameter(params) === 0 }
            if (member === 'axisrates') return { ...envelope, Value: axisParameter(params) === 0 ? [{ Minimum: 0, Maximum: 1.5 }] : [] }
          }
        } else if (kind === 'camera') {
          if (member === 'startexposure') {
            runtime.startExposure(numberParameter(params, 'duration'), booleanParameter(params, 'light'))
            return envelope
          }
          if (member === 'abortexposure') {
            runtime.abortExposure()
            return envelope
          }
          const fixed: Record<string, number> = { binx: 1, biny: 1, startx: 0, starty: 0, numx: imageWidth, numy: imageHeight }
          if (Object.hasOwn(fixed, member)) {
            if (numberParameter(params, member) !== fixed[member]) throw new SimulatorError(0x401, `${member} is fixed at ${fixed[member]}`)
            return envelope
          }
        } else {
          if (member === 'tracking') {
            runtime.setTracking(booleanParameter(params, 'tracking'))
            return envelope
          }
          if (member === 'abortslew') {
            runtime.move(0)
            return envelope
          }
          if (member === 'moveaxis') {
            if (axisParameter(params) !== 0) throw new SimulatorError(0x400, 'Only the RA axis supports MoveAxis')
            runtime.move(numberParameter(params, 'rate'))
            return envelope
          }
        }
        throw new SimulatorError(0x400, `${member} is not implemented`)
      } catch (error) {
        if (!(error instanceof SimulatorError)) throw error
        return { ...envelope, ErrorNumber: error.number, ErrorMessage: error.message }
      }
    },
  })
  return app
}
