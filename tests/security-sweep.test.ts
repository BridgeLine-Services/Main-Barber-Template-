/**
 * Part 6: the security sweep, expressed as checks that fail when a protection is lost.
 *
 * This suite is deliberately structural rather than decorative. It does not claim the
 * platform cannot be attacked; it proves four things that can be proven from the tree:
 *
 *  1. Every API route either calls an authorization guard or is one of a named public
 *     endpoints, each with the specific protection it relies on.
 *  2. No route takes the tenant from the request body — the business always comes from
 *     the session, so a forged id cannot read another shop.
 *  3. Nothing in the applied migrations turns on FORCE ROW LEVEL SECURITY, which would
 *     change production behaviour without the staged plan and its approval.
 *  4. Raw HTML injection and live credential literals do not spread unnoticed.
 *
 * Adding a route without a guard now fails the build, which is the point.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    return
  }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ROOT = join(__dirname, '..')
const API = join(ROOT, 'src', 'app', 'api')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const routeFiles = walk(API).map((f) => relative(ROOT, f)).sort()
ok('the API surface was found', routeFiles.length > 100, String(routeFiles.length))

const GUARDS = [
  'requireAuth',
  'requireOwner',
  'requireBusinessAdmin',
  'requireStaff',
  'requirePlatformOwner',
  'getServerSession',
  'verifyBusinessAccess',
  'resolveTenant',
  'resolvePublicBusiness',
  'checkRateLimit',
]

/**
 * Endpoints that are meant to be reachable without a session. Each one states why, and
 * the protection it relies on instead. The `proof` must match the file, so an endpoint
 * that silently loses its signature check or its token check fails here.
 */
const PUBLIC_BY_DESIGN: Record<string, { why: string; proof: RegExp }> = {
  'src/app/api/appointments/route.ts': { why: 'removed endpoint, returns 410', proof: /410/ },
  'src/app/api/appointments/[id]/route.ts': { why: 'removed endpoint, returns 410', proof: /410/ },
  'src/app/api/auth/[...nextauth]/route.ts': { why: 'NextAuth handler itself', proof: /NextAuth/ },
  'src/app/api/cron/maintenance-report/route.ts': { why: 'scheduled job, secret header, read-only', proof: /CRON_SECRET/ },
  'src/app/api/cron/memberships/route.ts': { why: 'scheduled job, secret header', proof: /CRON_SECRET/ },
  'src/app/api/cron/organization-invitation-delivery/route.ts': { why: 'scheduled job, secret header', proof: /CRON_SECRET/ },
  'src/app/api/cron/reminders/route.ts': { why: 'scheduled job, secret header', proof: /CRON_SECRET/ },
  'src/app/api/cron/review-requests/route.ts': { why: 'scheduled job, secret header', proof: /CRON_SECRET/ },
  'src/app/api/ecommerce/checkout/route.ts': { why: 'public checkout, resolves the shop from its slug', proof: /businessSlug/ },
  'src/app/api/ecommerce/products/route.ts': { why: 'public catalogue, resolves the shop from its slug', proof: /businessSlug/ },
  'src/app/api/ecommerce/order-status/route.ts': { why: 'public order lookup by slug, order id and email', proof: /params\.get\('slug'\)/ },
  'src/app/api/gift-cards/purchase/route.ts': { why: 'public purchase, resolves the shop from its slug', proof: /resolvePublicBusiness/ },
  'src/app/api/gift-cards/status/route.ts': { why: 'public status by code, never returns the code', proof: /status/ },
  'src/app/api/health/route.ts': { why: 'liveness probe, no tenant data', proof: /export/ },
  'src/app/api/health/ready/route.ts': { why: 'readiness probe, no tenant data', proof: /export/ },
  'src/app/api/public/booking-questions/route.ts': { why: 'public booking questions, resolved to one shop', proof: /resolveBusiness\(\)/ },
  'src/app/api/public/policies/route.ts': { why: 'public policies, resolved to one shop', proof: /resolveBusiness\(\)/ },
  'src/app/api/public/portal/data-export/route.ts': { why: 'customer data export, portal token', proof: /token/i },
  'src/app/api/public/portal/logout/route.ts': { why: 'customer portal logout, portal token', proof: /token|session/i },
  'src/app/api/webhooks/stripe/route.ts': { why: 'payment webhook, signature verified', proof: /verifyStripeSignature/ },
  'src/app/api/webhooks/twilio/route.ts': { why: 'SMS webhook, signature verified', proof: /isValidTwilioSignature/ },
}

const unguarded: string[] = []
for (const file of routeFiles) {
  const source = readFileSync(join(ROOT, file), 'utf8')
  const hasGuard = GUARDS.some((g) => source.includes(g))
  if (hasGuard) continue
  unguarded.push(file)

  const entry = PUBLIC_BY_DESIGN[file]
  ok(`${file}: unguarded route is a known public endpoint`, Boolean(entry), file)
  if (entry) {
    ok(`${file}: keeps the protection it relies on (${entry.why})`, entry.proof.test(source), entry.why)
  }
}

