# Engineering cycle report — 2026-11-04

Scope: the findings this cycle acted on, what was verified, and what is
deliberately still open. Every claim below has a repository artifact or a CI run
behind it. Nothing here asserts provider acceptance, legal approval or a
production release.

---

## 1. Change report

### 1.1 Rate limiting no longer reports outages as user error

**Files:** `src/lib/rate-limit.ts`, 13 API routes, `src/app/login/LoginForm.tsx`

**Problem.** With no Upstash credentials configured, every rate-limited request
returned `429 "Too many attempts. Please wait a minute and try again."` The
limiter was failing closed (correct) but reporting the reason as a rate-limit
violation (incorrect). Owners retried indefinitely; the sign-in form told them
their password was wrong; operators saw no signal that configuration was missing.

**Change.** `RateLimitResult` now carries `reason: 'ok' | 'exceeded' |
'store_unavailable' | 'store_not_configured'`. `buildRateLimitDenial()` maps a
genuine limit to **429** and an unusable store to **503**, always with a
`Retry-After` header. All 13 reply sites use `rateLimitResponse()`, so no route
can flatten a 503 back into a hardcoded 429. The sign-in form detects the 503 and
says the password has not changed.

**Compatibility risk:** low. The API shape is additive; `checkRateLimit` still
returns `null` when allowed. Status codes change only in the outage case, which
previously lied.

**Tests:** `tests/rate-limit-outcomes.test.ts` (22).

### 1.2 Unsubscribe links can no longer be triggered by scanners

**Files:** `src/app/unsubscribe/route.ts`

**Problem.** `GET /unsubscribe?token=…` set `emailOptOut = true`. Mail gateways
and chat link previews fetch every URL in a message, so customers were being
opted out with no human click, and the business saw campaigns silently stop.

**Change.** GET renders a confirmation page and changes nothing. POST performs
the change and doubles as the RFC 8058 one-click endpoint (form body or bare POST
with the token in the query). Tokens, wording and existing links are preserved;
the page states that appointment reminders are unaffected.

**Compatibility risk:** very low. Existing links still resolve; a human now needs
one click. Recording is unchanged.

**Tests:** `tests/unsubscribe-flow.test.ts` (14).

### 1.3 Stripe webhook follow-ups fail loudly and atomically

**Files:** `src/app/api/webhooks/stripe/route.ts`

**Problem.** Three branches caught a failure, logged it, and carried on to mark
the event `COMPLETED`, so Stripe never retried. The refund branch was the
dangerous one: the payment row was updated to `REFUNDED` **before** the
commission/gift-card adjustment, so a failure left commissions paid on refunded
money, and a retry could never repair it because `canTransition(status, target)`
is false once the row is already `REFUNDED`.

**Change.** Order-failure and order-cancellation branches rethrow (their guards
accept an already-`FAILED`/`CANCELED` payment, so retries re-enter safely). The
refund path updates the payment, adjusts commissions and adjusts the gift-card
balance inside **one transaction**, so a failure unwinds everything and the retry
redoes it.

**Compatibility risk:** low. Idempotency guards are unchanged; only the failure
path behaviour changed, from silent and permanent to retryable.

**Tests:** `payment-transitions` 51/51, `payments` 70/70, `ecommerce` 34/34,
`commissions` 74/74, `gift-cards` 85/85.

### 1.4 Launch readiness now blocks on a broken sign-in store

**Files:** `src/lib/rate-limit.ts`, `src/lib/factory-launch.ts`

**Change.** `checkRateLimitStoreHealth()` distinguishes *not configured* (a form
to fill in) from *unreachable* (an outage) using a `PING` that never spends a
caller's allowance. `verifyFactoryLaunch` gains a required, secret-bearing
`rate-limit-store` check that is `BLOCKED` unless the store answers, with
remediation naming the exact variables. Readiness can no longer report `READY`
while authentication is impossible.

**Tests:** `tests/rate-limit-store-health.test.ts` (9).

### 1.5 Dependency advisories

**Files:** `package.json`, `package-lock.json`, `docs/RELEASE-AUDIT.md`

`nodemailer` 10.0.12 → 10.3.1 (addressparser advisory reachable through
addresses we pass in) and `zod` 4.4.3 → 4.6.7 (memory exhaustion on oversized
constrained collections). Four `@vercel/blob` → `@vercel/oidc` →
`@vercel/cli-config` advisories remain; npm's only fix is a **downgrade** of the
blob client, which would put the upload pipeline on an older client to satisfy a
build-time config parser. Recorded as accepted risk with a named condition for
revisit.

**Verified after upgrade:** `tsc` clean, `next build` clean, `test:ci` green,
`notification-resilience` 16/16 (real SMTP path), `marketing` 44/44.

### 1.6 Previously delivered in this cycle (for completeness)

