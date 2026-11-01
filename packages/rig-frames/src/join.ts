import type { FrameRecord } from './frame-records.ts'
import type { SavedImage } from './saved-images.ts'

export interface JoinedFrame {
  readonly image: SavedImage
  readonly record: FrameRecord
  /** Fields on which the saved image and its record disagree; empty when they agree. */
  readonly disagreements: readonly string[]
}

export interface FrameJoin {
  readonly joined: readonly JoinedFrame[]
  readonly imagesWithoutRecord: {
    /** Captured before Vela wrote its first frame record for the rig, so no record can exist. */
    readonly predatesRecords: readonly SavedImage[]
    /** Captured after records began and still without one. A real gap. */
    readonly unexplained: readonly SavedImage[]
  }
  readonly recordsWithoutImage: {
    /** Outcome `unsaved` or `save-failed`: Vela did not keep the file, by design. */
    readonly notKept: readonly FrameRecord[]
    /** Outcome `saved`, but the store holds no such image. A real gap. */
    readonly missing: readonly FrameRecord[]
  }
  /** Records that name no image at all (the exposure was lost, failed, uncertain or stopped), by outcome. */
  readonly recordsWithoutImageId: ReadonlyMap<FrameRecord['outcome'], number>
  /** Records and images that repeat an image id; only the first of each is joined. */
  readonly duplicates: readonly string[]
}

function compare(image: SavedImage, record: FrameRecord): string[] {
  const named = record.image
  const differences: string[] = []

  if (named === null) return differences

  if (image.rigId !== record.rigId) differences.push('rigId')

  if (image.capturedAt !== named.capturedAt) differences.push('capturedAt')

  if (image.capturedAtSource !== named.capturedAtSource) differences.push('capturedAtSource')

  if (image.receivedAt !== named.receivedAt) differences.push('receivedAt')

  if (image.width !== named.width || image.height !== named.height) differences.push('size')

  if (image.exposureSeconds !== record.exposureSeconds) differences.push('exposureSeconds')

  if (image.frameType !== record.frameType) differences.push('frameType')

  return differences
}

/** Joins saved images to frame records on `image.id`. A pure function of the two lists. */
export function joinFrames(images: readonly SavedImage[], records: readonly FrameRecord[]): FrameJoin {
  const imagesById = new Map<string, SavedImage>()
  const duplicates: string[] = []

  for (const image of images) {
    if (imagesById.has(image.id)) duplicates.push(`image ${image.id}`)
    else imagesById.set(image.id, image)
  }

  const firstRecordAt = new Map<string, number>()
  const recordsByImage = new Map<string, FrameRecord>()
  const recordsWithoutImageId = new Map<FrameRecord['outcome'], number>()
  const notKept: FrameRecord[] = []
  const missing: FrameRecord[] = []
  const joined: JoinedFrame[] = []

  for (const record of records) {
    firstRecordAt.set(record.rigId, Math.min(firstRecordAt.get(record.rigId) ?? record.startedAt, record.startedAt))

    if (record.image === null) {
      recordsWithoutImageId.set(record.outcome, (recordsWithoutImageId.get(record.outcome) ?? 0) + 1)
      continue
    }

    if (recordsByImage.has(record.image.id)) {
      duplicates.push(`record ${record.image.id}`)
      continue
    }

    recordsByImage.set(record.image.id, record)
    const image = imagesById.get(record.image.id)

    if (image) joined.push({ image, record, disagreements: compare(image, record) })
    else if (record.outcome === 'saved') missing.push(record)
    else notKept.push(record)
  }

  const predatesRecords: SavedImage[] = []
  const unexplained: SavedImage[] = []

  for (const image of imagesById.values()) {
    if (recordsByImage.has(image.id)) continue

    const began = firstRecordAt.get(image.rigId)

    if (began !== undefined && image.capturedAt < began) predatesRecords.push(image)
    else unexplained.push(image)
  }

  return { joined, imagesWithoutRecord: { predatesRecords, unexplained }, recordsWithoutImage: { notKept, missing }, recordsWithoutImageId, duplicates }
}
