import { defaultBindingId, defaultInstanceId } from './state.ts'

export interface MotionOperationOptions {
  readonly id: string
  readonly acceptedAt: number
  readonly startedAt: number
  readonly settledAt?: number
  readonly outcome?: 'confirmed' | 'uncertain'
  readonly instanceId?: string
}

export function homeOperation(options: MotionOperationOptions) {
  const common = {
    id: options.id,
    instanceId: options.instanceId ?? defaultInstanceId,
    requestId: `request-${options.id.slice(-4)}`,
    deviceId: 'mount',
    bindingId: defaultBindingId,
    expectedName: 'Synthetic mount',
    failureDomain: 'mount',
    acceptedAt: options.acceptedAt,
    kind: 'mount-home',
    parameters: {},
  }

  if (options.settledAt === undefined)
    return { ...common, state: 'running', startedAt: options.startedAt, progress: { phase: 'preparing', elapsedSeconds: null } }

  return {
    ...common,
    state: 'settled',
    startedAt: options.startedAt,
    settledAt: options.settledAt,
    outcome:
      options.outcome === 'uncertain'
        ? { kind: 'uncertain', reason: 'not-confirmed', message: 'no confirmation' }
        : { kind: 'confirmed', value: { values: {}, image: null } },
    recovery: null,
  }
}

export const operationId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
