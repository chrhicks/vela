import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { SwitchControl } from '@vela/equipment'
import type {
  DewChannelView,
  DewControlView,
  MountControlAvailability,
  RigDetailView,
  RigSwitchChannelView,
  RigSwitchDeviceView,
} from '@vela/model/web'
import type { RigCatalog } from './catalog.js'
import type { RigCatalogRecord } from './contracts.js'
import { inspectRigDetail, type RigDetailOptions } from './detail.js'
import { rigDeviceId } from '../web/rig-detail.js'

interface DewControlOptions {
  createSwitchControl(rig: RigCatalogRecord): SwitchControl | undefined
  createInspector: RigDetailOptions['createInspector']
}

type Command = NonNullable<DewControlView['command']>

interface CommandRecord {
  expectedSwitchName: string
  view: Command
}

const checkSchema = z.strictObject({
  deviceId: z.string().min(1),
  requestId: z.uuid(),
  serverInstanceId: z.uuid(),
})

const requestSchema = checkSchema.extend({
  action: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('auto'), on: z.boolean() }),
    z.strictObject({ kind: z.literal('duty'), channelId: z.int().min(0), percent: z.number().min(0).max(100) }),
  ]),
})

/** The PPBA holds a duty in 1/255 steps, so a confirmed 10 % reads back as 9.8 %. */
const dutyTolerancePercent = 0.4

const grid = (channel: RigSwitchChannelView) => ({
  minimum: Math.max(channel.minimum ?? 0, 0),
  maximum: Math.min(channel.maximum ?? 100, 100),
  step: channel.step !== undefined && channel.step > 0 ? channel.step : 1,
})

const onGrid = (percent: number, { minimum, maximum, step }: ReturnType<typeof grid>) => {
  const steps = (percent - minimum) / step

  return percent >= minimum && percent <= maximum && Math.abs(steps - Math.round(steps)) < 1e-9
}

const enabled: MountControlAvailability = { enabled: true, reason: null }

function disabled(reason: string): MountControlAvailability {
  return { enabled: false, reason }
}

/**
 * The channels Vela offers, by the names Cria gives the PPBA's: "Auto dew", "Dew A duty (%)", "Dew B duty (%)".
 * The box also has binary "Dew A" and "Dew B" outputs (0 or 1) that are not duties and are not offered.
 */
function dewChannelKind(channel: RigSwitchChannelView): 'auto' | 'duty' | undefined {
  if (/^auto dew$/i.test(channel.name.trim())) return 'auto'

  return /^dew\b.*\bduty\b/i.test(channel.name.trim()) ? 'duty' : undefined
}

function autoIsOn(channel: RigSwitchChannelView) {
  return channel.on ?? (channel.value === undefined ? undefined : channel.value > 0)
}

function dutyLabel(percent: number) {
  return `${Math.round(percent * 10) / 10}%`
}

function dewChannelsOf(device: RigSwitchDeviceView) {
  const channels = device.status.availability === 'complete' || device.status.availability === 'partial'
    ? device.status.channels ?? []
    : []

  return {
    auto: channels.find(channel => dewChannelKind(channel) === 'auto'),
    duties: channels.filter(channel => dewChannelKind(channel) === 'duty'),
  }
}

/** Which switch channel an action writes and whether it may run now; undefined when the box has no such dew channel. */
function targetOf(action: z.infer<typeof requestSchema>['action'], device: RigSwitchDeviceView, view: DewControlView) {
  if (action.kind === 'auto') {
    const channel = dewChannelsOf(device).auto

    return view.auto && channel && { availability: view.auto.set, channelId: channel.id, value: action.on ? 1 : 0 }
  }

  const channel = view.channels.find(item => item.id === action.channelId)

  return channel && { availability: channel.set, channelId: channel.id, value: action.percent }
}

