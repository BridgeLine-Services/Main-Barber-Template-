# Launch readiness — reconciliation, 5 November 2026

Earlier acceptance pages disagree with each other and with the source. This page is the
current record. It states what was verified, where, and what is still blocking, and it
does not treat "the code exists" as "the feature works".

## 1. First-owner registration

**Cause.** `src/app/api/auth/register/route.ts` called `checkRateLimit()` and then
discarded the result's meaning, returning its own hardcoded
`Too many attempts. Please wait a minute and try again.` for any denial. On a fresh
deployment with no Upstash credentials the limiter correctly reports
`store_not_configured`, the route reported it as a 429, and a first owner was told they
had abused a form they had never submitted.

**Fix.** All three routes that hand-rolled this message now return
`rateLimitResponse(denial)`: 429 only when the window is genuinely exhausted, 503 when
the store is missing or unreachable, each with its own wording and `Retry-After`.

**Evidence.**
- `tests/registration-route.test.ts` — 23 assertions against the real `POST` handler:
  unreachable store → 503 with no blame and no Redis detail; genuine flood → 429;
  first owner → 201; second owner → 409 closed; forged `role` → stored CUSTOMER;
  duplicate email → 409 with no driver text; store recovery → 201 again; no test
  accounts left behind.
- Live deployment `main-barber-template.vercel.app`, 5 Nov 2026: registration answers
  **503** with `Retry-After: 60` and the honest wording. That is proof of two things at
  once — the message is no longer a lie, and **Upstash is not configured in that
  deployment**, so it cannot accept a first owner until it is.

## 2. Environment registry

`src/lib/env-registry.ts` is the single contract: 79 declared variables (74 of them in the generated .env.example; the rest are platform-managed or retired), fifteen categories,
required-at-build vs required-at-runtime, conditional requirements per feature, aliases
and fallbacks, format validation, and a redaction helper. `.env.example` is generated
from it (`npm run env:template`) and now documents 79 declared variables (74 of them in the generated .env.example; the rest are platform-managed or retired) instead of 32.

Resolved conflicts: Redis, Blob, Stripe, the 2FA key, `REQUIRE_OWNER_2FA` and
`CSP_NONCE_ENABLED` are all in the inventory; the retired provisioning token is out;
whitespace is not a value; aliases resolve and are reported as derived with a warning.

`tests/env-registry.test.ts` — 51 assertions, including that a missing Redis in
production is `MISSING` (the exact bug), that disabling email removes the SMTP
requirement, and that secrets never surface in a report.

## 3. Diagnostics and preflight

| Command | What it does |
| --- | --- |
| `npm run env:check` | Inventory only. No network. Safe to run anywhere. |
| `npm run env:doctor` | Adds a database probe and a Redis PING. |
| `npm run env:doctor:deep` | Adds provider reachability (no messages sent, no charges). |
| `npm run client:preflight` | Blocking gate: exit 1 unless first-owner registration would actually work. |
| `npm run client:setup` | Eight-step wizard, dry-run by default, `--apply` to write `.env.local` (0600). |

Secret values are never printed, never sent to the browser, and never written into a
`NEXT_PUBLIC_*` variable.

## 4. What remains blocked, and by what

| Item | Blocked by |
| --- | --- |
| Live deployment accepting a first owner | Upstash REST URL and token in Vercel (Production and Preview) |
| Stripe readiness | Test-mode acceptance run with real test keys |
| SMS readiness | Twilio credentials in a staging deployment |
| Email readiness | SMTP credentials in a staging deployment |
| Nonce CSP | `CSP_NONCE_ENABLED` verified in staging across site, booking, portal, dashboard, previews, exports |
| Legal review | Attorney |
| Accessibility | Independent pass with assistive technology |
| Master repository protection | Make the repository private, protect `main`, require reviewed PRs and passing CI, block force pushes — needs the owner's explicit authorisation |
| Commercial hosting | The Vercel project runs on Hobby, which the documentation already states is not appropriate for commercial client hosting — needs an owner decision, not a code change |

No amount of further code closes these; each needs a credential, a machine, or a person.

## 5. Test evidence

Verified locally and/or in CI: registration route 23, environment registry 51, environment
enum contract 22, booking concurrency 13, timezone/DST 18, optional integrations 20. The
full chain runs 41 suites via `npm run test:all`, and `npm run env:drift` fails the build
if the source reads a variable the registry does not declare.

## 6. Readiness

Roughly 80% of a commercial launch. Every remaining point is one of the **nine** rows
above — three of which (payments, SMS, email) are provider acceptance runs rather than
code, and two of which (repository protection, hosting plan) are decisions that belong to
the owner.

The figure moved down, not up, because this round added two blockers that were always true
and simply were not written down, and because "every remaining point is attributable to the
rows above" only holds when the rows are complete. It is not 100% and must not be described
as production-ready until the live deployment registers a first owner and the provider
acceptances have actually run.

## 7. Commercial hosting and repository protection

Both are release blockers that no code change closes, and both need explicit owner
authorization before anything is touched.

