/**
 * Tenant-scope inventory.
 *
 * Phase 5 of the improvement program asks for an inventory of every tenant-scoped data path:
 * which models belong to a business, which routes touch them, and whether each route both
 * authenticates and scopes by business. Writing that by hand goes stale the moment somebody
 * adds a route, so it is generated from the source.
 *
 * This is a static reading of the code. It answers "does this route mention a business filter"
 * and "does it call a guard", which is evidence a person can then check by reading the route.
 * It is NOT proof that a query is safe, and the generated document says so.
 *
 * Usage: npx tsx scripts/tenant-inventory.ts [--check]
 *   --check exits 1 when a route that touches tenant data has no visible guard.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join, relative, resolve } from 'path'
import { classify, parseModels } from './rls-plan'

const ROOT = process.cwd()
const SCHEMA = resolve(ROOT, 'prisma/schema.prisma')
const API_DIR = resolve(ROOT, 'src/app/api')
const OUT = resolve(ROOT, 'docs/TENANT-INVENTORY.md')

interface ModelInfo {
  name: string
  tenantColumn: string | null
  note: string
}

function readModels(): ModelInfo[] {
  const parsed = parseModels(readFileSync(SCHEMA, 'utf8'))
  const plans = new Map(classify(parsed).map((row) => [row.model, row]))
  return parsed.map((model) => {
    const classification = plans.get(model.name)
    const hasBusinessId = model.fields.some((field) => field.name === 'businessId')
    const hasOrganizationId = model.fields.some((field) => field.name === 'organizationId')
    let tenantColumn: string | null = null
    let note = 'platform-level; verify its separate authorization boundary'

    if (classification?.classification === 'tenant_root') {
      tenantColumn = 'id'
      note = 'business tenant root'
    } else if (classification?.classification === 'organization_root') {
      tenantColumn = 'id'
      note = 'organization tenant root'
    } else if (classification?.classification === 'direct') {
      tenantColumn = 'businessId'
      note = 'shop-scoped'
    } else if (classification?.classification === 'indirect') {
      tenantColumn = `via ${classification.via}`
      note = 'inherits tenant scope from a parent relation'
    } else if (classification?.classification === 'organization') {
      tenantColumn = hasBusinessId ? 'organizationId + businessId' : 'organizationId'
      note = hasBusinessId ? 'organization- and shop-scoped; both access paths need review' : 'organization-scoped'
    }

    if (hasOrganizationId && hasBusinessId && classification?.classification === 'direct') {
      tenantColumn = 'businessId + organizationId'
      note = 'has both keys; confirm which access path each operation authorizes'
    }

    return { name: model.name, tenantColumn, note }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

function tenantHelperCallSites(): string[] {
  const src = resolve(ROOT, 'src')
  const scan = (dir: string, found: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) scan(full, found)
      else if (/\.tsx?$/.test(entry) && full !== resolve(src, 'lib/tenant-context.ts')) {
        if (/withTenant\s*\(/.test(readFileSync(full, 'utf8'))) found.push(relative(ROOT, full).replace(/\\/g, '/'))
      }
    }
    return found
  }
  return scan(src).sort()
}

interface RouteInfo {
  path: string
  guards: string[]
  publicEvidence: string[]
  tenantFilters: string[]
  modelsTouched: string[]
  verdict: 'guarded-and-scoped' | 'guarded-no-visible-filter' | 'public-with-evidence' | 'no-visible-guard'
}

const GUARD_PATTERNS: Array<[RegExp, string]> = [
  [/requireOwner\(/, 'requireOwner'],
  [/requireBusinessAdmin\(/, 'requireBusinessAdmin'],
  [/requireAuth\(/, 'requireAuth'],
  [/requirePlatformOwner\(/, 'requirePlatformOwner'],
  [/getServerSession\(/, 'getServerSession'],
  [/CRON_SECRET/, 'CRON_SECRET bearer'],
  [/resolveOrganizationContext\(/, 'resolveOrganizationContext'],
  [/verifyWebhook|constructEvent|validateSignature|verifyStripeSignature\(|isValidTwilioSignature\(/, 'webhook signature verification'],
  [/PORTAL_SESSION_COOKIE|portalSession\./, 'customer portal session token'],
  [/requireStaff\(/, 'requireStaff'],
]

/**
 * Evidence of deliberate public handling. A booking or registration route is meant to be
 * reachable by someone who is not signed in; what matters is that it resolves the tenant from
 * verified data and limits abuse, not that it calls an auth guard.
 */
