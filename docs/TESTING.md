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

## Browser E2E, accessibility, and security tests (Playwright)

`e2e/` contains real-browser end-to-end tests (Playwright + Chromium):

- `public-booking.spec.ts` — guest visitor completes the full booking
  wizard (service → barber → date → time → details → confirm →
  confirmation page).
- `staff-login.spec.ts` — staff login reaches the dashboard;
  `/dashboard` without a session redirects to login.
- `security.spec.ts` — browser-level attack attempts: unauthenticated
  dashboard API calls, forged IDs, direct-URL access to dashboard
  pages, portal endpoints without a portal session.
- `accessibility.spec.ts` — automated axe (WCAG 2.1 A/AA) scans of the
  home, booking, services, and login pages, plus a keyboard-focus test.

Running them requires a real environment (they do NOT run in the
server-free CI): a PostgreSQL database with migrations + seed applied,
plus Chromium:

```
npm run e2e:install-browsers
E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... npm run test:e2e
```

Playwright starts the production server itself (`webServer` in
`playwright.config.ts`), or point `E2E_BASE_URL`/`E2E_NO_WEBSERVER` at
an already-running instance. Staff-login credentials come from env —
seed a dedicated E2E staff account; do not use production accounts.

**Accessibility caveat:** an axe pass is necessary but not sufficient.
The manual checklist (screen-reader walkthrough, reduced-motion,
dialog focus trapping, date/time controls) must be performed per
release; record results per client deployment.

## Other gates

- `npm run master:check` — architecture check + client-independence scan +
  lint + typecheck + prisma validate/generate + strict N+1 scan + production
  build (one gate for "master template ready").
- `npx tsx scripts/perf-check.ts` — N+1 pattern scanner (REVIEW mode;
  `--strict` fails on untriaged findings and runs inside master:check;
  see docs/PERFORMANCE.md).
- GitHub Actions ("Template CI") runs four jobs: template validation
  (architecture check, lint, typecheck, prisma validate/generate,
  production build); server tests against a real PostgreSQL service
  (`migrate deploy` + `test:ci`, 20 suites); browser E2E + accessibility
  (chromium + Playwright: guest booking, staff login, security bypass,
  WCAG 2.1 AA axe scan against the production build with the seed and
  E2E prep scripts applied); and a report-only production dependency
  audit. The Architecture Constitution workflow separately enforces the
  architecture rules on every PR.
