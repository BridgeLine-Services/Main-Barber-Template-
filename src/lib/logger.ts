import { reportError } from './observability'

type LogContext = Record<string, string | number | boolean | null | undefined>

function sanitize(context: LogContext = {}) {
  return Object.fromEntries(
    Object.entries(context).filter(([key, value]) => {
      if (value === undefined || value === null) return false
      return !/(password|secret|token|authorization|cookie|phone|email)/i.test(key)
    }),
  )
}

export function logEvent(event: string, context?: LogContext) {
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    context: sanitize(context),
  }))
}

export function logError(event: string, error: unknown, context?: LogContext) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    errorCode: code,
    context: sanitize(context),
  }))
  // Active error reporting: forwards to the configured collector when
  // OBSERVABILITY_WEBHOOK_URL is set; no-op otherwise. Fire-and-forget.
  void reportError(event, error, context)
}

export function safeServerError(error: unknown, fallback = 'Something went wrong. Please try again.') {
  logError('server_error', error)
  return fallback
}
