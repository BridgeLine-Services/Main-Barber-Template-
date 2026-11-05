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

---

## 6. Inbound SMS consent: START is not marketing consent

**File:** `src/app/api/webhooks/twilio/route.ts`

**Problem.** STOP correctly cleared both consent categories. START set
`smsConsent: true` **and** `marketingSmsConsent: true`, and wrote a MARKETING
consent record claiming the customer had agreed to marketing. Someone replying
START to get their appointment reminders back was silently opted in to
promotional texts — the kind of thing that turns into a TCPA complaint, since
marketing consent has to be given knowingly.

**Change.** START now restores transactional consent only and leaves marketing
exactly as it was: if the customer had opted in before, that stands; if STOP
revoked it, it stays revoked until they opt in again. The consent log records
only the category that actually changed, so there is no MARKETING row asserting
consent nobody gave. The reply says so in plain words: "You will get appointment
messages again. Marketing texts stay off unless you opt in at the shop or in your
account."

**Why it matters downstream:** `src/lib/marketing.ts` only queues a marketing SMS
when `marketingSmsConsent === true`, so the flag this route writes is the flag
that decides whether someone is texted a promotion.

**Tests:** `tests/twilio-consent.test.ts` (17) — unsigned webhook rejected, STOP
clearing both categories with two WITHDRAWN records, duplicate delivery not
duplicating records, START restoring transactional only with a single
TRANSACTIONAL RE_GRANTED record and no MARKETING record, the reply wording, and
a customer with pre-existing marketing consent keeping it.

---

## 7. Client copies no longer ship internal test material

**File:** `scripts/prepare-client-copy.sh`

**Problem found by running it.** I built a real client copy (fresh clone, client
branch, `--apply`) and scanned it. The copy still contained `tests/`, `e2e/`,
`playwright.config.ts` and `.github/` — and four files in it carried the QA owner
password `E2eOwner!Passw0rd`: three E2E specs and the CI workflow. None of that
belongs in a shop's checkout, and a customer reading their own repository should
not find internal QA accounts in it.

**Change.** New `--strip-tests` mode removes `tests/`, `e2e/`,
`playwright.config.ts`, `test-results/`, `playwright-report/` and `.github/`, then
drops the `package.json` scripts that pointed at them, so the client machine never
has a script whose file is missing. Default behaviour is unchanged, and the master
repository keeps every suite.

**Verified on a real clone:** after `--strip-tests`, no occurrence of the QA
password anywhere in the copy, no `tests/`, `e2e/` or `.github/` directories, no
remaining script referencing a removed path, and `package.json` still parses.

---

## 8. Email opt-out is now proven, not assumed

**Files:** `tests/email-optout.test.ts`, `docs/TESTING.md`

The unsubscribe plumbing was already built (signed 180-day tokens, `GET`
previews and only `POST` changes, RFC 8058 one-click support, fail-closed
signing key, postal address required before a campaign can send). What it had was
**no test coverage at all** — `tests/marketing.test.ts` never mentioned
unsubscribe or the postal address. For a feature whose failure mode is a
complaint to a regulator, "it looks right" is not a standard of evidence.

19 assertions now hold the chain down:

- a valid link shows a confirmation page and changes nothing (mail scanners fetch
  every URL in a message, so a state-changing GET unsubscribes people who never
  clicked)
- clicking it sets the opt-out; clicking twice is harmless
- a tampered signature and an expired token are both refused with nothing changed
- a correctly signed token whose payload pairs our business with another shop's
  customer touches nothing, because the update is scoped to both ids
- a customer who opted out, or just unsubscribed, is skipped when a campaign is
  queued, while a still-subscribed customer in the same audience is queued once
- every queued marketing email carries the unsubscribe link and the full postal
  address
- a business with no postal address is refused outright and queues nothing
- a booking confirmation is still queued for an opted-out customer, which is what
  the unsubscribe page promises them

One thing worth recording for whoever reads the schema next: the comment on
`Customer.emailOptOut` says "respected by ALL email sends", but the only senders
that honour it are marketing mail (`src/lib/marketing.ts`,
`src/lib/notification-worker.ts` for `MARKETING_CAMPAIGN`) and review requests
(`src/lib/review-requests.ts`). Appointment email is deliberately unaffected. I
left the schema comment alone rather than touch the migration baseline for a
comment, but the contract is documented here and in the new suite.

---

## 9. Swept for predictable signing keys and found one more

After fixing the 2FA encryption fallback earlier in this cycle I grepped every
`process.env.SOMETHING || 'literal'` in `src/` rather than trusting that the fix
covered the class. One remained: the Google Business OAuth state key
(`src/lib/google-business.ts`) fell back to the fixed string
`development-only-oauth-state-secret` in any environment.

**Why it matters.** The state parameter is what stops a callback being replayed
into another session. With a key that is published in the source, an attacker can
mint a valid state for any user/business pair and complete a connection flow they
did not start, binding their own Google Business Profile to a shop that never
consented to it.

