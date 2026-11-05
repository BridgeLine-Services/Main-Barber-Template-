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

`src/lib/env-registry.ts` is the single contract: 52 variables, fifteen categories,
required-at-build vs required-at-runtime, conditional requirements per feature, aliases
and fallbacks, format validation, and a redaction helper. `.env.example` is generated
from it (`npm run env:template`) and now documents 52 variables instead of 32.

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

No amount of further code closes these; each needs a credential, a machine, or a person.

## 5. Test evidence

Verified locally and/or in CI: registration route 23, environment registry 51, booking
concurrency 13, timezone/DST 18, optional integrations 20. The full chain runs 40
suites via `npm run test:all`.

## 6. Readiness

Roughly 82% of a commercial launch, with every remaining point attributable to the six
rows above rather than to unfinished code. This is not 100% and should not be described
as production-ready until the live deployment registers a first owner and the provider
acceptances have actually run.
