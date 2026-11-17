// Deployment acceptance: prove critical alerts arrive, end to end.
//   npm run alert:test
// Prints the channel it used and whether the provider accepted it. Never prints
// the webhook URL.
import { isAlertingConfigured, sendTestAlert } from '../src/lib/alerts'

async function main(): Promise<number> {
  if (!isAlertingConfigured()) {
    console.error('[alert] NOT CONFIGURED: set ALERT_WEBHOOK_URL (independent channel) and/or OBSERVABILITY_WEBHOOK_URL.')
    return 3
  }
  const deliveries = await sendTestAlert()
  if (deliveries.length === 0) {
    console.error('[alert] FAILED: the alert was suppressed before delivery.')
    return 1
  }
  let ok = false
  for (const delivery of deliveries) {
    console.log(`[alert] ${delivery.channel} channel: ${delivery.ok ? 'delivered' : 'FAILED'} (HTTP ${delivery.status ?? 'n/a'}, ${delivery.attempts} attempt${delivery.attempts === 1 ? '' : 's'})`)
    ok = ok || delivery.ok
  }
  if (!ok) {
    console.error('[alert] FAILED: no channel accepted the test alert. Check the webhook URL in the provider dashboard.')
    return 1
  }
  console.log('[alert] PASS: a real test alert was delivered. Confirm it appeared in the alerting service.')
  return 0
}

main().then((code) => { process.exitCode = code })
