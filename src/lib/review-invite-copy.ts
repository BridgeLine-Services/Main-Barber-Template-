/**
 * Review invite status copy (Part 6).
 *
 * One place decides what an owner reads for each stored review-request status, so the
 * dashboard cannot show a raw enum, and so "failed" never reads like something the
 * owner has to fix in a terminal. Kept pure and separate from the Prisma call so it can
 * be tested without a database.
 */

export interface ReviewRequestStatusCopy {
  label: string
  detail: string
  /** True when the owner may reasonably want to act; false for normal end states. */
  needsAttention: boolean
}

const COPY: Record<string, ReviewRequestStatusCopy> = {
  PENDING: {
    label: 'Waiting to send',
    detail: 'Scheduled, and will go out on its own.',
    needsAttention: false,
  },
  PROCESSING: {
    label: 'Sending now',
    detail: 'On its way to the customer.',
    needsAttention: false,
  },
  SENT: {
    label: 'Sent',
    detail: 'The customer received this invite.',
    needsAttention: false,
  },
  FAILED: {
    label: 'Could not send',
    detail: 'It will be tried again. If this keeps happening, check the review link in Settings.',
    needsAttention: true,
  },
  SUPPRESSED: {
    label: 'Not sent',
    detail: 'The customer opted out, or there are no contact details to send to.',
    needsAttention: false,
  },
  CANCELLED: {
    label: 'Cancelled',
    detail: 'The appointment changed, so this invite was withdrawn.',
    needsAttention: false,
  },
}

export function describeReviewRequestStatus(status: string): ReviewRequestStatusCopy {
  return (
    COPY[status] ?? {
      label: 'Not recognised',
      detail: 'This invite is in a state this page does not describe yet.',
      needsAttention: true,
    }
  )
}

/** Plain-language one-liner for whether invites are actually going out. */
export function describeReviewInviteHealth(args: {
  enabled: boolean
  destinationConfigured: boolean
  sent: number
  pending: number
  failed: number
}): string {
  if (!args.enabled) return 'Review invites are switched off. You can turn them on in Settings.'
  if (!args.destinationConfigured) {
    return 'Add your review link in Settings, otherwise invites cannot be sent.'
  }
  if (args.sent === 0 && args.pending === 0) {
    return 'No invites have gone out yet. They are sent automatically after a visit.'
  }
  if (args.failed > 0) {
    return 'Some invites could not be sent and will be retried.'
  }
  if (args.pending > 0) {
    return 'Invites are going out automatically after visits.'
  }
  return 'Invites are going out automatically after visits.'
}
