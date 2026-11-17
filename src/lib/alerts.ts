// ============================================================================
// Critical alerting (Section 38 — Monitoring, extended for operations)
//
// Two independent channels, on purpose:
//   • OBSERVABILITY_WEBHOOK_URL — the primary collector/error feed (already used
//     by src/lib/observability.ts). Rich, but it is one account: if it is down
//     or misconfigured, nobody hears about an outage.
//   • ALERT_WEBHOOK_URL — an independent critical channel (Slack/Discord/PagerDuty
//     relay). Only configured alerts of at least ALERT_MIN_SEVERITY go here.
//
// Rules that keep alerting from becoming its own outage:
//   • Never throws, never awaited on a request's critical path beyond a bounded
//     attempt (2.5s per try, one retry for critical).
//   • Duplicate suppression per dedupe key, so a flapping dependency cannot send
//     hundreds of messages and train everyone to ignore them.
//   • Recovery notices are a first-class event, so a resolved incident closes
//     itself instead of leaving the owner waiting.
//   • Nothing customer-identifying leaves the process: phone, email, token,
//     password, cookie and authorization keys are dropped, and free-text details
//     are scrubbed of email/phone shapes.
// ============================================================================

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface AlertContext {
  [key: string]: string | number | boolean | null | undefined
}

export interface AlertInput {
  /** Stable machine name, e.g. 'database_unavailable'. Used for dedupe. */
  event: string
  severity: AlertSeverity
  /** One plain sentence for a human. Never contains customer data. */
  summary: string
  context?: AlertContext
  /** Events sharing this key are suppressed within the dedupe window. */
  dedupeKey?: string
  /** Present on a resolution notice; names the incident it closes. */
  recoveryOf?: string
}

export interface AlertDelivery {
  channel: 'critical' | 'primary'
  ok: boolean
  status: number | null
  attempts: number
  at: string
  error?: string
}

const ATTEMPT_TIMEOUT_MS = 2500
const RETRY_DELAY_MS = 500
const MAX_TRACKED_DELIVERIES = 50
const DEFAULT_DEDUPE_MS = 15 * 60 * 1000

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 }

let deliveries: AlertDelivery[] = []
const dedupeUntil = new Map<string, number>()

/** Test seam: clears suppression and delivery history (never available in production). */
export function resetAlertStateForTest() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('resetAlertStateForTest is not available in production')
  }
  deliveries = []
  dedupeUntil.clear()
}

export function getAlertDeliveryStatus(): AlertDelivery[] {
  return [...deliveries]
}

export function isAlertingConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ALERT_WEBHOOK_URL?.trim() || env.OBSERVABILITY_WEBHOOK_URL?.trim())
}

function severityFloor(env: Record<string, string | undefined>): AlertSeverity {
  const raw = (env.ALERT_MIN_SEVERITY ?? '').trim().toLowerCase()
  return raw === 'info' || raw === 'warning' || raw === 'critical' ? raw : 'warning'
}

function dedupeWindowMs(env: Record<string, string | undefined>): number {
  const raw = Number(env.ALERT_DEDUPE_MINUTES)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_DEDUPE_MS
  return Math.min(raw, 24 * 60) * 60 * 1000
}

const SECRET_KEY = /(password|secret|token|authorization|cookie|apikey|api_key|credential)/i
const PERSONAL_KEY = /(phone|email|address|customer|fullname|full_name)/i

/** Drop anything that identifies a person or carries a credential. */
export function sanitizeAlertContext(context: AlertContext = {}): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null) continue
    if (SECRET_KEY.test(key) || PERSONAL_KEY.test(key)) continue
    if (typeof value === 'string') {
      // Free text can still carry an address or a phone number.
      const scrubbed = value
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]')
        .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-number]')
        .slice(0, 300)
      output[key] = scrubbed
      continue
    }
    output[key] = value
  }
  return output
}