/** The unknown outcome is settled only by what the box reports now, never by sending the change again. */
function reconcile(command: CommandRecord | undefined, device: RigSwitchDeviceView) {
  if (command?.view.state !== 'uncertain' || command.expectedSwitchName !== device.name) return

  if (device.observation?.state === 'interrupted' || device.observation?.commandReady === false) return
  const { auto, duties } = dewChannelsOf(device)
  const { action } = command.view

  let reached: boolean | undefined

  if (action.kind === 'auto') {
    const on = auto && autoIsOn(auto)

    reached = on === undefined ? undefined : on === action.on
  } else {
    const duty = duties.find(channel => channel.id === action.channelId)?.value

    reached = duty === undefined ? undefined : Math.abs(duty - action.percent) <= dutyTolerancePercent
  }

  if (reached === undefined) return

  command.view = {
    requestId: command.view.requestId,
    action,
    state: reached ? 'confirmed' : 'failed',
    message: reached
      ? 'The requested dew heater setting is now confirmed.'
      : 'Fresh readings show the requested dew heater setting was not reached.',
  }
}

/** Auto dew, and a fixed duty per dew channel, through the switch. Nothing else on the box is reachable. */
export function registerDewControls(app: FastifyInstance, catalog: RigCatalog, options: DewControlOptions) {
  const serverInstanceId = randomUUID()
  const commands = new Map<string, CommandRecord>()
  const admittedRequests = new Set<string>()
  const retiredRequests = new Set<string>()
  const sending = new Set<string>()
  const key = (rigId: string, deviceId: string) => JSON.stringify([rigId, deviceId])

  /**
   * `ownsSlot`: the caller is the request in flight.
   * `afterWrite`: the device was read before the write, so it cannot settle an unknown outcome.
   */
  function controls(
    rigId: string,
    device: RigSwitchDeviceView,
    { ownsSlot = false, afterWrite = false } = {},
  ): DewControlView | undefined {
    const { auto, duties } = dewChannelsOf(device)

    if (duties.length === 0) return undefined
    const command = commands.get(key(rigId, device.id))

    if (!afterWrite) reconcile(command, device)
    let reason: string | undefined

    if (!ownsSlot && sending.has(key(rigId, device.id)) || command?.view.state === 'pending')
      reason = 'Waiting for the power box to confirm the change.'
    else if (command?.view.state === 'uncertain')
      reason = 'The previous dew heater change is uncertain. Check the state; no change will be repeated.'
    else if (device.observation?.hold) reason = 'The power box is held. Clear the hold first.'
    else if (device.observation?.state === 'interrupted' || device.observation?.commandReady === false)
      reason = 'Fresh dew heater readings are unavailable.'

    const autoOn = auto && autoIsOn(auto)

    const duty = (): MountControlAvailability => {
      if (reason) return disabled(reason)

      if (auto && autoOn === undefined) return disabled('Auto dew state is unknown.')

      return autoOn ? disabled('Auto dew is on') : enabled
    }

    const channels: DewChannelView[] = duties.map(channel => ({
      id: channel.id,
      name: channel.name,
      ...grid(channel),
      dutyPercent: channel.value ?? null,
      set: duty(),
    }))

    return {
      serverInstanceId,
      auto: auto
        ? { on: autoOn ?? null, set: reason ? disabled(reason) : autoOn === undefined ? disabled('Auto dew state is unknown.') : enabled }
        : null,
      channels,
      command: command?.view ?? null,
    }
  }

  function decorate(view: RigDetailView): RigDetailView {
    return {
      ...view,
      devices: view.devices.map(device => {
        if (device.kind !== 'switch') return device
        const dewControl = controls(view.id, device)

        return dewControl ? { ...device, dewControl } : device
      }),
    }
  }

  function switchControlOf(rig: RigCatalogRecord) {
    try {
      return options.createSwitchControl(rig)
    } catch {
      return undefined
    }
  }

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/dew/check', async (request, reply) => {
    const parsed = checkSchema.safeParse(request.body)

    if (!parsed.success) return reply.code(400).send({ error: 'invalid-dew-command' })
    const { rigId } = request.params
    const { deviceId, requestId } = parsed.data
    const rig = await catalog.get(rigId)

    if (!rig) return reply.code(404).send({ error: 'rig-not-found' })
    let admission: 'known' | 'not-admitted' | 'unknown' = 'unknown'

    if (parsed.data.serverInstanceId === serverInstanceId)
      admission = admittedRequests.has(requestId) ? 'known' : 'not-admitted'

    // Retire before reading: a delayed original request must fail its final admission check.
    if (admission !== 'known') retiredRequests.add(requestId)
    const detail = await inspectRigDetail(catalog, rigId, { createInspector: options.createInspector })

    if (detail.state === 'not-found') return reply.code(404).send({ error: 'rig-not-found' })
    const device = decorate(detail.view).devices.find(item => item.id === deviceId)

    if (device?.kind !== 'switch' || !device.dewControl)
      return reply.code(409).send({ error: 'dew-unavailable', message: 'Fresh power box readings are unavailable.' })

    return { admission, control: device.dewControl }
  })

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/dew', async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body)

    if (!parsed.success) return reply.code(400).send({ error: 'invalid-dew-command' })
    const { rigId } = request.params
    const { deviceId, action, requestId } = parsed.data

    if (parsed.data.serverInstanceId !== serverInstanceId)
      return reply.code(409).send({ error: 'dew-server-restarted', message: 'Vela restarted. Refresh the page before changing a dew heater.' })

    if (retiredRequests.has(requestId)) return reply.code(409).send({ error: 'dew-command-retired' })

    if (admittedRequests.has(requestId)) return reply.code(409).send({ error: 'dew-command-already-admitted' })
    const rig = await catalog.get(rigId)

    if (!rig) return reply.code(404).send({ error: 'rig-not-found' })
    const control = switchControlOf(rig)

    if (!control) return reply.code(409).send({ error: 'dew-unavailable', message: 'This rig has no power box Vela can command.' })
    const slot = key(rigId, deviceId)

    // Claimed before the first await so a second request for this box cannot pass the same preflight.
    if (sending.has(slot)) return reply.code(409).send({ error: 'dew-command-unavailable', message: 'Waiting for the power box to confirm the change.' })
    sending.add(slot)

    try {
      const detail = await inspectRigDetail(catalog, rigId, { createInspector: options.createInspector })

      if (detail.state !== 'current')
        return reply.code(409).send({ error: 'dew-unavailable', message: 'Fresh rig identity and readings are required.' })

      const device = detail.view.devices.find(item => item.id === deviceId)
      const inspection = detail.inspections.find(item => rigDeviceId(rigId, item.providerDeviceId) === deviceId)

      if (device?.kind !== 'switch' || inspection?.kind !== 'switch')
        return reply.code(404).send({ error: 'dew-device-not-found' })

      const readiness = controls(rigId, device, { ownsSlot: true })
      const target = readiness && targetOf(action, device, readiness)

      if (!target) return reply.code(404).send({ error: 'dew-channel-not-found' })

      // Cria refuses a duty off the channel's step, so say so here instead of sending it.
      const dutyChannel = action.kind === 'duty' ? readiness?.channels.find(item => item.id === action.channelId) : undefined

      if (action.kind === 'duty' && dutyChannel && !onGrid(action.percent, dutyChannel)) {
        return reply.code(400).send({
          error: 'invalid-dew-duty',
          message: `${dutyChannel.name} takes ${dutyChannel.minimum} to ${dutyChannel.maximum} in steps of ${dutyChannel.step}.`,
        })
      }

      if (!target.availability.enabled)
        return reply.code(409).send({ error: 'dew-command-unavailable', message: target.availability.reason })

      if (retiredRequests.has(requestId)) return reply.code(409).send({ error: 'dew-command-retired' })

      if (admittedRequests.has(requestId)) return reply.code(409).send({ error: 'dew-command-already-admitted' })

      const record: CommandRecord = {
        expectedSwitchName: inspection.name,
        view: { requestId, action, state: 'pending', message: null },
      }

      admittedRequests.add(requestId)
      commands.set(slot, record)

      try {
        const result = await control.set({
          switchId: inspection.providerDeviceId,
          expectedSwitchName: inspection.name,
          channelId: target.channelId,
          value: target.value,
        })

        record.view = {
          requestId,
          action,
          state: result.outcome,
          message: result.outcome === 'confirmed'
            ? action.kind === 'duty' && result.value !== undefined ? `The box holds ${dutyLabel(result.value)}.` : null
            : result.message ?? 'The power box did not confirm the change. Check its current state before trying again.',
        }
      } catch (error) {
        request.log.warn({ err: error, rigId, deviceId }, 'Dew heater command outcome is uncertain')
        record.view = { requestId, action, state: 'uncertain', message: 'The change could not be confirmed. Waiting for fresh readings.' }
      }

      return controls(rigId, device, { ownsSlot: true, afterWrite: true })
    } finally {
      sending.delete(slot)
    }
  })

  return { decorate, serverInstanceId }
}
