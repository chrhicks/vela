import type { EpochMs } from '@vela/rig-events'

/** A stretch in which nothing could have moved the mount unseen. `to` is null while it lasts. */
export interface Epoch {
  readonly id: number
  readonly from: EpochMs
  readonly to: EpochMs | null
}

export interface Epochs {
  readonly list: readonly Epoch[]
}

export const noEpochs: Epochs = { list: [] }

export function currentEpoch(epochs: Epochs): Epoch | null {
  const last = epochs.list[epochs.list.length - 1]

  return last && last.to === null ? last : null
}

export function openEpoch(epochs: Epochs, at: EpochMs): Epochs {
  if (currentEpoch(epochs)) return epochs

  const last = epochs.list[epochs.list.length - 1]

  return { list: [...epochs.list, { id: (last?.id ?? 0) + 1, from: at, to: null }] }
}

/** Ends the open epoch at `at`, never before it began. */
export function closeEpoch(epochs: Epochs, at: EpochMs): Epochs {
  const open = currentEpoch(epochs)

  if (!open) return epochs

  const closed: Epoch = { ...open, to: at < open.from ? open.from : at }

  return { list: [...epochs.list.slice(0, -1), closed] }
}

/** The epoch that holds the whole interval, or none when a break falls inside it. */
export function epochContaining(epochs: Epochs, from: EpochMs, to: EpochMs): Epoch | null {
  return epochs.list.find(epoch => epoch.from <= from && (epoch.to === null || to <= epoch.to)) ?? null
}

export function forgetBefore(epochs: Epochs, time: EpochMs): Epochs {
  const kept = epochs.list.filter((epoch, index) => index === epochs.list.length - 1 || epoch.to === null || epoch.to >= time)

  return kept.length === epochs.list.length ? epochs : { list: kept }
}