const PUBLIC_EVIDENCE: Array<[RegExp, string]> = [
  [/resolveBusinessId\(/, 'resolveBusinessId'],
  [/resolvePublicBusiness\(|resolveBusiness\(/, 'server-resolved public tenant'],
  [/findUnique\(\s*\{\s*where:\s*\{\s*slug\s*\}/, 'public tenant selected by server-verified shop slug'],
  [/checkRateLimit\(|rateLimit\(/, 'rate limited'],
  [/NextAuth\(authOptions\)/, 'public authentication protocol endpoint'],
  [/buildReadinessReport\(|prisma\.business\.count\(/, 'health/readiness response only'],
  [/status:\s*410/, 'retired route returns Gone'],
]

function readRoutes(models: ModelInfo[]): RouteInfo[] {
  const files = walk(API_DIR)
  const modelNames = models.map((m) => m.name)
  return files
    .map((file) => {
      const body = readFileSync(file, 'utf8')
      const guards = GUARD_PATTERNS.filter(([re]) => re.test(body)).map(([, label]) => label)
      const publicEvidence = PUBLIC_EVIDENCE.filter(([re]) => re.test(body)).map(([, label]) => label)
      const tenantFilters = [
        /\bbusinessId\s*:/.test(body) ? 'businessId' : null,
        /\borganizationId\s*:/.test(body) ? 'organizationId' : null,
        /withTenant\s*\(/.test(body) ? 'withTenant transaction' : null,
      ].filter((v): v is string => v !== null)
      const modelsTouched = modelNames.filter((m) => new RegExp(`(?:prisma|tx)\\.${m[0].toLowerCase()}${m.slice(1)}\\b`).test(body))
      const tenantModels = modelsTouched.filter((m) => models.find((x) => x.name === m)?.tenantColumn)
      const verdict: RouteInfo['verdict'] =
        guards.length > 0
          ? tenantModels.length > 0 && tenantFilters.length === 0
            ? 'guarded-no-visible-filter'
            : 'guarded-and-scoped'
          : publicEvidence.length > 0
            ? 'public-with-evidence'
            : 'no-visible-guard'
      return {
        path: relative(resolve(ROOT, 'src/app'), file).replace(/\/route\.ts$/, '').replace(/\\/g, '/'),
        guards,
        publicEvidence,
        tenantFilters,
        modelsTouched: tenantModels,
        verdict,
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

function render(models: ModelInfo[], routes: RouteInfo[], tenantHelperFiles: string[]): string {
  const tenantModels = models.filter((m) => m.tenantColumn)
  const unguarded = routes.filter((r) => r.verdict === 'no-visible-guard')
  const publicRoutes = routes.filter((r) => r.verdict === 'public-with-evidence')
  const unfiltered = routes.filter((r) => r.verdict === 'guarded-no-visible-filter')

  const lines: string[] = []
  lines.push('# Tenant-scope inventory')
  lines.push('')
  lines.push('Generated by `npm run tenant:inventory` (`scripts/tenant-inventory.ts`). Do not edit by hand;')
  lines.push('re-run it after changing a model or adding a route.')
  lines.push('')
  lines.push('**What this is.** A static reading of `prisma/schema.prisma` and every `route.ts` under')
  lines.push('`src/app/api`. It records which models carry a tenant column, which routes touch them, which')
  lines.push('guards a route visibly calls, and whether a tenant filter is visibly present.')
  lines.push('')
  lines.push('**What this is not.** It is not proof that a query is safe. A route can mention')
  lines.push('`businessId` and still build the wrong filter, and a guard can be called after a read. This')
  lines.push('inventory is the list to review, not the review itself. Behavioural coverage lives in')
  lines.push('`tests/tenant-isolation.test.ts`, `tests/organization-isolation.test.ts` and the per-route')
  lines.push('suites.')
  lines.push('')
  lines.push('## Models with a tenant column')
  lines.push('')
  lines.push(`Count: **${tenantModels.length}** of ${models.length} models, including indirect and organization scopes.`)
  lines.push('')
  lines.push('| Model | Tenant key / path | Meaning |')
  lines.push('| --- | --- | --- |')
  for (const m of models) {
    lines.push(`| \`${m.name}\` | ${m.tenantColumn ? `\`${m.tenantColumn}\`` : '—'} | ${m.note} |`)
  }
  lines.push('')
  lines.push('## Routes')
  lines.push('')
  lines.push(`Count: **${routes.length}**. Guarded and visibly scoped: **${routes.filter((r) => r.verdict === 'guarded-and-scoped').length}**.`)
  lines.push(`Guarded with no visible tenant filter: **${unfiltered.length}**. Public by design with tenant resolution or rate limiting: **${publicRoutes.length}**. No guard and no public-handling evidence: **${unguarded.length}**.`)
  lines.push('')
  lines.push('| Route | Guards | Public handling | Visible tenant filters | Tenant models touched |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const r of routes) {
    const flag = r.verdict === 'no-visible-guard' ? ' ⚠️' : r.verdict === 'guarded-no-visible-filter' ? ' ⚠️' : ''
    lines.push(
      `| \`${r.path}\`${flag} | ${r.guards.join(', ') || '—'} | ${r.publicEvidence.join(', ') || '—'} | ${r.tenantFilters.join(', ') || '—'} | ${r.modelsTouched.join(', ') || '—'} |`
    )
  }
  lines.push('')
  if (publicRoutes.length > 0) {
    lines.push('## Public by design')
    lines.push('')
    lines.push('Reachable without signing in, which is correct for booking and registration. Each resolves its')
    lines.push('tenant from verified data (`resolveBusinessId`) and/or limits abuse. These are listed so a')
    lines.push('reviewer can confirm the tenant resolution is genuine rather than trusting the label.')
    lines.push('')
    for (const r of publicRoutes) lines.push(`- \`${r.path}\` — ${r.publicEvidence.join(', ')}; touches ${r.modelsTouched.join(', ') || 'no tenant model'}.`)
    lines.push('')
  }
  if (unguarded.length > 0) {
    lines.push('## No guard and no public-handling evidence')
    lines.push('')
    lines.push('Nothing in the file shows how access is decided. Read each one.')
    lines.push('')
    for (const r of unguarded) lines.push(`- \`${r.path}\` — touches ${r.modelsTouched.join(', ') || 'no tenant model'}.`)
    lines.push('')
  }
  if (unfiltered.length > 0) {
    lines.push('## Guarded routes with no visible tenant filter')
    lines.push('')
    lines.push('These may be legitimate: an organization-wide aggregate, a platform-owner screen, or a route')
    lines.push('that scopes through a helper. Each one needs a reader to confirm which.')
    lines.push('')
    for (const r of unfiltered) lines.push(`- \`${r.path}\` — guards: ${r.guards.join(', ')}; touches ${r.modelsTouched.join(', ')}.`)
    lines.push('')
  }
  lines.push('## Row-Level Security')
  lines.push('')
  lines.push('RLS is staged, not production-enforced. The policy template and static coverage checks do not prove')
  lines.push('the current SQL on PostgreSQL, a non-owner runtime, or a staging deployment. See the rollout gates in')
  lines.push('`docs/RLS-STAGING-PLAN.md`; organization transaction context and full application adoption remain open.')
  lines.push('')
  lines.push('## Phase 5 status, measured')
  lines.push('')
  lines.push('| Item | State |')
  lines.push('| --- | --- |')
  lines.push('| Application-level tenant checks | This inventory is a review queue, not proof. For each high-risk route, confirm identity source, resolved tenant, query predicates, resource ownership, capability check, and safe denial behavior. |')
  lines.push(`| \`withTenant()\` application call sites | ${tenantHelperFiles.length} source files: ${tenantHelperFiles.map((file) => `\`${file}\``).join(', ') || 'none'}. This is selective coverage, not completion of the tenant-query audit. |`)
  lines.push('| Organization-wide aggregates | Organization capabilities and location membership are separate checks. Each report/query still requires review for record-level scoping and customer-data exclusion. |')
  lines.push('| Row-Level Security | Not production-enforced. The policy template and static model mapping are not evidence of a live role split or staging enforcement. |')
  lines.push('| Cross-tenant behavioural tests | `tests/tenant-isolation.test.ts` and `tests/organization-isolation.test.ts`, plus the per-route suites. This inventory is the review list, not the proof. |')
  lines.push('')
  return lines.join('\n')
}

function main() {
  const models = readModels()
  const routes = readRoutes(models)
  const helperFiles = tenantHelperCallSites()
  const document = render(models, routes, helperFiles)
  mkdirSync(resolve(ROOT, 'docs'), { recursive: true })
  writeFileSync(OUT, document + '\n')
  console.log(`Wrote ${relative(ROOT, OUT)}`)
  console.log(`  tenant-scoped models: ${models.filter((m) => m.tenantColumn).length}/${models.length}`)
  console.log(`  withTenant call-site files: ${helperFiles.length}`)
  console.log(`  routes scanned: ${routes.length}`)
  console.log(`  no visible guard: ${routes.filter((r) => r.verdict === 'no-visible-guard').length}`)
  console.log(`  guarded, no visible tenant filter: ${routes.filter((r) => r.verdict === 'guarded-no-visible-filter').length}`)

  if (process.argv.includes('--check')) {
    const unguarded = routes.filter((r) => r.verdict === 'no-visible-guard')
    if (unguarded.length > 0) {
      console.error('\nRoutes with no visible guard:')
      for (const r of unguarded) console.error('  - ' + r.path)
      process.exit(1)
    }
  }
}

main()
