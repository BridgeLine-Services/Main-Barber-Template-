# Final Acceptance Baseline — Barber Template

**Date:** 2026-10-30
**Repository:** BridgeLine-Services/Main-Barber-Template-
**Branch:** main
**Commit audited:** `21381be` (latest on main at time of audit)
**Audit type:** verified baseline + inventory. This document records evidence;
it does not assert completion of work that has not been performed.

---

## 1. Engineering baseline (executed this audit)

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **0 errors** |
| Lint | `npx eslint .` | **0 errors, 82 warnings** (pre-existing style-class warnings; not suppressed) |
| Production build | `npx next build` (production env) | **success** (`Compiled successfully`) |
| GitHub CI (last verified commit) | Template CI + Architecture Constitution on `21381be` | **both green** |
| Publish/permission tests | `npx tsx tests/website-publish.test.ts` | **21/21 pass** |
| Barber navigation (browser, local, real BARBER fixture) | scripted Playwright check | **34/34 pass** |
| Branding & Theme (browser, local) | scripted Playwright check | **11/11 pass** |
| Owner navigation e2e | `e2e/nav-active-state.spec.ts` | **6/6 pass** (barber block skipped: no CI barber credentials) |
| Production reachability | anonymous HTTP against main-template-two.vercel.app | homepage 200, preview route 307 with `x-frame-options: SAMEORIGIN`, homepage `DENY`; **11/11 anonymous smoke checks pass, 0 console errors** |

### Known warnings
82 ESLint warnings remain (0 errors). They are pre-existing style/lint-rule
warnings across the codebase, not failures. They are recorded here rather than
suppressed so the count is not misreported as zero.

---

## 2. Prompt-versus-repository discrepancies (source of truth = the repo)

Several files named in the implementation prompt **do not exist** in this
repository at `21381be`. They must not be edited as if they did:

| Referenced path | Reality |
|---|---|
| `src/lib/email-marketing.ts` | **missing** |
| `src/app/unsubscribe/route.ts` | **missing** — no file in `src/` or `prisma/` contains the string `unsubscribe` |
| `src/app/api/webhooks/twilio/route.ts` | **missing at that path** |
| `src/lib/payments.ts` | different layout: `src/lib/payments/pos.ts` exists |
| `docs/LEGAL-REVIEW-PACKET.md` | **missing** |
| `docs/RELEASE-AUDIT.md` | **missing** |

Present and relevant: `src/app/api/webhooks/stripe/route.ts`,
`src/lib/memberships.ts`, `src/lib/notifications.ts`, `src/lib/security.ts`,
`src/lib/theme.ts`, `src/app/api/test/e2e-booking/route.ts`,
`src/app/(customer)/accessibility/page.tsx`, `e2e/accessibility.spec.ts`,
`e2e/security.spec.ts`, `docs/LEGAL-PLACEHOLDERS.md`, `docs/TENANT-ISOLATION.md`.

**Consequence:** the prompt's Phase 4B requirement ("remove the development-only
fallback signing secret in `src/lib/email-marketing.ts`") cannot be applied to a
file that does not exist here. Email-marketing / unsubscribe must first be
located (or confirmed absent) before that requirement can be classified. This is
recorded as an open item, not silently marked done.

---

## 3. Inventory by phase

| Phase | Status | Evidence / gap |
|---|---|---|
| 0. Inspect & baseline | **Complete** | This document; gates above |
| 1. Non-technical usability | **Partial** | Sidebar hierarchy, plain-language settings titles, Branding & Theme rewrite, honest publish messaging, empty/error states exist in the areas reviewed. Full screen-by-screen wording audit across all dashboard screens **not performed** |
| 2. Onboarding | **Not verified this audit** | Onboarding wizard exists; interruption/resume/validation/network-failure test coverage **not re-run** |
| 3. Stripe reliability | **Not verified this audit** | Webhook route and membership code exist; duplicate/concurrent/retry scenarios **not re-run** |
| 4. SMS consent & email unsubscribe | **Blocked / partial** | Consent fields and opt-out logic exist in `marketing.ts`, `notifications.ts`, `notification-worker.ts`, `rebooking-engine.ts`, `recurring.ts`; the email-unsubscribe subsystem described in the prompt **does not exist** (see §2) |
| 5. Owner 2FA | **Not implemented** | `src/lib/security.ts` helpers exist; no integrated enrollment/verification/recovery flow found |
| 6. Security & theme hardening | **Partial** | Same-origin framing exception scoped to the preview route only (verified in production); CSP still uses `unsafe-inline`; nonce/hash migration **not attempted** (risk to dynamic theming) |
| 7. Accessibility | **Not verified this audit** | `e2e/accessibility.spec.ts` and the accessibility page exist; suite **not re-run**; no independent review |
| 8. Dependencies / DB / ops | **Not verified this audit** | Prisma validate, migration ordering, backup/restore **not re-run**; no `docs/RELEASE-AUDIT.md` to compare against |
| 9. Legal documentation | **Blocked (external)** | `docs/LEGAL-PLACEHOLDERS.md` present; attorney approval **outstanding** and cannot be produced by engineering |
| 10. Regression suite | **Partial** | Suites listed in §1 executed and passing; the full `test:ci` matrix was last verified green in CI on `21381be`, not re-run locally in this audit |
| 11. Final acceptance | **Not achieved** | Counters below are deliberately non-zero |

---

## 4. Honest counters

- Engineering tasks remaining: **not zero** (phases 2, 3, 5, 7, 8 unverified; 4 blocked by missing subsystem; 6 partial)
- Required regression tests remaining: **not zero** (full matrix not re-run this audit)
- Known unresolved engineering defects: **none newly identified in the areas verified** (all executed checks passed)
- Required staging acceptance tasks remaining: **not zero** (Stripe test-mode, Twilio staging, email delivery, backup restore)
- Required external approvals remaining: **not zero** (legal review, accessibility review, release approval)
- Production release blockers remaining: **not zero**

---

## 5. Verified-safe areas (regression evidence)

Navigation (owner + barber, active states, legacy tab URLs, mobile), Branding &
Theme save/publish, draft-versus-published isolation, publication permissions
(OWNER-only publish; OWNER + BUSINESS_ADMIN settings save), preview framing,
public homepage and `/book` on production, and the customer navbar at
768–1440 px. No route URL, role check, database field, preset definition, font
mapping, snapshot field, or booking rule was changed in the verified work.

---

## 6. Recommended next steps (in order)

1. Locate or confirm the absence of the email-marketing/unsubscribe subsystem
   and the Twilio webhook route; classify Phase 4 accordingly.
2. Re-run the full `test:ci` and accessibility suites locally against a test
   database and record results here.
3. Re-verify Stripe webhook idempotency/recovery and onboarding resume tests.
4. Implement owner 2FA end-to-end (enrollment, verification, recovery codes,
   audit) before any mandatory-2FA decision.
5. Evaluate CSP nonce adoption behind a feature flag, with theme regression
   coverage.
6. Obtain legal review and accessibility review; only then update the external
   acceptance counters.
