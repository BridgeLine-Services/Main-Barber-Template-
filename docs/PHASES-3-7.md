# Phases 3–7: what each one delivered, and the evidence

Each phase is recorded with the command that proves it and the result observed on
5 November 2026. Where a phase is not finished, the reason is stated instead of
the phase being marked done.

## Feature toggles: 20 of 20 enforced, 20 of 20 contracted

`npm run audit:features` reports every key consulted by server code:

```
20 of 20 feature keys are consulted by server code.
```

Consultation is the weaker half of the claim, so `tests/feature-enforcement.test.ts`
also asserts, per key, that a specific server file still references it next to a
gate (`assertFeatureEnabled` / `isFeatureEnabled`). That contract previously
covered 18 keys and silently omitted `emailNotifications` and `reviewRequests`,
which meant a later refactor could have dropped either guard unnoticed. Both are
now in the list.

```
Feature enforcement: 27 passed, 0 failed
```

The gate sites behind those two: `src/lib/notification-worker.ts` builds its
per-channel allow flags from `smsNotifications` and `emailNotifications`, so a
disabled channel never reaches a provider; `src/lib/review-requests.ts` filters
candidate businesses by `reviewRequests` at four points, including the send path.

Enforcement is server-side. `onlineBooking` is additionally checked before any
slot is offered, so a disabled booking page cannot be bypassed with a direct POST.

## Phase 3 — registration repair

Delivered: one shared limiter answer (`buildRateLimitDenial`) so a used-up window
returns 429 and an unreachable store returns 503, with plain-language text either
way; no route invents its own wording; the register route no longer reports a
missing Redis as rate limiting.

Evidence: `npm run test:owner-registration` → 28 passed, 0 failed, run against an
empty database. Denials are now logged with their endpoint
(`[rate-limit] denying <endpoint>: <reason>`), which is how the flaky invitation
spec was traced to the registration limiter rather than to invitation code.

## Phase 4 — environment automation

Delivered: a single registry of every variable, a drift check, a doctor, and
generated template.

Evidence: `npm run env:drift` → 79 declared, 70 referenced, 0 drift across 545
files. `npm run env:check` and `npm run env:doctor` run without secrets leaving
the process; the deep probe refuses invalid provider credentials rather than
reporting them as healthy.

## Phase 5 — deployment simplification

Delivered: a preflight that refuses to open registration while the store, public
URL or signing secret is missing or too weak, each named in plain language; a
build script that aborts on a half-applied migration and on demo mode; a factory
launch gate that keeps migration status manual and domain ownership a human step.

Evidence: `npm run test:factory-launch` → 10 passed, 0 failed. `npm run
client:preflight` correctly refuses in a local environment and lists the three
missing items. `npm run client:independence` now reports the template stays
generic; it had been failing on vendor API hosts and was therefore easy to ignore.

## Phase 6 — booking and accessibility specs

Evidence: `npm run test:booking` → 20 passed, 0 failed (double-booking under
contention, retry on serialization failure, exclusion-constraint errors mapped to
a plain message, deposits, cancellations, timezone handling).

`npx playwright test e2e/accessibility.spec.ts` → 8 passed: axe scans with zero
WCAG A/AA violations on staff login, the dashboard home, and the Security and
Branding settings tabs, plus a keyboard-only pass over the booking page.

Limitation: automated axe and keyboard order are not a screen-reader review.

## Phase 7 — staging acceptance

Finished piece: migrations reproduce the schema from empty (67 tables, 57
migrations, 0 unfinished, identical to the development database), and a
brand-new database can onboard its first owner (`test:owner-registration` 28/28).

Full browser suite: 43 passed, 1 skipped, 0 failed, 0 flaky.

Not finished, and not finishable from the repository: staging itself needs the
Upstash pair, a Neon connection string, Stripe test keys, Twilio and SMTP
credentials, and a 32+ character signing secret. Until those exist, acceptance
against a real staging deployment cannot be claimed.
