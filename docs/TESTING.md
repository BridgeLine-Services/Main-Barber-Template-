# Testing

## Test suites (33 TypeScript suites plus the Vercel build runner test)

Each suite is a standalone tsx script with its own harness — run any with
`npx tsx tests/<name>.test.ts`. Full runner reference: `package.json`.

### CI-safe suites (21) — run on every push/PR (Requirement 32)

These need only a Postgres database (CI provisions `postgres:15` as a
service; locally just have Postgres up and `DATABASE_URL` set):

architecture, barber-mode, booking, calendar-export, cancellation-fill,
commissions (settings, rate priority, ledger, tips modes, refunds,
fees, unpaid completions, tenant isolation), customer-history,
time-clock (master switch, punches, breaks, corrections, overtime,
pay periods, report/CSV, permissions, tenant isolation),
payroll (master switch, pay periods, aggregation, frozen snapshots,
forward-only status, adjustments, CSV, self-view, tenant isolation),
gift-cards (master switch, code security, purchase, full/partial/
multiple redemption, invalid/expired codes, refunds, concurrent
redemption race safety, adjustments, reporting, commissions
integration, tenant isolation),
shop-ui (order confirmation email fires once per settlement and never
throws without SMTP, checkout payload carries no client prices, per-slug
cart isolation, email-gated order status without enumeration, template
escaping),
daily-operations, factory-launch, factory-readiness, feature-flags
(lib-level parts), marketing, payment-transitions, payments (POS
end-to-end), portfolio, queue, reliability, role-permissions,
specialty-match, tenant-isolation, tenant-key-sync.

Run all: `npm run test:ci`

`npm run test:vercel-build` runs the isolated, database-free tests for
Vercel build configuration, migration error classification/retries, and
fail-closed build sequencing.

`npm run test:optional-integrations` verifies disabled email, SMS, and Google
providers make no outbound calls, enabled providers report missing
configuration, pay-at-shop remains available without Stripe, and Vercel cron
jobs stay within a once-daily schedule.

Also in CI: `tests/memberships-renewals.test.ts` (subscription lifecycle —
renewal replay/out-of-order safety, failed renewals, cancel sync, durable
period processing, isolation) runs inside `test:ci`; and the
`owner-registration-journey` live-server suite runs as its own Validate-job
step against the production build (`next start` on :3000 in onboarding mode
with `RATE_LIMIT_REGISTER_MAX=25`) — it needs a running app, so it is NOT
part of `test:ci`.

### Live-server suites (12) — run in dev against `next dev` on :3000

These exercise HTTP endpoints and/or session authentication end to end
(login cookies, feature-gated routes, public pages). They need a running
app, hence the dev server:

business-admin-role, business-deactivation, cross-tenant-matrix,
customer-data-lifecycle, customer-auth-security,
customer-password-reset (customer identity matrix + token-based password
recovery), feature-flags (HTTP part), fonts,
notification-resilience, owner-registration-journey (concurrent
first-owner race, bcrypt hashing, login → onboarding gate, post-owner
customer-only registration; needs `RATE_LIMIT_REGISTER_MAX=25`),
ownership-transfer, platform-owner, pwa,
website-publish, rls-enforcement, session-revocation (sign out of all devices:
two live sessions, wrong password refused, both killed, audit row, fresh
sign-in valid), twilio-consent (inbound STOP/START signed webhooks; START
resumes appointment texts only and never grants marketing consent),
email-optout (unsubscribe link works, preview/`GET` changes nothing, tampered
and expired links refused, cross-business payload blocked, unsubscribed
customers skipped, postal address and unsubscribe link present in every
marketing email, sending blocked without a postal address), and
dashboard-smoke (see the E2E list below), oauth-state-signing (Google
Business OAuth state: round trip, wrong user/business refused, tampering and
replay refused, ten-minute expiry, and the public development key rejected), rate-limit-ip
(forwarding headers trusted only behind Vercel or with
`RATE_LIMIT_TRUST_PROXY=true`, malformed and out-of-range addresses rejected,
IPv6 accepted, and unidentifiable callers sharing one bucket deliberately), and
stripe-event-claim (a fresh claim respected, a crashed claim taken over after
five minutes so Stripe's retries are not refused forever, FAILED reclaimable,
completed duplicates acknowledged, unsigned and forged deliveries refused), and
booking-concurrency (eight simultaneous bookings for one slot yield exactly one
appointment and seven plain-language refusals, two barbers can be booked at the
same instant, a replayed idempotency key returns the original row), and
timezone-dst (23- and 25-hour days, wall-clock conversions on both sides of each
change, the non-existent 02:30 normalising forward rather than backwards, and the
invariant that no slot label is ever offered twice).

