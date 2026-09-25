import process from 'node:process'

const baseUrl = process.env.SMOKE_BASE_URL
if (!baseUrl) {
  console.error('SMOKE_BASE_URL is required, for example https://client.example.com')
  process.exit(1)
}

const origin = new URL(baseUrl)
const paths = ['/', '/book', '/login', '/api/health']
let failed = false

for (const pathname of paths) {
  const url = new URL(pathname, origin)
  try {
    const response = await fetch(url, { redirect: 'manual' })
    const acceptable = pathname === '/login'
      ? response.status < 500
      : response.status >= 200 && response.status < 400
    if (!acceptable) {
      failed = true
      console.error(`FAIL ${pathname}: HTTP ${response.status}`)
    } else {
      console.log(`PASS ${pathname}: HTTP ${response.status}`)
    }
  } catch (error) {
    failed = true
    console.error(`FAIL ${pathname}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failed) process.exit(1)
console.log('Smoke test passed. Booking creation remains intentionally manual/non-destructive.')
