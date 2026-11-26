/**
 * Tenant scoping guard (Section 5 of the platform brief).
 *
 * The brief asks for an audit of tenant-sensitive routes for IDOR. An audit that is not
 * executable rots, so this is the audit as a test: every dashboard route must resolve who
 * is asking through an approved helper, and no route may take the business it is scoping by
 * from the request.
 *
 * Where a route legitimately reads a businessId from the body, it is a *target* (a location
 * being assigned or priced), not the scope, and it must be authorized through the
 * organization resolver. Those are listed by name with the reason, so adding one is a
 * deliberate act rather than a quiet edit.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')
const DASHBOARD = join(root, 'src/app/api/dashboard')

/** Any of these means the caller's identity came from the session, not the request. */
const IDENTITY_HELPERS = [
  'getServerSession',
  'requireAuth',
  'requireOwner',
  'requireAdmin',
  'requireBusinessAdmin',
  'requireCapability',
  'requireStaff',
  'getBusinessIdForUser',
  'getCurrentBusinessId',
  'resolveOrganizationContext',
]

/**
 * Routes allowed to read a businessId from the request body. Each is a target, not a scope,
 * and each must also authorize the actor against the organization.
 */
const BODY_TARGET_ALLOWED: Record<string, string> = {
  'organization/assignments/route.ts': 'the businessId is the location being assigned; authorized through resolveOrganizationContext and can()',
  'organization/pricing-requests/route.ts': 'the businessId is the location being priced; authorized through resolveOrganizationContext and can()',
  'ownership-transfer/route.ts': 'only read for a PLATFORM_OWNER initiated transfer; every other actor is scoped to their session business',
}

const BODY_PATTERNS = [
  "searchParams.get('businessId')",
  'searchParams.get("businessId")',
  'body.businessId',
  'body?.businessId',
  'parsed.data.businessId',
  'data.businessId',
]

function routeFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...routeFiles(full))
    else if (entry === 'route.ts') found.push(full)
  }
  return found
}

const files = routeFiles(DASHBOARD)
let p = 0
let f = 0
const ok = (name: string, condition: boolean) => {
  if (condition) p += 1
  else { f += 1; console.log('  FAIL', name) }
}

ok('the scan actually found the dashboard routes', files.length > 100)

const noIdentity: string[] = []
const scopedByRequest: string[] = []

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const relative = file.slice(DASHBOARD.length + 1)

  if (!IDENTITY_HELPERS.some((helper) => source.includes(helper))) noIdentity.push(relative)

  const readsBody = BODY_PATTERNS.some((pattern) => source.includes(pattern))
  if (readsBody) {
    const allowed = BODY_TARGET_ALLOWED[relative]
    if (!allowed) {
      scopedByRequest.push(relative)
    } else {
      // The exception has to keep earning itself.
      const authorized = source.includes('resolveOrganizationContext') || source.includes('PLATFORM_OWNER')
      ok(`${relative} keeps its authorization`, authorized)
    }
  }

  // A scope taken from the query string is never acceptable, allowlist or not.
  ok(
    `${relative} does not scope by query parameter`,
    !source.includes("searchParams.get('businessId')") && !source.includes('searchParams.get("businessId")'),
  )
}

ok(
  `every dashboard route resolves identity (${noIdentity.join(', ') || 'none missing'})`,
  noIdentity.length === 0,
)
ok(
  `no route scopes a tenant by a request body (${scopedByRequest.join(', ') || 'none'})`,
  scopedByRequest.length === 0,
)

// Every allowlisted route still exists; a stale entry hides a real change.
for (const relative of Object.keys(BODY_TARGET_ALLOWED)) {
  ok(`${relative} still exists`, files.some((file) => file.endsWith(relative)))
}

assert.ok(p > 0)
console.log(`\nTenant scoping guard: ${p} passed, ${f} failed across ${files.length} routes`)
if (f > 0) process.exit(1)
