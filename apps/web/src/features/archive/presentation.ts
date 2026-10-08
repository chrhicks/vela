import type {
  ArchiveDestinationProblemKind,
  ArchiveIssueReason,
  ArchiveTally,
  CriaArchiveHealthView,
} from '@vela/model/web'

export type PreservationTone = 'current' | 'pending' | 'problem' | 'unknown'

export interface PreservationSummary {
  tone: PreservationTone
  title: string
  /** One or two sentences: what is happening to originals and what Cria is doing about it. */
  explanation: string
  /** The next useful step, or null when nothing is needed. */
  nextStep: string | null
}

export function formatBytes(bytes: number) {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0

  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }

  return unit === 0 ? `${bytes} bytes` : `${value >= 100 ? Math.round(value) : Number(value.toFixed(1))} ${units[unit]}`
}

/** End a boundary's message as a sentence, whatever punctuation it arrived with. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

export const originals = (count: number) => (count === 1 ? '1 original' : `${count} originals`)

export function tallyText(tally: ArchiveTally | null) {
  if (!tally) return 'Unknown'

  return tally.count === 0 ? 'None' : `${originals(tally.count)} · ${formatBytes(tally.bytes)}`
}

const destinationSteps: Record<ArchiveDestinationProblemKind, string> = {
  missing: 'Reconnect or mount the archive disk, then check the archive.',
  replaced: 'Reconnect or mount the archive disk, then check the archive.',
  'not-writable': "Fix the archive folder's permissions, then check the archive.",
  unreadable: 'Check the archive disk, then check the archive.',
  'write-failed': 'Free space on the archive disk or fix it, then check the archive.',
}

/** Pending work Vela finishes by itself, most visible first. */
function pendingSentence(view: CriaArchiveHealthView) {
  const { waitingAtCria, unverified, acknowledgementPending } = view.obligations
  const parts: string[] = []

  if (waitingAtCria?.count) parts.push(`${originals(waitingAtCria.count)} waiting for archive`)

  if (unverified?.count) parts.push(`${originals(unverified.count)} being verified`)

  if (acknowledgementPending?.count)
    parts.push(`${originals(acknowledgementPending.count)} verified, waiting for Cria to confirm`)

  return parts.join(' · ')
}

export function preservationSummary(view: CriaArchiveHealthView, capturing: boolean): PreservationSummary {
  const lead = capturing ? 'Capturing · ' : ''
  const waiting = view.obligations.waitingAtCria?.count ?? 0
  const pending = pendingSentence(view)

  switch (view.status) {
    case 'degraded': {
      const problem = view.destination.problem
      const backlog = waiting > 0 ? `${originals(waiting)} waiting for archive. ` : ''

      return {
        tone: 'problem',
        title: 'Archive unavailable',
        explanation:
          `${lead}${backlog}The Vela archive cannot accept originals${problem ? `: ${sentence(problem.detail)}` : '.'} ` +
          (capturing
            ? 'Cria is retaining them; new captures will be refused when its capacity is exhausted.'
            : 'Cria is retaining them until they can be archived.'),
        nextStep: problem ? destinationSteps[problem.kind] : 'Check the archive disk.',
      }
    }

    case 'attention': {
      const count = view.issues.total

      return {
        tone: 'problem',
        title: count === 1 ? '1 original needs attention' : `${count} originals need attention`,
        explanation: `${lead}${pending ? `${pending}. ` : ''}Some originals cannot be vouched for as they are. Vela keeps every copy and replaces nothing.`,
        nextStep: 'Open the archive details to see each original and what to check.',
      }
    }

    case 'unknown':
      return {
        tone: 'unknown',
        title: 'Preservation status unknown',
        explanation: !view.source.current
          ? `${lead}Cria's custody could not be read${view.source.error ? `: ${sentence(view.source.error)}` : '.'} ${view.source.observedAt ? 'Last known totals are shown with their age.' : 'No totals are known yet.'}`
          : `${lead}Some totals are partial, so Vela cannot say every original is preserved.`,
        nextStep: !view.source.current ? 'Check that Cria is reachable. Vela retries automatically.' : null,
      }
    case 'catching-up':
      return {
        tone: 'pending',
        title: 'Preservation in progress',
        explanation: `${lead}${pending || 'Recent originals are on their way to the archive'}. Vela finishes this automatically.`,
        nextStep: null,
      }
    case 'current':
      return {
        tone: 'current',
        title: 'Originals preserved',
        explanation: capturing
          ? 'Capturing · each original is verified in the Vela archive and confirmed by Cria as it arrives.'
          : 'Every original Vela knows of is verified in the archive and confirmed by Cria.',
        nextStep: null,
      }
  }
}

export const issueLabels: Record<ArchiveIssueReason, string> = {
  'source-unavailable': 'Cria could not provide it',
  'original-mismatch': 'Original differs',
  'context-mismatch': 'Record differs',
  'receipt-mismatch': 'Receipt differs',
  'acknowledgement-pending': 'Waiting for Cria to confirm',
  'receipt-conflict': 'Another archive holds it',
  'unvouched-copy': 'Copy cannot be vouched for',
  'missing-at-cria': 'Missing at Cria',
  'quarantined-at-cria': 'Quarantined at Cria',
}

export const issueSteps: Record<ArchiveIssueReason, string> = {
  'source-unavailable': 'Vela retries automatically. Check that Cria is reachable.',
  'original-mismatch': 'Cria keeps its original. Inspect the archived copy; Vela will not replace it.',
  'context-mismatch': 'Cria keeps its original. Vela will not certify a copy whose record differs; inspect it.',
  'receipt-mismatch': 'Cria keeps its original. Inspect the archived files; Vela will not reissue the receipt.',
  'acknowledgement-pending': 'The copy is verified. Vela resends the same receipt automatically.',
  'receipt-conflict': 'Another archive holds this original. Find that copy before relying on this one.',
  'unvouched-copy': 'Keep this copy until you have inspected it.',
  'missing-at-cria': 'Cria no longer has this original. Check whether an archive holds a copy.',
  'quarantined-at-cria': 'Cria kept an unverifiable file for inspection on the rig computer.',
}

/** Human description of an age, for last-known values. */
export function age(fromIso: string, nowMs: number) {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(fromIso)) / 1000))

  if (seconds < 60) return 'just now'

  const minutes = Math.round(seconds / 60)

  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`
}

export function hours(value: number) {
  if (value < 1) return 'under an hour'

  return value < 48 ? `about ${Math.round(value)} hours` : `about ${Math.round(value / 24)} days`
}