async function postOnce(url: string, payload: string): Promise<{ ok: boolean; status: number | null; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      signal: controller.signal,
    })
    return { ok: response.ok, status: response.status }
  } catch (error) {
    return { ok: false, status: null, error: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

async function deliver(
  channel: AlertDelivery['channel'],
  url: string,
  payload: string,
  retries: number,
): Promise<AlertDelivery> {
  let attempts = 0
  let last: { ok: boolean; status: number | null; error?: string } = { ok: false, status: null }
  while (attempts <= retries) {
    attempts++
    last = await postOnce(url, payload)
    if (last.ok) break
    if (attempts <= retries) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  }
  const delivery: AlertDelivery = {
    channel,
    ok: last.ok,
    status: last.status,
    attempts,
    at: new Date().toISOString(),
    ...(last.error ? { error: last.error } : {}),
  }
  deliveries.push(delivery)
  if (deliveries.length > MAX_TRACKED_DELIVERIES) deliveries = deliveries.slice(-MAX_TRACKED_DELIVERIES)
  return delivery
}

/**
 * Send an alert. Returns the deliveries actually attempted (empty when the alert
 * was suppressed or nothing is configured). Never throws.
 */
export async function sendAlert(input: AlertInput, env: Record<string, string | undefined> = process.env): Promise<AlertDelivery[]> {
  const floor = severityFloor(env)
  // A resolution notice bypasses the floor: an incident that is closed but
  // announced to nobody is how "is it fixed?" becomes a phone call.
  if (!input.recoveryOf && SEVERITY_RANK[input.severity] < SEVERITY_RANK[floor]) return []

  const dedupeKey = input.dedupeKey ?? input.event
  const now = Date.now()
  // Recovery notices always go out: suppressing a resolution is how an incident
  // appears to never end.
  if (!input.recoveryOf) {
    const suppressedUntil = dedupeUntil.get(dedupeKey)
    if (suppressedUntil && suppressedUntil > now) return []
    dedupeUntil.set(dedupeKey, now + dedupeWindowMs(env))
  }

  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    // Shape matches the observability collector contract, with alert fields
    // added so one endpoint can serve both feeds.
    event: input.event,
    severity: input.severity,
    message: input.summary,
    summary: input.summary,
    recoveryOf: input.recoveryOf ?? null,
    context: sanitizeAlertContext(input.context),
    source: 'barber-platform',
  })

  const attempts: Array<[AlertDelivery['channel'], string]> = []
  const criticalUrl = env.ALERT_WEBHOOK_URL?.trim()
  const primaryUrl = env.OBSERVABILITY_WEBHOOK_URL?.trim()
  if (criticalUrl) attempts.push(['critical', criticalUrl])
  if (primaryUrl && primaryUrl !== criticalUrl) attempts.push(['primary', primaryUrl])

  const results: AlertDelivery[] = []
  const retries = input.severity === 'critical' ? 1 : 0
  for (const [channel, url] of attempts) {
    results.push(await deliver(channel, url, payload, retries))
  }
  // Operator-visible trail in the platform log drain as well; the collector is
  // not guaranteed to exist.
  const anyOk = results.some((r) => r.ok)
  const line = `[alert] ${input.severity} ${input.event}${input.recoveryOf ? ` recovery-of=${input.recoveryOf}` : ''} delivered=${anyOk}`
  if (input.severity === 'critical' && !anyOk) console.error(line)
  else console.warn(line)
  return results
}

/** Close an incident opened by a previous alert. */
export async function sendRecoveryAlert(
  incidentEvent: string,
  summary: string,
  context: AlertContext = {},
  env: Record<string, string | undefined> = process.env,
): Promise<AlertDelivery[]> {
  return sendAlert({ event: `${incidentEvent}_recovered`, severity: 'info', summary, context, recoveryOf: incidentEvent }, env)
}

/**
 * Deployment acceptance: prove the channel works end-to-end, from this process,
 * with a real HTTP request. Used by `npm run alert:test`.
 */
export async function sendTestAlert(env: Record<string, string | undefined> = process.env): Promise<AlertDelivery[]> {
  if (!env.ALERT_WEBHOOK_URL?.trim() && !env.OBSERVABILITY_WEBHOOK_URL?.trim()) {
    throw new Error('No alert channel is configured (set ALERT_WEBHOOK_URL or OBSERVABILITY_WEBHOOK_URL).')
  }
  return sendAlert(
    {
      event: 'deployment_test_alert',
      severity: 'critical',
      summary: 'Test alert from the barber platform. If you can read this, critical alerts are being delivered.',
      context: { kind: 'acceptance', at: new Date().toISOString() },
      // Never suppress the acceptance test.
      dedupeKey: `deployment_test_alert:${Date.now()}`,
    },
    env,
  )
}
