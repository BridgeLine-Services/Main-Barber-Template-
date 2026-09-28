# Testing

## Test suites (30 files, `tests/*.test.ts`)

Each suite is a standalone tsx script with its own harness — run any with
`npx tsx tests/<name>.test.ts`. Full runner reference: `package.json`.

### CI-safe suites (19) — run on every push/PR (Requirement 32)

These need only a Postgres database (CI provisions `postgres:15` as a
service; locally just have Postgres up and `DATABASE_URL` set):

architecture, barber-mode, booking, calendar-export, cancellation-fill,
customer-history, daily-operations, factory-launch, factory-readiness,
feature-flags (lib-level parts), marketing, payment-transitions,
portfolio, queue, reliability, rls-enforcement, role-permissions,
specialty-match, tenant-isolation, tenant-key-sync.

Run all: `npm run test:ci`

### Live-server suites (11) — run in dev against `next dev` on :3000

These exercise HTTP endpoints and/or session authentication end to end
(login cookies, feature-gated routes, public pages). They need a running
app, hence the dev server:

business-admin-role, business-deactivation, cross-tenant-matrix,
customer-data-lifecycle, feature-flags (HTTP part), fonts,
notification-resilience, ownership-transfer, platform-owner, pwa,
website-publish.

Run the full set locally: start `npm run dev`, then `npm run test:all`.

## Other gates

- `npm run master:check` — architecture check + client-independence scan +
  lint + typecheck + prisma validate/generate + production build (one
  gate for "master template ready").
- `npx tsx scripts/perf-check.ts [--strict]` — N+1 pattern scanner
  (REVIEW mode by default; see docs/PERFORMANCE.md).
- GitHub Actions ("Template CI") runs: architecture check, lint,
  typecheck, prisma validate/generate + migrate deploy, `test:ci`
  (19 suites), a report-only production dependency audit, and the
  production build. The Architecture Constitution workflow separately
  enforces the architecture rules on every PR.
