/**
 * Read-only provider probes used by `npm run env:doctor:deep`.
 *
 * Each probe answers "are these credentials real and is the provider reachable?" without
 * changing anything: no message is sent, nothing is uploaded, no payment is created. A
 * probe that can only be answered by writing to a provider is deliberately absent, and
 * the doctor reports manual verification instead of pretending.
 *
 * Every failure detail is sanitised: providers echo request details and identifiers in
 * their error bodies, so only a short classification is returned.
 */

export type ProbeStatus = 'VERIFIED' | 'INVALID' | 'UNREACHABLE'
export interface ProbeResult {
  status: ProbeStatus
  detail: string
}

const TIMEOUT_MS = 8000

/** Twilio: GET the account resource. Read-only; no message is sent. */
export async function probeTwilio(accountSid: string, authToken: string): Promise<ProbeResult> {
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) {
    return { status: 'INVALID', detail: 'the account SID does not look like an AC… SID from the Twilio console' }
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) return { status: 'VERIFIED', detail: 'Twilio accepted the account SID and token (no message was sent)' }
    if (res.status === 401 || res.status === 403) return { status: 'INVALID', detail: 'Twilio rejected the account SID or token' }
    return { status: 'UNREACHABLE', detail: `Twilio answered ${res.status}` }
  } catch {
    return { status: 'UNREACHABLE', detail: 'could not reach Twilio' }
  }
}

/**
 * Vercel Blob: list one entry. Listing is read-only — nothing is uploaded or deleted —
 * and a wrong token is refused before any storage is touched.
 */
export async function probeBlob(token: string): Promise<ProbeResult> {
  try {
    const { list } = await import('@vercel/blob')
    await list({ token, limit: 1 })
    return { status: 'VERIFIED', detail: 'the storage token can list the store (nothing was uploaded)' }
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? '')
    if (/forbidden|unauthori[sz]ed|invalid token|401|403/i.test(message)) {
      return { status: 'INVALID', detail: 'the storage token was refused' }
    }
    if (/store|not found|does not exist/i.test(message)) {
      return { status: 'INVALID', detail: 'the token is valid but its Blob store is missing or was deleted' }
    }
    return { status: 'UNREACHABLE', detail: 'could not confirm the Blob store' }
  }
}

/**
 * Observability: a GET on the endpoint. Any HTTP answer proves the host is reachable;
 * nothing is posted, so no error event is fabricated in the customer's dashboard.
 */
export async function probeWebhook(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS) })
    // A webhook that only accepts POST still answers (405), which proves reachability.
    if (res.status < 500) return { status: 'VERIFIED', detail: `endpoint reachable (answered ${res.status}; nothing was sent)` }
    return { status: 'UNREACHABLE', detail: `endpoint answered ${res.status}` }
  } catch {
    return { status: 'UNREACHABLE', detail: 'could not reach the endpoint' }
  }
}

/**
 * Google Business Profile: the refresh token can only be exercised by exchanging it for
 * an access token, which is a real authentication event against the shop's Google
 * account. The doctor therefore checks shape only and says so.
 */
export function inspectGoogleCredentials(clientId: string, clientSecret: string, refreshToken?: string): ProbeResult {
  const clientIdLooksRight = /\.apps\.googleusercontent\.com$/.test(clientId)
  if (!clientIdLooksRight) return { status: 'INVALID', detail: 'the client ID does not end in .apps.googleusercontent.com' }
  if (!clientSecret.trim()) return { status: 'INVALID', detail: 'the client secret is empty' }
  if (!refreshToken?.trim()) {
    return { status: 'UNREACHABLE', detail: 'app credentials are present but the shop has not connected its Google account yet (in-app connect flow)' }
  }
  return { status: 'VERIFIED', detail: 'app credentials and a connected account are present; the connection is exercised on first use' }
}

/** Cron: the secret is only compared locally, so its shape is the only safe check. */
export function inspectCronSecret(secret: string): ProbeResult {
  if (secret.trim().length < 16) return { status: 'INVALID', detail: 'the cron secret is too short to be safe; generate 32+ characters' }
  return { status: 'VERIFIED', detail: 'present and long enough' }
}
