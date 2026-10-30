import assert from 'node:assert/strict'
import { isAuthorizedCILocalMode } from '../src/lib/rate-limit'

const base = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  VERCEL: '0',
  RATE_LIMIT_CI_IN_MEMORY: 'true',
}

assert.equal(isAuthorizedCILocalMode(base), true, 'authorized GitHub Actions CI enables the isolated adapter')
assert.equal(isAuthorizedCILocalMode({ ...base, VERCEL: '1' }), false, 'Vercel deployments cannot enable the CI adapter')
assert.equal(isAuthorizedCILocalMode({ ...base, CI: 'false' }), false, 'ordinary production cannot enable the CI adapter')
assert.equal(isAuthorizedCILocalMode({ ...base, GITHUB_ACTIONS: 'false' }), false, 'non-GitHub CI cannot enable the CI adapter')
assert.equal(isAuthorizedCILocalMode({ ...base, RATE_LIMIT_CI_IN_MEMORY: 'false' }), false, 'explicit opt-in is required')
console.log('rate-limit CI mode checks passed')