**Change.** Production now fails closed: with no `NEXTAUTH_SECRET` (or
`CRON_SECRET`) configured, the key is not produced at all. Minting throws so the
connection is refused with a clear configuration error; verification returns
false rather than crash a page. Development keeps the convenience fallback.

**Tests:** `tests/oauth-state-signing.test.ts` (9) — round trip, wrong user,
wrong business, garbage, empty, modified signature, re-signed-looking payload,
eleven-minute-old state, and a state signed with the public development key
rejected even though one is never used in a configured deployment.

---

## 10. The rate limiter could be told its own key

**Files:** `src/lib/rate-limit.ts`, `tests/rate-limit-outcomes.test.ts`,
`tests/rate-limit-ip.test.ts`, `.github/workflows/ci.yml`

**Problem.** `getClientIP()` read `x-real-ip` unconditionally. On Vercel that
header is written by the platform and is trustworthy. Anywhere else it is an
ordinary request header the caller controls, so anyone could send a different
value per attempt and receive a **fresh rate-limit bucket each time** — which
turns "three registrations per minute" into no limit at all. The directive asked
for exactly this (`5.1`/`2.1 C`: do not trust forwarded headers outside a trusted
proxy), and the old unit test asserted the insecure behaviour as correct.

**Change.** Trust is now explicit: `VERCEL === '1'`, or `RATE_LIMIT_TRUST_PROXY
=== 'true'` for a self-hosted deployment behind its own proxy. With neither set,
forwarding headers are ignored and the caller lands in the shared `unknown`
bucket. That direction is deliberate — unidentifiable callers get *fewer* chances,
never more.

**Second defect, found by the tests.** `isValidAddress()` was a character
allowlist (`^[0-9a-fA-F:.]+$`), so `999.999.999.999` passed as an address. It now
uses Node's `isIP()`, which accepts real IPv4 and IPv6 only.

**Behaviour left alone:** `unknown` is still one shared bucket rather than one per
visitor. Handing each unidentified caller their own bucket would be the bypass
this change closes.

**Tests:** `tests/rate-limit-ip.test.ts` (19) — headers ignored with no proxy
trusted, honoured on Vercel, closest hop chosen, IPv6 reported as-is, garbage,
empty, whitespace, oversized and out-of-range values rejected, bad primary with a
good fallback still resolving, the opt-in requiring exactly `true`, and two
unidentifiable callers sharing one bucket. `tests/rate-limit-outcomes.test.ts`
updated: it previously asserted that a bare `x-real-ip` is used, which was the
vulnerability; it now asserts both the ignored case and the trusting case (23
passing). CI's e2e job sets `RATE_LIMIT_TRUST_PROXY=true` because four suites act
as several visitors by sending those headers.

**Verification gap, stated plainly:** the HTTP suites that exercise this through a
running server (`customer-password-reset`, `staff-invitations`) could not be
verified against my ad-hoc local server — I started it with `APP_MODE=demo`, which
does not return development reset links. CI runs them with the job configuration
below and is the gate that counts here.

---

## 11. A crashed Stripe delivery lost the event permanently

**Files:** `src/app/api/webhooks/stripe/route.ts`,
`tests/stripe-event-claim.test.ts`

**Problem.** Every Stripe delivery claims its event by inserting a row with status
`PROCESSING`, and any later delivery of the same event id is answered with **409
"already processing"**. That is right for a genuine concurrent delivery and wrong
for a crash: if the process dies between the claim and the completion, nothing
moves the row on, so every one of Stripe's retries (three days of them) gets 409
and the payment, membership, gift card or order is never applied. The claim was a
lock with no expiry.

**Change.** `PROCESSING` is now a lease. A claim older than five minutes can be
taken over, and the takeover is an `updateMany` conditional on the row still being
older than that, so two retries racing each other cannot both win. This is safe
because every handler downstream is already idempotent or transition-guarded,
which was proven separately.

**Second defect, found while testing the first.** Events the route deliberately
ignores (not ours, or no `paymentId` in metadata) returned 200 but left their row
in `PROCESSING` forever — finished work reported as in-flight. They are now settled
to `COMPLETED`.

**Tests:** `tests/stripe-event-claim.test.ts` (13) drives the real route with real
HMAC signatures: a fresh claim is refused with 409 and left untouched, a ten-minute
old claim is taken over and completed, four minutes is still in flight, six minutes
is takeover-able, `FAILED` is reclaimable at any age, a completed duplicate is
acknowledged as a duplicate, and unsigned or forged deliveries are refused without
creating a row. `tests/payments.test.ts` still passes 70/70.

**Not covered, and I will not pretend otherwise:** this is not Stripe test-mode
acceptance. It proves the claim logic and the signature gate; it does not prove a
real renewal invoice, a real refund, or a real gift-card purchase settles
correctly. That still needs test-mode credentials and events from Stripe itself.
