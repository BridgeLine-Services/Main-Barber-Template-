// ============================================================================
// Active error reporting (Section 38 — Monitoring / Observability)
// Forwards structured error events to an external collector when configured.
// Degrades to a no-op when OBSERVABILITY_WEBHOOK_URL is unset, so the
// template never depends on a monitoring provider at runtime.
// ============================================================================

type LogContext = Record<string, string | number | boolean | null | undefined>

const FORWARD_TIMEOUT_MS = 2500

export function isObservabilityEnabled(): boolean {
  return !!process.env.OBSERVABILITY_WEBHOOK_URL?.trim()
}

function sanitize(context: LogContext = {}) {
  return Object.fromEntries(
    Object.entries(context).filter(([key, value]) => {
      if (value === undefined || value === null) return false
      return !/(password|secret|token|authorization|cookie|phone|email)/i.test(key)
    }),
  )
}

/**
 * Fire-and-forget error report to the configured collector
 * (e.g. Better Stack, Datadog, Axiom, or a Sentry webhook relay).
 * NEVER throws and NEVER blocks the request path beyond a bounded timeout:
 * observability must not be able to take the application down.
 * Returns true if a report was delivered with a 2xx response.
 */
export async function reportError(event: string, error: unknown, context: LogContext = {}): Promise<boolean> {
  if (!isObservabilityEnabled()) return false
  const url = process.env.OBSERVABILITY_WEBHOOK_URL!.trim()
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
  const message = error instanceof Error ? error.message : String(error)
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    errorCode: code,
    message,
    context: sanitize(context),
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      signal: controller.signal,
    })
    return res.ok
  } catch {
    // Network failure, timeout, or the collector is down: swallow.
    // The console.error line from logError is still the source of
    // truth for log drains.
    return false
  } finally {
    clearTimeout(timer)
  }
}
