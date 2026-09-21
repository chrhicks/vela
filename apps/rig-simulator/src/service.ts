import { z } from 'zod'
import Fastify from 'fastify'
import { Readable } from 'node:stream'
import {
  acceptsImageBytes,
  encodeImageBytes,
  imageBytesError,
  imageJsonChunks,
} from './image-bytes.js'
import type { FastifyRequest } from 'fastify'
import { cameraGeometry } from './optics.js'
import type { Star, StarSource } from './catalog.js'
import { SimulatorError, SimulatorRuntime } from './runtime.js'

const parameterValue = z.json()

const parameterSchema = z
  .record(z.string(), parameterValue)
  .nullish()
  .transform(value => {
    const result = new Map<string, z.infer<typeof parameterValue>>()

    for (const [key, item] of Object.entries(value ?? {})) {
      const name = key.toLowerCase()

      if (result.has(name)) throw new SimulatorError(0x401, `Duplicate parameter ${key}`)
      result.set(name, item)
    }

    return result
  })
  .catch(() => {
    throw new SimulatorError(0x401, 'Expected named parameters')
  })

type AlpacaParameters = z.infer<typeof parameterSchema>

const parameters = parameterSchema.parse

const numericParameter = z
  .union([z.number(), z.string().regex(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i)])
  .transform(Number)
  .refine(Number.isFinite)

function numberParameter(params: AlpacaParameters, key: string) {
  const parsed = numericParameter.safeParse(params.get(key))

  if (!parsed.success) throw new SimulatorError(0x401, `Invalid ${key}`)

  return parsed.data
}

const booleanValue = z.union([
  z.boolean(),
  z
    .string()
    .toLowerCase()
    .pipe(z.enum(['true', 'false']))
    .transform(value => value === 'true'),
])

function booleanParameter(params: AlpacaParameters, key: string) {
  const parsed = booleanValue.safeParse(params.get(key))

  if (!parsed.success) throw new SimulatorError(0x401, `Invalid ${key}`)

  return parsed.data
}

function axisParameter(params: AlpacaParameters) {
  const axis = numberParameter(params, 'axis')

  if (![0, 1, 2].includes(axis)) throw new SimulatorError(0x401, 'Invalid axis')

  return axis
}

