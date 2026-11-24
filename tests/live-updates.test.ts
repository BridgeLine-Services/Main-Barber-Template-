import { clearLiveUpdateCache, checkLiveUpdates } from '../src/lib/platform-reliability/live-updates'
import { buildUpdatePlan, classifyUpdate } from '../src/lib/platform-reliability/update-plan'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) passed++
  else { failed++; console.error(`FAIL ${message}`) }
}

async function main() {
  const calls: string[] = []
  const successfulFetch: typeof fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    const packageName = decodeURIComponent(url.split('/').at(-2) ?? '')
    return Response.json({ version: packageName === 'next' ? '17.0.0' : '1.0.0' })
  }
  clearLiveUpdateCache()
  const result = await checkLiveUpdates({ fetcher: successfulFetch, force: true, advisoryPackages: ['next'] })
  ok(result.verified, 'all stable registry checks produce a verified result')
  ok(result.source === 'npm registry', 'the update source is named')
  ok(result.packageCount > 0 && result.dependencies.length === result.packageCount, 'installed versions are checked against the registry')
  ok(calls.length === result.packageCount, 'each direct runtime and development dependency gets checked')
  ok(result.plan !== null && result.plan.requiresApproval && result.plan.autoMerge === false && result.plan.autoDeploy === false, 'live updates produce a review-only plan')
  ok(result.plan?.deferred.some((item) => item.name === 'next' && item.breaking), 'major framework updates are separated as breaking changes')
  ok(result.plan?.deferred.every((item) => item.kind !== 'security' || item.reason.includes('security advisory')), 'security updates retain their security classification')

  let attempts = 0
  clearLiveUpdateCache()
  const unavailable = await checkLiveUpdates({
    force: true,
    fetcher: async () => { attempts++; return new Response('unavailable', { status: 503 }) },
  })
  ok(!unavailable.verified && unavailable.plan === null, 'unavailable registry data never reports no updates')
  ok(attempts === unavailable.packageCount * 2, 'each package gets one bounded retry')

  clearLiveUpdateCache()
  const timeout = await checkLiveUpdates({
    force: true,
    timeoutMs: 1,
    fetcher: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    }),
  })
  ok(!timeout.verified && timeout.plan === null, 'registry timeouts never become a clean update report')

  ok(classifyUpdate({ name: 'lib', installed: '1.2.3', latest: '1.3.0' })?.kind === 'minor', 'minor releases are distinguished from patches')
  ok(classifyUpdate({ name: 'lib', installed: '1.2.3', latest: '1.2.4' })?.kind === 'patch', 'patch releases are distinguished from minor updates')
  ok(classifyUpdate({ name: 'lib', installed: '1.2.3', latest: '2.0.0', hasAdvisory: true })?.breaking, 'a security update can still be a breaking change')
  ok(classifyUpdate({ name: 'lib', installed: '1.2.3', latest: 'latest' })?.kind === 'unknown', 'unreadable versions are not classified as routine')
  const stale = buildUpdatePlan([{ name: 'lib', installed: '1.2.3', latest: '1.2.2' }], '2026-11-24T00:00:00.000Z')
  ok(stale.batch.length === 0 && stale.deferred.length === 0 && stale.unclassified.length === 0, 'registry tags older than the installed release are not proposed as downgrades')
  clearLiveUpdateCache()

  console.log(`Live updates: ${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

main().catch((error) => { console.error(error); process.exit(1) })