Run the full set locally: start `npm run dev`, then `npm run test:all`.

Note: `rls-enforcement` runs in this dev set, not CI, because it requires
the app's DB role to NOT own the tenant tables (Postgres owners bypass
RLS). In CI the same user migrates and tests, so RLS cannot be enforced
there; it is validated against a properly role-split database instead
(see docs/RLS-*.md / scripts/rls-status.ts).

## Browser E2E, accessibility, and security tests (Playwright)

`e2e/` contains real-browser end-to-end tests (Playwright + Chromium):

- `public-booking.spec.ts` — guest visitor completes the full booking
  wizard (service → barber → date → time → details → confirm →
  confirmation page).
- `dashboard-smoke.spec.ts` — every dashboard page renders for an owner:
  no blank screen, no exception text, no browser errors across 16 routes
  (needs the same owner credentials as the other specs).
- `staff-login.spec.ts` — staff login reaches the dashboard;
  `/dashboard` without a session redirects to login.
- `security.spec.ts` — browser-level attack attempts: unauthenticated
  dashboard API calls, forged IDs, direct-URL access to dashboard
  pages, portal endpoints without a portal session.
- `accessibility.spec.ts` — automated axe (WCAG 2.1 A/AA) scans of the
  home, booking, services, and login pages, plus a keyboard-focus test.

They run in CI (Template CI → "E2E browser tests" job: Postgres
service + demo seed + production build + Chromium) and can also be run
locally. Running them locally requires a real environment: a PostgreSQL
database with migrations + seed applied, plus Chromium:

```
npm run e2e:install-browsers
E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... npm run test:e2e
```

Playwright starts the production server itself (`webServer` in
`playwright.config.ts`), or point `E2E_BASE_URL`/`E2E_NO_WEBSERVER` at
an already-running instance. Staff-login credentials come from env —
seed a dedicated E2E staff account; do not use production accounts.

The full suite registers several customer accounts within a single
minute, so raise the signup limiter for the run
(`RATE_LIMIT_REGISTER_MAX=25`; the production default of 3/min stays
intact) — without it the last staff-invitation test fails on rate
limiting, not on a real defect.

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
- GitHub Actions ("Template CI") has two jobs. `Validate template` runs the
  Vercel build runner and optional integration tests, a critical-severity production dependency audit,
  architecture checks, lint, typecheck, Prisma validation, database-backed
  tests, a production build, and the owner-registration journey against a
  health-checked production server. `E2E browser tests` uses a separate
  PostgreSQL service and deterministic demo-only configuration for Chromium
  browser tests. The Architecture Constitution workflow separately enforces
  the architecture rules on every PR. Obsolete runs on the same PR/ref are
  cancelled; neither workflow runs production migrations.

### Architecture: public write routes must be rate limited

`npm run architecture:check` fails if a route under `src/app/api/public/` exports
`POST` without calling `checkRateLimit`, unless the path is in the script's
allowlist with a stated reason (`portal/logout` is the only one). This exists
because the waitlist claim endpoint, which converts a token into a real
appointment, shipped with no limiter and nothing noticed.

---

## Current state of the suites (2026-11-05, commit b56f310)

Everything below this note describes suites that exist today; the note exists because
the numbers in the body drift with every commit, so treat the body as method and this
note as status.

- `npm run test:ci` — 44 suites, exit 0.
- `npx playwright test` — 67 passed, 1 skipped, 0 failed. The skip is the barber-navigation
  spec, which needs `E2E_BARBER_EMAIL`/`E2E_BARBER_PASSWORD`.
- `npm run test:a11y` — 8 passed (axe, WCAG A/AA, on public and authenticated pages).
- `npm run env:drift`, `npm run client:independence`, `npm run architecture:check`,
  `npm run test:architecture`, `npm run master:check` — all clean.
- Automation is not a human accessibility review. No screen-reader pass has been done.
- CI needs `RATE_LIMIT_REGISTER_MAX` raised for the auth suites; production keeps the
  stricter default. Widening a limit for tests is a test-environment concession, not a
  relaxation of the shipped configuration.