- Session revocation — "sign out everywhere" with a server-enforced cutoff
  (`tests/session-revocation` 21).
- Per-deployment `REQUIRE_OWNER_2FA` policy that routes to enrolment and cannot
  lock an owner out (`tests/security-policy` 16).
- CSP nonce mode behind `CSP_NONCE_ENABLED`, verified with 26 chunks loaded and
  0 refused scripts, default off.
- Backup/restore verification enforced in CI, which immediately caught a real
  cross-version restore bug (PG17 dump into a PG15 server).
- Dashboard accessibility scans (7 surfaces) that found and fixed 6 unlabelled
  colour inputs and an unnamed icon-only button.
- Full `test:all` chain enforced on every push.

---

## 2. Security report (current state)

| Area | State | Evidence |
| --- | --- | --- |
| Authentication | Credentials + optional TOTP; second factor enforced in the jwt callback, not the UI | `two-factor*` suites 118 assertions |
| Authorization | Every dashboard API re-resolves the user and role per request; nav is not a boundary | `role-permissions` 37, `business-admin-role` 37, `coowner-permissions` 35 |
| Tenant isolation | `businessId` on every scoped query; cross-tenant matrix covered | `tenant-isolation` 22, `cross-tenant-matrix` 75 |
| Session security | Password-change invalidation + explicit revocation cutoff; deleted accounts cannot keep a session | `session-security`, `session-revocation` 21 |
| Rate limiting | Upstash distributed limiter; failures are honest 503s; store health surfaced in readiness | `rate-limit-outcomes` 22 |
| Payment security | Signature verification, event state machine, transactional follow-ups | `payment-transitions` 51 |
| Uploads | MIME + magic-byte + size + SVG sanitisation, tenant-scoped | `file-validation`, `image-roles` |
| Headers / CSP | `frame-ancestors none` (self only for the preview route), no third-party script hosts, nonce path ready | `csp` 25 |
| Secrets management | Limiter, unsubscribe and 2FA keys all fail closed in production; no secret is printed to logs or UI | `unsubscribe-token` 18, `rate-limit-store-health` 9 |

**Remaining security risks:** `@vercel/blob` transitive advisories (accepted, see
§1.5); no device-level session list (revocation is all-or-nothing by design); no
staging verification of the CSP nonce path yet.

---

## 3. Test report

Run in this sandbox, PostgreSQL 15 on localhost, production build.

| Command | Result |
| --- | --- |
| `npm run architecture:check` | pass (582 files) |
| `npm run lint` | 0 errors, 85 pre-existing warnings |
| `npm run typecheck` | clean |
| `npx prisma validate` | valid |
| `next build` | clean |
| `npm run test:ci` | exit 0, 43 suites |
| `npm run test:all` | exit 0, 29 suites |
| Targeted: payment/ecommerce/commission/gift-card/notification/marketing/session/security-policy/CSP/rate-limit/unsubscribe | all green (counts above) |
| `npm audit --omit=dev` | 4 high remaining, all traced and accepted |
| `db:backup-verify` | **not runnable here** (no `pg_dump`); enforced in CI instead |
| Stripe / Twilio / SMTP live acceptance | **not run** — no credentials |
| Vercel staging deployment | **not run** — no access |
| Independent accessibility review | **not done** — human review outstanding |

CI on `main`: `Template CI` and `Architecture Constitution` green on `89f5813`
and `1dd0f8d`.

---

## 4. What a shop owner experiences

Create account → land in the dashboard → onboarding wizard (shop details,
branding, services, team, schedules, booking rules, review) → publish → take
bookings. Progress is saved server-side, so leaving halfway and returning
resumes. Errors are sentences, not codes; the two places that previously lied
(misleading "too many attempts" and "invalid password" during an outage) now say
what is actually happening.

**Still requires the operator, not the owner:** Upstash/database/Stripe/Twilio/
SMTP credentials, the Vercel deployment, migrations, domain connection, and the
`REQUIRE_OWNER_2FA` / `CSP_NONCE_ENABLED` policy decisions.

---

## 5. Remaining work

**Engineering**

1. Empty/loading/error state sweep across remaining dashboard tabs (targeted work
   done; no repo-wide audit).
2. ~~Device-level session listing~~ — done: `UserSession` registry, list + single
   revoke, enforced in the jwt callback (`tests/session-devices` 19).
3. CSP nonce rollout on a staging deployment.

**External**

4. Stripe test-mode acceptance; Twilio and SMTP delivery acceptance.
5. Legal review of `docs/LEGAL-REVIEW-PACKET.md` (correctly marked DRAFT).
6. Independent accessibility review; release sign-off.
7. `@vercel/blob` advisory cleared upstream.

**Not claimed:** commercial readiness, legal compliance, accessibility
compliance, or live payment/notification reliability.
