import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  describeReviewInviteHealth,
  describeReviewRequestStatus,
} from '@/lib/review-invite-copy'
import type { ReviewRequestListRow, ReviewRequestSummary } from '@/lib/review-requests'
import { MailCheck, AlertCircle } from 'lucide-react'

/**
 * Review invites panel (Part 6).
 *
 * Read-only. Shows what happened to the automatic review invitations for this shop, in
 * the same words a shop owner would use: waiting, sent, could not send. Failure detail
 * comes from the existing delivery record and is already written without provider
 * payloads; only the destination host is ever shown, never a full URL or customer
 * contact details.
 *
 * Server component: the page loads the data, this renders it. It never writes, so it
 * cannot affect sending, retries or settings.
 */

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function ReviewInvites({
  summary,
  rows,
  loadFailed,
}: {
  summary: ReviewRequestSummary | null
  rows: ReviewRequestListRow[]
  loadFailed?: boolean
}) {
  if (loadFailed || !summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MailCheck className="h-4 w-4" aria-hidden="true" />
            Review invites
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            We could not load your review invites just now. Your reviews below are
            unaffected, and invites keep going out as normal.
          </p>
        </CardContent>
      </Card>
    )
  }

  const health = describeReviewInviteHealth({
    enabled: summary.enabled,
    destinationConfigured: summary.destinationConfigured,
    sent: summary.sent,
    pending: summary.pending,
    failed: summary.failed,
  })

  const counts: Array<{ label: string; value: number }> = [
    { label: 'Sent', value: summary.sent },
    { label: 'Waiting', value: summary.pending + summary.processing },
    { label: 'Could not send', value: summary.failed },
    { label: 'Not sent', value: summary.suppressed + summary.cancelled },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MailCheck className="h-4 w-4" aria-hidden="true" />
          Review invites
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{health}</p>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {counts.map((count) => (
            <div
              key={count.label}
              className="rounded-lg border border-border bg-[var(--dash-surface)]/40 p-3"
            >
              <dt className="text-xs text-muted-foreground">{count.label}</dt>
              <dd className="text-xl font-semibold tabular-nums text-foreground">
                {count.value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="text-xs text-muted-foreground">
          {summary.lastSentAt
            ? `Last invite sent ${formatDate(summary.lastSentAt)}.`
            : 'No invite has been sent yet.'}
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to show yet. Once a customer has had a visit, their invite appears
            here with what happened to it.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Recent review invites and what happened to them</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">Visit</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Customer</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Service</th>
                  <th scope="col" className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const copy = describeReviewRequestStatus(row.status)
                  return (
                    <tr key={row.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3 text-muted-foreground">
                        {formatDate(row.appointmentStartTime)}
                      </td>
                      <td className="py-2 pr-3 text-foreground">{row.customerName}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{row.serviceName || '—'}</td>
                      <td className="py-2">
                        <span
                          className={
                            copy.needsAttention
                              ? 'inline-flex items-center gap-1 text-foreground'
                              : 'text-muted-foreground'
                          }
                        >
                          {copy.needsAttention && (
                            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {copy.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {copy.detail}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