ok('no unknown unguarded route exists', unguarded.every((f) => f in PUBLIC_BY_DESIGN), unguarded.filter((f) => !(f in PUBLIC_BY_DESIGN)).join(', '))

// ─── The tenant never comes from the request ───────────────────────────────

const bodyTenant: string[] = []
for (const file of routeFiles) {
  const source = readFileSync(join(ROOT, file), 'utf8')
  // A where clause scoped by a business id taken from the request is the classic IDOR.
  if (/businessId:\s*(body|payload|params|query|searchParams|input)\./.test(source)) bodyTenant.push(file)
}
ok('no route scopes a query to a tenant from the request', bodyTenant.length === 0, bodyTenant.join(', '))

const growthRoute = readFileSync(join(ROOT, 'src/app/api/dashboard/growth-stage/route.ts'), 'utf8')
ok('the new growth-stage route is owner-guarded', /requireOwner/.test(growthRoute))
ok('the growth-stage route takes its tenant from the session', /getBusinessIdForUser\(auth\.user\)/.test(growthRoute))
ok('the growth-stage route never reads a tenant from the body', !/businessId:\s*body/.test(growthRoute))
ok('the growth-stage route validates the value it writes', /isBusinessStage/.test(growthRoute))

// ─── RLS stays staged ──────────────────────────────────────────────────────

const migrationsDir = join(ROOT, 'prisma', 'migrations')
const migrationFiles: string[] = []
for (const entry of readdirSync(migrationsDir)) {
  const dir = join(migrationsDir, entry)
  if (statSync(dir).isDirectory() && existsSync(join(dir, 'migration.sql'))) {
    migrationFiles.push(join(dir, 'migration.sql'))
  }
}
ok('migrations were found', migrationFiles.length > 40, String(migrationFiles.length))

const forced = migrationFiles.filter((f) => /FORCE ROW LEVEL SECURITY/i.test(readFileSync(f, 'utf8')))
ok('no applied migration forces row level security', forced.length === 0, forced.join(', '))

const enabled = migrationFiles.filter((f) => /ENABLE ROW LEVEL SECURITY/i.test(readFileSync(f, 'utf8')))
ok(
  'row level security is enabled only where it was already enabled',
  enabled.every((f) => f.includes('add_gift_cards')),
  enabled.map((f) => relative(ROOT, f)).join(', '),
)
ok('the staged RLS scripts are present but not applied', existsSync(join(ROOT, 'prisma', 'rls', 'production-rls.sql')))
ok('the RLS plan document exists', existsSync(join(ROOT, 'docs', 'RLS-STAGING-PLAN.md')))

// ─── Raw HTML injection does not spread ───────────────────────────────────

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkSource(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const DSH_ALLOWED = new Set([
  'src/app/(dashboard)/dashboard/layout.tsx',
  'src/components/customer/SEO.tsx',
  'src/components/customer/ThemeStyle.tsx',
  'src/components/dashboard/DashboardPreview.tsx',
  'src/components/onboarding/BrandingStep.tsx',
  'src/components/seo/StructuredData.tsx',
])
const dsh = walkSource(join(ROOT, 'src'))
  .filter((f) => readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML'))
  .map((f) => relative(ROOT, f))
  .sort()
ok(
  'raw HTML injection is confined to the reviewed files',
  dsh.every((f) => DSH_ALLOWED.has(f)),
  dsh.filter((f) => !DSH_ALLOWED.has(f)).join(', '),
)

// ─── No live credentials in the tree ──────────────────────────────────────

const LIVE_SECRET = /(sk_live_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{12,})/
const leaking = walkSource(join(ROOT, 'src')).filter((f) => LIVE_SECRET.test(readFileSync(f, 'utf8')))
ok('no live credential literal is committed in src', leaking.length === 0, leaking.map((f) => relative(ROOT, f)).join(', '))

const envExample = existsSync(join(ROOT, '.env.example')) ? readFileSync(join(ROOT, '.env.example'), 'utf8') : ''
ok('the env example carries no real secret values', !LIVE_SECRET.test(envExample) && !/postgresql:\/\/[^@\s]*:[^@\s]+@/.test(envExample))

// ─── Session and password hardening stay centralized ──────────────────────

const passwordFiles = walkSource(join(ROOT, 'src')).filter((f) => /bcrypt\.(hash|compare)/.test(readFileSync(f, 'utf8')))
ok('password hashing stays behind one module', passwordFiles.length <= 2, passwordFiles.map((f) => relative(ROOT, f)).join(', '))

const proxy = existsSync(join(ROOT, 'src', 'proxy.ts')) ? readFileSync(join(ROOT, 'src', 'proxy.ts'), 'utf8') : ''
ok('the security middleware still sets a content security policy', /Content-Security-Policy/i.test(proxy))
ok('the security middleware still sets frame protection', /X-Frame-Options|frame-ancestors/i.test(proxy))

console.log(`\nSecurity sweep: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
