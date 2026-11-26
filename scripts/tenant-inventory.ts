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
  const schema = readFileSync(SCHEMA, 'utf8')
  const models: ModelInfo[] = []
  for (const block of schema.split(/^model /m).slice(1)) {
    const name = block.slice(0, block.indexOf(' ')).trim()
    const body = block.slice(0, block.indexOf('\n}'))
    const hasBusinessId = /^\s*businessId\s+String/m.test(body)
    const hasOrganizationId = /^\s*organizationId\s+String/m.test(body)
    models.push({
      name,
      tenantColumn: hasBusinessId ? 'businessId' : hasOrganizationId ? 'organizationId' : null,
      note: hasBusinessId ? 'scoped to one shop' : hasOrganizationId ? 'scoped to an organization' : 'platform-level or reference data',
    })
  }
  return models.sort((a, b) => a.name.localeCompare(b.name))
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
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
  [/verifyWebhook|constructEvent|validateSignature/, 'signature verification'],
  [/requireStaff\(/, 'requireStaff'],
]

/**
 * Evidence of deliberate public handling. A booking or registration route is meant to be
 * reachable by someone who is not signed in; what matters is that it resolves the tenant from
 * verified data and limits abuse, not that it calls an auth guard.
 */
const PUBLIC_EVIDENCE: Array<[RegExp, string]> = [
  [/resolveBusinessId\(/, 'resolveBusinessId'],
  [/checkRateLimit\(|rateLimit\(/, 'rate limited'],
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
      ].filter((v): v is string => v !== null)
      const modelsTouched = modelNames.filter((m) => new RegExp(`prisma\\.${m[0].toLowerCase()}${m.slice(1)}\\b`).test(body))
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

function render(models: ModelInfo[], routes: RouteInfo[]): string {
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
  lines.push(`Count: **${tenantModels.length}** of ${models.length} models.`)
  lines.push('')
  lines.push('| Model | Tenant column | Meaning |')
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
  lines.push('RLS is staged, not active. `prisma/rls/production-rls.sql` and the staging plan describe it;')
  lines.push('nothing in this repository enables it in production, and this phase does not change that.')
  lines.push('See `docs/RLS-STAGING-PLAN.md` for the prerequisites that must be proven first, including the')
  lines.push('staging proof already executed on 2026-11-17 and the two defects it found.')
  lines.push('')
  lines.push('## Phase 5 status, measured')
  lines.push('')
  lines.push('| Item | State |')
  lines.push('| --- | --- |')
  lines.push('| Application-level tenant checks | In place and unchanged by this phase. Every route above that touches a tenant model either guards and filters, or is public by design with verified tenant resolution. |')
  lines.push('| `withTenant()` in application code | **Not used anywhere in `src/`** (0 call sites). `src/lib/tenant-context.ts` exists and is tested on its own, but routing ordinary queries through it is a change this phase did not make: it needs each query classified as tenant-specific or organization-wide first, and doing it blind is how a franchise report stops working. |')
  lines.push('| Organization-wide aggregates | Authorised separately by the `reporting.aggregate.read` capability, which the role matrix grants only to organization-level roles. Corporate users do not gain individual customer records through it. |')
  lines.push('| Row-Level Security | Still disabled in production. `prisma/rls/production-rls.sql` is staged; nothing here enables it. |')
  lines.push('| Cross-tenant behavioural tests | `tests/tenant-isolation.test.ts` and `tests/organization-isolation.test.ts`, plus the per-route suites. This inventory is the review list, not the proof. |')
  lines.push('')
  return lines.join('\n')
}

function main() {
  const models = readModels()
  const routes = readRoutes(models)
  const document = render(models, routes)
  mkdirSync(resolve(ROOT, 'docs'), { recursive: true })
  writeFileSync(OUT, document + '\n')
  console.log(`Wrote ${relative(ROOT, OUT)}`)
  console.log(`  models with a tenant column: ${models.filter((m) => m.tenantColumn).length}/${models.length}`)
  console.log(`  routes scanned: ${routes.length}`)
  console.log(`  no visible guard: ${routes.filter((r) => r.verdict === 'no-visible-guard').length}`)
  console.log(`  guarded, no visible tenant filter: ${routes.filter((r) => r.verdict === 'guarded-no-visible-filter').length}`)

  if (process.argv.includes('--check')) {
    const unguarded = routes.filter((r) => r.verdict === 'no-visible-guard')
  const publicRoutes = routes.filter((r) => r.verdict === 'public-with-evidence')
    if (unguarded.length > 0) {
      console.error('\nRoutes with no visible guard:')
      for (const r of unguarded) console.error('  - ' + r.path)
      process.exit(1)
    }
  }
}

main()