export function buildSimulator({
  stars,
  now,
}: {
  stars: readonly Star[] | StarSource
  now?: () => number
}) {
  // Match Node's idle timeout: longer-lived sockets stalled later PUTs with
  // Node 26's fetch client during the real movement/stop integration proof.
  const app = Fastify({
    keepAliveTimeout: 5000,
    routerOptions: { ignoreTrailingSlash: true, caseSensitive: false },
  })

  const runtime = new SimulatorRuntime(stars, now)
  let transaction = 0
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      const params: Record<string, string | string[]> = {}

      for (const [key, value] of new URLSearchParams(z.string().parse(body))) {
        const name = key.toLowerCase()
        params[name] = Object.hasOwn(params, name)
          ? [...(Array.isArray(params[name]) ? params[name] : [params[name]!]), value]
          : value
      }

      done(null, params)
    },
  )
  app.get('/simulator/state', async () => runtime.state())

  function control(request: FastifyRequest, action: (body: AlpacaParameters) => void) {
    if (!request.headers['content-type']?.startsWith('application/json'))
      throw new SimulatorError(0x401, 'Simulator controls require JSON')

    if (
      request.headers.origin &&
      ![
        'http://localhost:5177',
        'http://127.0.0.1:5177',
        'http://localhost:7850',
        'http://127.0.0.1:7850',
      ].includes(request.headers.origin)
    )
      throw new SimulatorError(0x401, 'Origin is not permitted')
    action(parameters(request.body))

    return runtime.state()
  }

  app.put('/simulator/adjust', async request =>
    control(request, body => {
      const offsets = z
        .tuple([z.number(), z.number()])
        .safeParse([body.get('altitudearcsec'), body.get('azimutharcsec')])

      if (!offsets.success) throw new SimulatorError(0x401, 'Offsets must be numbers')
      runtime.adjust(...offsets.data)
    }),
  )
  app.put('/simulator/camera', async request =>
    control(request, body => {
      const obscured = body.get('obscured')
      const resolution = body.get('resolution')

      if (obscured !== undefined && obscured !== true && obscured !== false)
        throw new SimulatorError(0x401, 'Obscured must be a boolean')

      if (resolution !== undefined && resolution !== 'fast' && resolution !== 'full')
        throw new SimulatorError(0x401, 'Unknown resolution')

      const cameraNumber =
        body.get('cameranumber') === undefined ? 0 : numberParameter(body, 'cameranumber')

      if (!Number.isInteger(cameraNumber) || ![0, 1].includes(cameraNumber))
        throw new SimulatorError(0x401, 'Unknown camera')

      if (obscured === undefined && resolution === undefined)
        throw new SimulatorError(0x401, 'Camera control is empty')

      // Configure first: a rejected busy/unsupported mode must not change obstruction.
      if (resolution !== undefined) runtime.configureCamera(cameraNumber, resolution)

      if (obscured !== undefined) runtime.setObscured(obscured)
    }),
  )
  app.post('/simulator/reset', async request =>
    control(request, body => {
      const preset = body.get('preset')

      if (preset !== 'large-error' && preset !== 'near-aligned' && preset !== 'aligned')
        throw new SimulatorError(0x401, 'Unknown preset')
      runtime.reset(preset)
    }),
  )
  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : 'Invalid request'

    if (request.url.startsWith('/simulator/'))
      return reply
        .code(error instanceof SimulatorError && error.number === 0x40b ? 409 : 400)
        .send({ error: message })
    const httpError = z.object({ statusCode: z.number() }).safeParse(error)
    const status = httpError.success ? httpError.data.statusCode : 500

    return reply.code(status).send({ error: message })
  })
  app.get('/management/apiversions', async () => ({
    Value: [1],
    ClientTransactionID: 0,
    ServerTransactionID: ++transaction,
    ErrorNumber: 0,
    ErrorMessage: '',
  }))
  app.get('/management/v1/description', async () => ({
    Value: {
      ServerName: 'Vela Rig Simulator',
      Manufacturer: 'Vela',
      ManufacturerVersion: '0.0.0',
      Location: 'Local development',
    },
    ClientTransactionID: 0,
    ServerTransactionID: ++transaction,
    ErrorNumber: 0,
    ErrorMessage: '',
  }))
  app.get('/management/v1/configureddevices', async () => ({
    Value: [
      {
        DeviceName: 'Simulator Camera',
        DeviceType: 'Camera',
        DeviceNumber: 0,
        UniqueID: 'vela-simulator-camera',
      },
      {
        DeviceName: 'Simulator Color Camera',
        DeviceType: 'Camera',
        DeviceNumber: 1,
        UniqueID: 'vela-simulator-color-camera',
      },
      {
        DeviceName: 'Simulator Telescope',
        DeviceType: 'Telescope',
        DeviceNumber: 0,
        UniqueID: 'vela-simulator-telescope',
      },
    ],
    ClientTransactionID: 0,
    ServerTransactionID: ++transaction,
    ErrorNumber: 0,
    ErrorMessage: '',
  }))
  app.route<{ Params: { device: string; number: string; member: string } }>({
    method: ['GET', 'PUT'],
    url: '/api/v1/:device/:number/:member',
    handler: async (request, reply) => {
      const envelope = {
        ClientTransactionID: 0,
        ServerTransactionID: ++transaction,
        ErrorNumber: 0,
        ErrorMessage: '',
      }

      try {
        const params = parameters(request.method === 'GET' ? request.query : request.body)

        for (const key of ['clientid', 'clienttransactionid']) {
          if (params.get(key) === undefined) continue
          const id = numberParameter(params, key)

          if (!Number.isInteger(id) || id < 0 || id > 4294967295)
            throw new SimulatorError(0x401, `Invalid ${key}`)

          if (key === 'clienttransactionid') envelope.ClientTransactionID = id
        }

        const device = request.params.device.toLowerCase()
        const member = request.params.member.toLowerCase()

        if (
          (device !== 'camera' && device !== 'telescope') ||
          !(request.params.number === '0' || (device === 'camera' && request.params.number === '1'))
        )
          return reply.code(404).send({ error: 'Unknown simulator device' })
        const kind = device
        const cameraNumber = Number(request.params.number)
        const state = runtime.state()
        const camera = runtime.cameraState(cameraNumber)

        if (member === 'connected') {
          if (request.method === 'GET')
            return {
              ...envelope,
              Value: kind === 'camera' ? camera.connected : state.telescopeConnected,
            }
          runtime.connect(kind, booleanParameter(params, 'connected'), cameraNumber)

          return envelope
        }

        const common = {
          name: `Simulator ${kind === 'camera' ? (cameraNumber === 1 ? 'Color Camera' : 'Camera') : 'Telescope'}`,
          description: 'Development-only Vela sky simulator',
          driverinfo: 'Bounded Alpaca subset for local development',
          driverversion: '0.0.0',
          interfaceversion: 3,
          supportedactions: [],
        }

        const commonEntry = Object.entries(common).find(([key]) => key === member)

        if (request.method === 'GET' && commonEntry) return { ...envelope, Value: commonEntry[1] }
        runtime.requireConnected(kind, cameraNumber)

        if (request.method === 'GET') {
          if (kind === 'camera') {
            const values = {
              camerastate: camera.activity === 'exposing' ? 2 : 0,
              imageready: camera.imageReady,
              cameraxsize: camera.width,
              cameraysize: camera.height,
              numx: camera.width,
              numy: camera.height,
              startx: 0,
              starty: 0,
              binx: 1,
              biny: 1,
              maxbinx: 1,
              maxbiny: 1,
              sensortype: camera.sensor === 'rggb' ? 2 : 0,
              sensorname: camera.sensor === 'rggb' ? 'Synthetic RGGB' : 'Synthetic monochrome',
              maxadu: camera.sensor === 'rggb' ? 65535 : 32767,
              pixelsizex: cameraGeometry(camera.resolution).pixelSizeMicrons,
              pixelsizey: cameraGeometry(camera.resolution).pixelSizeMicrons,
              canabortexposure: true,
              canstopexposure: false,
              canasymmetricbin: false,
              cansetccdtemperature: false,
              cangetcoolerpower: false,
              hasshutter: true,
              exposuremin: 0,
              exposuremax: 3600,
              exposureresolution: 0.001,
            }

            const entry = Object.entries(values).find(([key]) => key === member)

            if (entry) return { ...envelope, Value: entry[1] }

            if (
              camera.sensor === 'rggb' &&
              (member === 'bayeroffsetx' || member === 'bayeroffsety')
            )
              return { ...envelope, Value: 0 }

            if (member === 'imagearray') {
              const frame = await runtime.frame(cameraNumber)
              const assertCurrent = frame.assertCurrent

              if (acceptsImageBytes(request.headers.accept)) {
                const bytes = await encodeImageBytes(frame, envelope, assertCurrent)

                return reply.type('application/imagebytes').send(bytes)
              }

              return reply
                .type('application/json')
                .send(Readable.from(imageJsonChunks(frame, envelope, assertCurrent)))
            }

            if (member === 'lastexposureduration')
              return { ...envelope, Value: runtime.lastExposure(cameraNumber).duration }

            if (member === 'lastexposurestarttime')
              return { ...envelope, Value: runtime.lastExposure(cameraNumber).timestamp }
          } else {
            const values = {
              atpark: false,
              athome: false,
              slewing: state.slewing,
              tracking: state.tracking,
              rightascension: state.rightAscensionHours,
              declination: state.declinationDegrees,
              cansettracking: true,
              canpark: false,
              canunpark: false,
              canfindhome: false,
              canslew: false,
              canslewasync: true,
              cansync: false,
              canpulseguide: false,
              equatorialsystem: 2,
              alignmentmode: 2,
              sitelatitude: 40,
              sitelongitude: -75,
              siteelevation: 0,
              siderealtime: runtime.siderealTimeHours(),
            }

            const entry = Object.entries(values).find(([key]) => key === member)

            if (entry) return { ...envelope, Value: entry[1] }

            if (member === 'canmoveaxis') return { ...envelope, Value: axisParameter(params) === 0 }

            if (member === 'axisrates')
              return {
                ...envelope,
                Value: axisParameter(params) === 0 ? [{ Minimum: 0, Maximum: 1.5 }] : [],
              }
          }
        } else if (kind === 'camera') {
          if (member === 'startexposure') {
            runtime.startExposure(
              numberParameter(params, 'duration'),
              booleanParameter(params, 'light'),
              cameraNumber,
            )

            return envelope
          }

          if (member === 'abortexposure') {
            runtime.abortExposure(cameraNumber)

            return envelope
          }

          const fixed = {
            binx: 1,
            biny: 1,
            startx: 0,
            starty: 0,
            numx: camera.width,
            numy: camera.height,
          }

          const entry = Object.entries(fixed).find(([key]) => key === member)

          if (entry) {
            if (numberParameter(params, member) !== entry[1])
              throw new SimulatorError(0x401, `${member} is fixed at ${entry[1]}`)

            return envelope
          }
        } else {
          if (member === 'tracking') {
            runtime.setTracking(booleanParameter(params, 'tracking'))

            return envelope
          }

          if (member === 'abortslew') {
            runtime.stop()

            return envelope
          }

          if (member === 'slewtocoordinatesasync') {
            runtime.slewTo(
              numberParameter(params, 'rightascension'),
              numberParameter(params, 'declination'),
            )

            return envelope
          }

          if (member === 'moveaxis') {
            if (axisParameter(params) !== 0)
              throw new SimulatorError(0x400, 'Only the RA axis supports MoveAxis')
            runtime.move(numberParameter(params, 'rate'))

            return envelope
          }
        }

        throw new SimulatorError(0x400, `${member} is not implemented`)
      } catch (error) {
        if (!(error instanceof SimulatorError)) throw error
        const failure = { ...envelope, ErrorNumber: error.number, ErrorMessage: error.message }

        if (
          request.method === 'GET' &&
          request.params.device.toLowerCase() === 'camera' &&
          request.params.member.toLowerCase() === 'imagearray' &&
          acceptsImageBytes(request.headers.accept)
        ) {
          return reply.type('application/imagebytes').send(imageBytesError(failure))
        }

        return failure
      }
    },
  })

  return app
}
