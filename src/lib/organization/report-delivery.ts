const MAX_REPORT_DELIVERY_ATTEMPTS = 4
const REPORT_RETRY_DELAYS_MINUTES = [1, 5, 15]
const TRANSIENT_REPORT_EMAIL_ERROR_CODES = new Set([
  'ECONNECTION', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'EAI_AGAIN', 'ENOTFOUND', 'ETLS',
])

export function organizationReportIdempotencyKey(configurationId: string, scheduledFor: Date): string {
  return `organization-report:${configurationId}:${scheduledFor.toISOString()}`
}

export function organizationReportDeliveryRetry(
  attemptCount: number,
  error: unknown,
  now = Date.now(),
): { retryAt: Date | null; message: string } {
  const attempt = Number.isInteger(attemptCount) && attemptCount > 0 ? attemptCount : 1
  const providerError = error && typeof error === 'object'
    ? error as { code?: unknown; responseCode?: unknown }
    : {}
  const responseCode = Number(providerError.responseCode)
  const errorCode = typeof providerError.code === 'string' ? providerError.code : ''
  const permanentResponse = Number.isInteger(responseCode) && responseCode >= 500 && responseCode < 600
  const retryable = !permanentResponse && (
    !responseCode || (responseCode >= 400 && responseCode < 500) || TRANSIENT_REPORT_EMAIL_ERROR_CODES.has(errorCode)
  )

  if (!retryable || attempt >= MAX_REPORT_DELIVERY_ATTEMPTS) {
    return {
      retryAt: null,
      message: attempt >= MAX_REPORT_DELIVERY_ATTEMPTS
        ? 'Email delivery failed after several attempts.'
        : 'The email provider rejected this scheduled report.',
    }
  }

  const delayMinutes = REPORT_RETRY_DELAYS_MINUTES[Math.min(attempt - 1, REPORT_RETRY_DELAYS_MINUTES.length - 1)]
  return {
    retryAt: new Date(now + delayMinutes * 60_000),
    message: 'Temporary email delivery issue. Another attempt is scheduled.',
  }
}
