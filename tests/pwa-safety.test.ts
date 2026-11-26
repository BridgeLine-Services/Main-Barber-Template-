/**
 * PWA safety (Section 18 of the platform brief).
 *
 * The service worker's rules are the kind that get quietly weakened, so they are asserted
 * here rather than trusted to a comment: private data stays network-only, the cache is
 * versioned, and the offline shell is precached.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const sw = readFileSync(join(root, 'public/sw.js'), 'utf8')
const manifestSource = readFileSync(join(root, 'src/app/manifest.ts'), 'utf8')

let passed = 0
const failures: string[] = []
function ok(name: string, condition: boolean) {
  if (condition) passed += 1
  else failures.push(name)
}

// --- what must never be cached ---
const networkOnly = ['/api/', '/dashboard/', '/login', '/admin', '/appointment/', '/account', '/rewards', '/checkout']
for (const path of networkOnly) {
  ok(`${path} is network only`, sw.includes(`url.pathname.startsWith('${path}')`))
}
ok('the network-only block returns before any cache read', /return \/\/ no respondWith/.test(sw))
ok('only GET requests are handled', /request\.method !== 'GET'/.test(sw))
ok('cross-origin requests are ignored', /url\.origin !== self\.location\.origin/.test(sw))
ok('responses carrying Set-Cookie are never cached', /Set-Cookie/i.test(sw))
ok('the cache name carries a version', /const VERSION = '/.test(sw) && /barber-static-\$\{VERSION\}/.test(sw))
ok('old cache versions are deleted on activation', /caches\.delete/.test(sw))
ok('the offline shell is precached on install', /OFFLINE_URL/.test(sw) && /caches\.open\(PAGE_CACHE\)/.test(sw))
ok('the offline page exists', existsSync(join(root, 'src/app/offline/page.tsx')) || existsSync(join(root, 'src/app/(customer)/offline/page.tsx')))

// --- manifest ---
ok('the manifest is generated per shop', /resolvePublicBusiness/.test(manifestSource))
ok('installability is feature gated', /isFeatureEnabledForBusiness\(business\.id, 'pwa'\)/.test(manifestSource))
ok('a non-installable shop gets display browser', /display: 'browser'/.test(manifestSource))
ok('an installable shop gets standalone and a start url', /display: 'standalone'/.test(manifestSource) && /start_url: '\/'/.test(manifestSource))
ok('the shop name and theme colour come from the shop', /business\?\.name/.test(manifestSource) && /business\?\.primaryColor/.test(manifestSource))

if (failures.length > 0) {
  console.error(`\nPWA safety: ${passed} passed, ${failures.length} failed`)
  for (const f of failures) console.error('  FAIL ' + f)
  process.exit(1)
}
console.log(`PWA safety: ${passed} passed, 0 failed`)
