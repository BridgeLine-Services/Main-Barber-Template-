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