**Hosting.** The project runs on a Vercel Hobby plan. Hobby is for personal, non-commercial
projects and does not permit commercial use, so every client deployment must sit on a paid
plan (Pro, or the client's own team). This is a billing decision, not an engineering one,
and nothing in this repository upgrades it automatically.

**Repository protection.** The master repository is public and the LICENSE is a structural
framework awaiting attorney approval. Before the first client deployment the operator
should, with the owner's authorization:

1. Make the repository private (GitHub → Settings → General → Danger Zone).
2. Protect `main`: require a pull request, require the `Validate template` and
   `Architecture Constitution` checks to pass, disallow force pushes, disallow deletion.
3. Keep a recoverable master: tag each release (`git tag -a v0.x -m ...`) and never let a
   client repository become the upstream for another client.

None of these change application behaviour, and none should be done silently: making a
public repository private changes who can find it.

## Running the navigation spec locally

The browser suite needs the app served from a production build (`npm run build`
then `npm run start`), a seeded database, and the sign-in route working. Sign-in
fails closed when no shared limiter is configured, which is correct in production
but blocks every authenticated spec locally. The supported way through is the
existing CI seam:

```
CI=true GITHUB_ACTIONS=true RATE_LIMIT_CI_IN_MEMORY=true \
E2E_OWNER_EMAIL=<seeded owner> E2E_OWNER_PASSWORD=<seeded password> \
npx playwright test e2e/nav-active-state.spec.ts
```

`RATE_LIMIT_CI_IN_MEMORY` is refused outside an authorized CI-shaped environment,
so this cannot weaken a real deployment. Verified 5 November 2026: 6 passed,
1 skipped (the barber cases need `E2E_BARBER_EMAIL`/`PASSWORD`).

## Regression run: the exact environment that passes

Run against a production build (`npm run build` then `npm run start`) with the
database seeded. The browser suite signs up customers and signs in many times, so
three limits have to match what the suite does:

```
CI=true GITHUB_ACTIONS=true RATE_LIMIT_CI_IN_MEMORY=true \
RATE_LIMIT_REGISTER_MAX=60 \
E2E_OWNER_EMAIL=<seeded owner> E2E_OWNER_PASSWORD=<seeded password> \
npx playwright test
```

`RATE_LIMIT_CI_IN_MEMORY` is refused outside a CI-shaped environment, so none of
this reaches a real shop. `RATE_LIMIT_REGISTER_MAX` is an ordinary published
variable and defaults to its production value when unset.

Result, 5 November 2026: **43 passed, 1 skipped, 0 failed, 0 flaky (53s)**. The
skipped case is the barber navigation spec, which needs `E2E_BARBER_EMAIL` and
`E2E_BARBER_PASSWORD`.

### Why that mattered

The suite used to report a *flaky* invitation spec. It was never the invitation
code: the customer-signup specs exhausted the registration limiter, so the
customer the invitation spec expected did not exist, and the failure surfaced
one spec later as a sign-in timeout. The 429s are correct behaviour.

Denials of every reason are now logged with their endpoint
(`[rate-limit] denying <endpoint>: <reason>`), so the next occurrence is
attributable in one grep instead of an afternoon. The message a customer sees is
unchanged.

## Phase 7 status: what is verified, what needs a human

Verified locally, with evidence:

| Check | Command | Result |
| --- | --- | --- |
| Schema valid | `npx prisma validate` | valid |
| Env registry drift | `npm run env:drift` | 79 declared, 70 referenced, 0 drift |
| Master stays generic | `npm run client:independence` | no client-specific hardcoding |
| Architecture rules | `npm run architecture:check` | 600 files, passed |
| Unit/integration | `npm run test:ci` | exit 0 |
| Feature enforcement | `npm run test:features` | contract tests pass |
| Role matrix | `npm run test:roles` | 35 passed, 0 failed |
| Browser journeys | `npx playwright test` | 43 passed, 1 skipped |
| Production build | `npm run build` | compiled successfully |

`npm run client:preflight` correctly refuses to open registration in this
environment and names all three missing items in plain language: a session
signing secret of at least 32 characters, the public application URL, and the
rate-limit store. This is the intended behaviour, not a defect.

Still requires credentials or a decision from the owner:

1. **Upstash Redis** (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) —
   without it registration answers 503 for everyone.
2. **Neon/Postgres production URL** — migrations are recorded and none are
   unfinished, but they have only ever run against a local database.
3. **Stripe test-mode acceptance** — keys, one real test payment, one webhook
   delivery.
4. **Twilio and SMTP** — live credentials, one send each.
5. **`CSP_NONCE_ENABLED`** in staging only.
6. **`NEXTAUTH_SECRET`** of at least 32 characters for staging and production.
7. **Legal review** — Terms, Privacy Policy and cookie disclosures are drafts and
   are not represented as attorney-approved.
8. **Independent accessibility pass** — the suite covers structure, labels and
   keyboard order; it is not a substitute for a human screen-reader review.

Nothing in that list can be closed from inside the repository.

## Migration integrity: proven from empty

The migrations had only ever run against the development database, which is the
weakest possible evidence: a schema that only exists because of locally applied
drift still looks fine there. Verified on 5 November 2026 against a database
created empty for the purpose:

```
createdb barber_fresh                     # zero tables
npx prisma migrate deploy                 # all migrations applied in order
```

| Database | Public tables | Applied migrations | Unfinished |
| --- | --- | --- | --- |
| `barber_fresh` (started empty) | 67 | 57 | 0 |
| `barber_test` (development) | 67 | 57 | 0 |

Identical. The migration history alone reproduces the schema, so a new client's
database can be built by running `prisma migrate deploy` and nothing else.

### First-run onboarding on that empty database

With the app pointed at `barber_fresh` and no seed data of any kind:

```
npm run test:owner-registration
→ 28 passed, 0 failed, 28 total
```

The journey covers the redirect for a signed-out visitor, first-owner signup,
sign-in, and reaching the dashboard. So the path a brand-new shop takes, from an
empty database to a working dashboard, is exercised end to end rather than
assumed.

What this does not prove: that the same migrations succeed against the production
Neon instance, which still requires its connection string. It does not bear on
backup restoration, which is verified separately — and only against a throwaway
database. See "Backup and restore" below for exactly what has and has not been
proven.

## Session revocation: verified, not assumed

Run against the freshly migrated database:

| Suite | Result |
| --- | --- |
| `tests/session-revocation.test.ts` | 21 passed, 0 failed |
| `tests/session-security.test.ts` | 12 passed, 0 failed |
| `tests/session-devices.test.ts` | 19 passed, 0 failed |

So revoking a single device, revoking all sessions, and the device labels a
person sees are all enforced server-side. Session revocation is done.

## Backup and restore: the procedure is proven, the production setup is not

These are two different claims and this document previously ran them together.
Corrected on 2026-11-05.

### A. CI backup verification — verified

`.github/workflows/ci.yml` runs a step named **Backup and restore verification**
(around lines 165-172). It installs `postgresql-client` on the runner and executes
`npm run db:backup-verify`, which:

1. dumps `DATABASE_URL` with `pg_dump` (`--no-owner`, schema and data),
2. creates a scratch database,
3. restores the dump into it,
4. asserts the restore exposes at least ten base tables, and
5. compares row counts for `Business`, `User` and `Appointment` between source
   and restored copy.

That step passed on the current baseline. Evidence: **Template CI run
42166463819**, conclusion `success`, head `eb05d8f`, branch `main`
(https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/42166463819).

What that proves: the dump/restore procedure works, and a restore can produce a
database with the full application schema and matching row counts for the tables
that matter most.

What that does **not** prove: anything about production. The scratch database is
local to a CI runner, built from a seeded test dataset minutes earlier, on a
Postgres version that matches the runner rather than necessarily the production
provider. It is not a rehearsal of recovering a real shop's data.

### B. Production backup configuration — not done

Production still requires, and none of it exists yet:

- Automated daily database backups at the provider, with retention (the suggested
  minimum is 7 days daily plus 4 weeks weekly — see `docs/OPERATIONS.md`).
- Backup configuration for uploaded media, which lives outside the database and
  is therefore not covered by any database backup.
- An off-site copy, so a provider incident cannot take the backups with the
  primary.
- One real restoration of a production backup, timed and recorded, confirming a
  person can actually sign in to the restored shop afterwards.
- A written recovery procedure with names against each step, and the restore
  attempt recorded in it.

**Production disaster recovery is not complete and this template is not
protected against data loss today.** Run `npm run db:backup-verify` against a
staging copy of production data as the first real rehearsal, before the first
paying client.

## Database-level RLS: off by design, not by mistake

`npm run db:rls-status` reports 0/51 tables protected. That is the documented
state, not a regression: RLS requires a dedicated runtime role and a
per-transaction `app.business_id` setting. Enabling it while the app connects as
the table owner would either be silently bypassed or break every query. The
enforced isolation boundary is the application layer, covered by the cross-tenant
IDOR matrix and the role matrix.


---

## Reconciliation note — 2026-11-05 (commit 4105997)

This document mixes reports written at different points in the project. To keep the
audit trail without letting old claims read as current ones:

- Statements below that describe the dashboard as a technical console, or that count
  enforced features as a single digit, are **historical**. The current counts and the
  enforcement contract live at the top of `docs/FEATURES.md` and are produced by
  `npm run audit:features`, not by hand.
- **Staging acceptance has not happened.** No deployment has been made against real
  Upstash, Neon, Stripe, Twilio or SMTP credentials. Local suites, a local production
  build and a local database are all that has been exercised. Nothing in this
  repository should be read as evidence of a live integration test.
- **No human accessibility review has taken place.** There are automated checks
  (`npm run test:a11y`, axe-based, plus the responsive width suite), and they are not
  the same thing as a person using a screen reader. That gap stays open and named.
- A feature is not production-ready because a source file for it exists. The audit
  proves a server file consults the key; it does not prove the provider behind it
  works, and it does not stand in for an end-to-end test with real credentials.
