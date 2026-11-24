import { clearLiveAdvisoryCache, checkLiveAdvisories } from '../src/lib/platform-reliability/live-advisories'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) passed++
  else { failed++; console.error(`FAIL ${message}`) }
}

async function main() {
  let requestBody: { queries: Array<{ package: { name: string; ecosystem: string }; version: string }> } | null = null
  const successFetcher: typeof fetch = async (_input, init) => {
    const parsed = JSON.parse(String(init?.body)) as NonNullable<typeof requestBody>
    requestBody = parsed
    const results = parsed.queries.map(() => ({ vulns: [] as Array<Record<string, unknown>> }))
    results[0].vulns.push({
      id: 'GHSA-test-1234',
      summary: 'Test advisory from OSV',
      database_specific: { severity: 'HIGH' },
      references: [{ url: 'https://github.com/advisories/GHSA-test-1234' }],
      affected: [{
        package: { name: parsed.queries[0].package.name, ecosystem: 'npm' },
        ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '9.9.9' }] }],
      }],
    })
    return Response.json({ results })
  }

  clearLiveAdvisoryCache()
  const result = await checkLiveAdvisories({ fetcher: successFetcher, force: true })
  ok(result.verified, 'a complete OSV response is verified')
  ok(result.source === 'OSV.dev vulnerability database', 'the actual provider is recorded')
  ok(Boolean(requestBody?.queries.length), 'installed direct dependencies are queried')
  ok(requestBody?.queries.every((query) => query.package.ecosystem === 'npm' && Boolean(query.version)), 'exact lockfile versions are sent to OSV')
  ok(result.advisories.length === 1, 'a matching advisory is parsed')
  ok(result.advisories[0]?.dependency === requestBody?.queries[0]?.package.name, 'the affected installed package is identified')
  ok(result.advisories[0]?.installedVersion === requestBody?.queries[0]?.version, 'the installed version is retained')
  ok(result.advisories[0]?.severity === 'high', 'provider severity is normalized')
  ok(result.advisories[0]?.patchedVersion === '9.9.9', 'the fixed version comes from a verified fixed event')
  ok(result.advisories[0]?.source.includes('github.com/advisories'), 'the upstream reference is retained')
  ok(result.advisories[0]?.checkedAt === result.checkedAt, 'the check timestamp is recorded')

  let retries = 0
  clearLiveAdvisoryCache()
  const unavailable = await checkLiveAdvisories({
    force: true,
    fetcher: async () => { retries++; return new Response('unavailable', { status: 503 }) },
  })
  ok(!unavailable.verified, 'an unavailable provider is not a clean result')
  ok(unavailable.advisories.length === 0, 'an unavailable response is not presented as zero advisories')
  ok(retries === 2, 'provider failures are retried only once')
  ok(Boolean(unavailable.error?.includes('503')), 'the provider failure is explained')

  clearLiveAdvisoryCache()
  const timeout = await checkLiveAdvisories({
    force: true,
    timeoutMs: 5,
    fetcher: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    }),
  })
  ok(!timeout.verified, 'provider timeouts remain unverified')
  ok(timeout.error === 'The advisory source timed out.', 'timeouts have an explicit safe status')

  clearLiveAdvisoryCache()
  let fetchCount = 0
  const cacheFetcher: typeof fetch = async (_input, init) => {
    fetchCount++
    const body = JSON.parse(String(init?.body)) as { queries: unknown[] }
    return Response.json({ results: body.queries.map(() => ({ vulns: [] })) })
  }
  const first = await checkLiveAdvisories({ fetcher: cacheFetcher, force: true })
  const second = await checkLiveAdvisories({ fetcher: cacheFetcher })
  ok(first.verified && second.verified, 'cached results remain verified')
  ok(fetchCount === 1, 'successful checks are cached')
  clearLiveAdvisoryCache()

  console.log(`Live advisories: ${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

main().catch((error) => { console.error(error); process.exit(1) })
