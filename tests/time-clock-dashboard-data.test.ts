import { fetchDashboardJson, type DashboardFetcher } from '../src/lib/time-clock-dashboard-data'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
    console.log(`  PASS ${message}`)
  } else {
    failed++
    console.error(`  FAIL ${message}`)
  }
}

async function main() {
  const successFetcher: DashboardFetcher = async () => ({
    ok: true,
    json: async () => ({ count: 3 }),
  })
  const success = await fetchDashboardJson<{ count: number }>('/report', successFetcher)
  assert(success.success && success.data.count === 3, 'successful section data is preserved')

  const rejectedFetcher: DashboardFetcher = async () => {
    throw new Error('sensitive upstream detail')
  }
  const rejected = await fetchDashboardJson('/board', rejectedFetcher)
  assert(!rejected.success, 'a network failure becomes a section failure instead of rejecting')
  assert(!JSON.stringify(rejected).includes('sensitive upstream detail'), 'upstream details are not exposed to the UI')

  const failedResponse = await fetchDashboardJson('/entries', async () => ({
    ok: false,
    json: async () => ({ error: 'private server detail' }),
  }))
  assert(!failedResponse.success, 'an unsuccessful HTTP response becomes a section failure')

  const malformedResponse = await fetchDashboardJson('/filters', async () => ({
    ok: true,
    json: async () => { throw new Error('invalid response') },
  }))
  assert(!malformedResponse.success, 'an unreadable response becomes a section failure')

  const [unavailableSection, healthySection] = await Promise.all([
    fetchDashboardJson('/unavailable', rejectedFetcher),
    fetchDashboardJson<{ count: number }>('/healthy', successFetcher),
  ])
  assert(!unavailableSection.success && healthySection.success && healthySection.data.count === 3, 'one failed section does not discard a healthy section')

  console.log(`\nTime clock dashboard requests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

void main()
