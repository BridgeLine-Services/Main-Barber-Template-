# Regression evidence

Generated 2026-11-18 05:41:47 UTC by `scripts/regression-evidence.mjs`.

Every line below is a suite that actually ran in this checkout. The summary is the
suite's own closing line, so a passing suite that printed nothing useful shows no
summary rather than an invented one. Nothing here is copied from an earlier report.

- Suites run: **106**
- Passed: **82**
- Failed: **24**

## Suites

| Suite | Result | Summary | Time |
| --- | --- | --- | --- |
| `tests/alerts.test.ts` | pass | [alert] info backup_failed_recovered recovery-of=backup_failed delivered=true | 0.7s |
| `tests/appearance-reset.test.ts` | pass | 33 passed, 0 failed | 0.6s |
| `tests/architecture.test.ts` | pass | Architecture tests passed: external tenant data, booking settings, and deployment values are represented. | 0.6s |
| `tests/audit-log.test.ts` | pass | Audit log tests: 15 passed, 0 failed | 1.5s |
| `tests/backup-archive.test.ts` | pass | Archive tests: 23 passed, 0 failed | 0.3s |
| `tests/backup-failure-modes.test.ts` | fail (exit 1) | Backup failure-mode tests: 19 passed, 3 failed | 11.0s |
| `tests/backup-offsite.test.ts` | pass | [alert] info backup_failed_recovered recovery-of=backup_failed delivered=false | 0.5s |
| `tests/backup-safety.test.ts` | pass | Backup safety tests: 56 passed, 0 failed | 0.7s |
| `tests/barber-mode.test.ts` | pass | Barber Mode tests: 23 passed, 0 failed | 0.4s |
| `tests/booking-concurrency.test.ts` | pass | Booking concurrency: 13 passed, 0 failed | 2.2s |
| `tests/booking-rules.test.ts` | pass | Booking rules tests: 25 passed, 0 failed | 2.3s |
| `tests/booking.test.ts` | pass | Results: 20 passed, 0 failed | 1.4s |
| `tests/brand-assistant.test.ts` | pass | Brand and identity tests: 92 passed, 0 failed | 0.4s |
| `tests/business-admin-role.test.ts` | fail (exit 1) | at process.processTicksAndRejections (node:internal/process/task_queues:104:5) | 1.3s |
| `tests/business-deactivation.test.ts` | fail (exit 1) | Business deactivation tests: 2 passed, 14 failed | 1.4s |
| `tests/calendar-export.test.ts` | pass | Calendar export tests: 76 passed, 0 failed | 0.4s |
| `tests/cancellation-fill.test.ts` | pass | 22 passed, 0 failed | 0.9s |
| `tests/commissions.test.ts` | pass | 74 passed, 0 failed | 1.4s |
| `tests/coowner-permissions.test.ts` | fail (exit 1) | ❌ owner invites a co-owner (got 401) | 1.0s |
| `tests/cross-tenant-matrix.test.ts` | fail (exit 1) | Cross-tenant matrix: 74 passed, 1 failed | 2.6s |
| `tests/csp.test.ts` | pass | CSP tests: 25 passed, 0 failed | 0.2s |
| `tests/customer-auth-security.test.ts` | fail (exit 1) | ❌ appointment attached to the ACCOUNT email, not the submitted email (got undefined) | 1.8s |
| `tests/customer-data-lifecycle.test.ts` | fail (exit 1) | Customer data lifecycle tests: 16 passed, 17 failed | 1.7s |
| `tests/customer-history.test.ts` | pass | 29 passed, 0 failed | 0.2s |
| `tests/customer-password-reset.test.ts` | fail (exit 1) | ❌ dev mode returns the reset link for the customer account | 1.0s |
| `tests/daily-operations.test.ts` | pass | 21 passed, 0 failed | 0.7s |
| `tests/db-url-aliases.test.ts` | pass | ✅ POSTGRES_URL is declared | 0.2s |
| `tests/deploy-safety.test.ts` | pass | Deployment safety tests: 25 passed, 0 failed | 1.4s |
| `tests/ecommerce.test.ts` | pass | 📊 Ecommerce: 34 passed, 0 failed, 34 total | 1.3s |
| `tests/email-optout.test.ts` | pass | Email opt-out tests: 19 passed, 0 failed | 1.2s |
| `tests/env-enum-contract.test.ts` | pass | ENV enum contract: 22 passed, 0 failed | 6.0s |
| `tests/env-registry.test.ts` | pass | Environment registry: 54 passed, 0 failed | 0.6s |
| `tests/factory-launch.test.ts` | pass | Factory launch tests: 10 passed, 0 failed | 0.9s |
| `tests/factory-readiness.test.ts` | pass | Factory readiness tests: 21 passed, 0 failed | 0.6s |
| `tests/failure-simulation.test.ts` | pass | Failure simulation tests: 24 passed, 0 failed | 1.3s |
| `tests/feature-enforcement.test.ts` | pass | Feature enforcement: 27 passed, 0 failed | 0.9s |
| `tests/feature-flags.test.ts` | fail (exit 1) | Feature flag tests: 14 passed, 1 failed | 0.7s |
| `tests/file-validation.test.ts` | pass | file-validation: 57 passed, 0 failed | 0.3s |
| `tests/font-url-guard.test.ts` | pass | Results: 14 passed, 0 failed | 0.5s |
| `tests/fonts.test.ts` | pass | Fonts tests: 29 passed, 0 failed | 0.4s |
| `tests/gift-cards.test.ts` | pass | 📊 Gift card tests: 85 passed, 0 failed, 85 total | 1.8s |
| `tests/guest-booking-journey.test.ts` | fail (exit 1) | Guest journey tests: 9 passed, 23 failed | 1.4s |
| `tests/health-readiness.test.ts` | pass | Health and readiness tests: 23 passed, 0 failed | 0.8s |
| `tests/home-modules.test.ts` | pass | ✅ All 50 home-modules tests passed | 0.5s |
| `tests/image-roles.test.ts` | pass | 35 passed, 0 failed | 0.2s |
| `tests/marketing.test.ts` | pass | Marketing audience tests: 44 passed, 0 failed | 0.5s |
| `tests/media-backup.test.ts` | pass | Media backup tests: 21 passed, 0 failed | 1.2s |
| `tests/memberships-renewals.test.ts` | pass | 📊 Memberships renewals: 30 passed, 0 failed, 30 total | 0.9s |
| `tests/memberships.test.ts` | pass | 📊 Memberships: 31 passed, 0 failed, 31 total | 1.1s |
| `tests/notification-resilience.test.ts` | fail (exit 1) | Notification resilience tests: 11 passed, 5 failed | 1.1s |
| `tests/oauth-state-signing.test.ts` | pass | OAuth state tests: 9 passed, 0 failed | 0.4s |
| `tests/observability.test.ts` | pass | Observability tests: 6 passed, 0 failed | 3.1s |
| `tests/optional-integrations.test.ts` | pass | Optional integration tests: 20 passed, 0 failed | 0.5s |
| `tests/owner-registration-journey.test.ts` | fail (exit 1) | ❌ the created customer can authenticate | 0.5s |
| `tests/owner-registration-mode.test.ts` | pass | owner registration mode checks passed | 0.2s |
| `tests/ownership-transfer.test.ts` | fail (exit 1) | Ownership transfer tests: 2 passed, 14 failed | 1.5s |
| `tests/payment-transitions.test.ts` | pass | Payment transition tests: 51 passed, 0 failed | 0.7s |
| `tests/payments.test.ts` | pass | Results: 70 passed, 0 failed | 0.9s |
| `tests/payroll.test.ts` | pass | 📊 Payroll tests: 80 passed, 0 failed, 80 total | 0.9s |
| `tests/plain-language.test.ts` | pass | Results: 3 passed, 0 failed | 0.3s |
| `tests/platform-owner.test.ts` | fail (exit 1) | Platform owner tests: 20 passed, 25 failed | 1.1s |
| `tests/portfolio.test.ts` | pass | Portfolio tests: 34 passed, 0 failed | 0.7s |
| `tests/pwa.test.ts` | pass | PWA tests: 22 passed, 0 failed | 0.4s |
| `tests/queue.test.ts` | pass | Queue tests: 47 passed, 0 failed | 0.6s |
| `tests/rate-limit-ci-mode.test.ts` | pass | rate-limit CI mode checks passed | 0.4s |
| `tests/rate-limit-ip.test.ts` | pass | Rate limit IP tests: 19 passed, 0 failed | 0.5s |
| `tests/rate-limit-outcomes.test.ts` | pass | Rate limit outcome tests: 23 passed, 0 failed | 0.5s |
| `tests/rate-limit-recovery.test.ts` | pass | [rate-limit] health probe failed connect ECONNREFUSED https://secret-host.upstash.io | 0.6s |
| `tests/rate-limit-store-failure.test.ts` | pass | [rate-limit] health probe failed connect ECONNREFUSED https://secret-host.upstash.io | 0.7s |
| `tests/rate-limit-store-health.test.ts` | pass | Rate limit store health tests: 9 passed, 0 failed | 0.8s |
| `tests/registration-route.test.ts` | fail (exit 1) | ❌ the account created is an OWNER | 3.5s |
| `tests/reliability.test.ts` | pass | Reliability tests: 5 passed, 0 failed | 0.3s |
| `tests/rls-enforcement.test.ts` | fail (exit 3) | 9 checks passed (no database needed) | 0.5s |
| `tests/rls-staging.test.ts` | pass | RLS staging tests: 16 passed, 0 failed | 0.5s |
| `tests/role-display.test.ts` | pass | ℹ duration_ms 10.96118 | 0.2s |
| `tests/role-matrix.test.ts` | fail (exit 1) | ❌ unlinked barber sees no customers (got {"error":"Unauthorized"}) | 1.7s |
| `tests/role-permissions.test.ts` | pass | Results: 37 passed, 0 failed | 0.6s |
| `tests/security-hardening.test.ts` | pass | security-hardening: 34 passed, 0 failed | 2.5s |
| `tests/security-policy.test.ts` | pass | Security policy tests: 16 passed, 0 failed | 0.3s |
| `tests/seo-health.test.ts` | pass | SEO and homepage guidance tests: 58 passed, 0 failed | 0.3s |
| `tests/session-devices.test.ts` | fail (exit 1) | at process.processTicksAndRejections (node:internal/process/task_queues:104:5) | 0.8s |
| `tests/session-revocation.test.ts` | fail (exit 1) | Session revocation tests: 9 passed, 12 failed | 1.0s |
| `tests/session-security.test.ts` | pass | Session security tests: 12 passed, 0 failed | 0.5s |
| `tests/settings-persistence.test.ts` | pass | Settings persistence tests: 21 passed, 0 failed | 1.0s |
| `tests/shop-ui.test.ts` | pass | 26 passed, 0 failed | 1.3s |
| `tests/specialty-match.test.ts` | pass | Specialty + First Available tests: 22 passed, 0 failed | 0.9s |
| `tests/staff-invitations.test.ts` | fail (exit 1) | ❌ owner invites a barber (got 401) | 1.0s |
| `tests/stripe-event-claim.test.ts` | pass | Stripe event claim tests: 13 passed, 0 failed | 1.1s |
| `tests/system-status.test.ts` | pass | Owner system status tests: 34 passed, 0 failed | 0.6s |
| `tests/tenant-isolation.test.ts` | pass | Results: 22 passed, 0 failed | 1.0s |
| `tests/tenant-key-sync.test.ts` | pass | Tenant-key sync tests: 6 passed, 0 failed | 1.0s |
| `tests/theme-sanitization.test.ts` | pass | Theme sanitisation tests: 64 passed, 0 failed | 0.6s |
| `tests/time-clock.test.ts` | pass | 61 passed, 0 failed | 1.1s |
| `tests/timezone-dst.test.ts` | pass | Timezone/DST: 18 passed, 0 failed | 1.4s |
| `tests/totp.test.ts` | pass | TOTP conformance tests: 27 passed, 0 failed | 0.4s |
| `tests/trusted-storage-url.test.ts` | pass | Results: 24 passed, 0 failed | 0.4s |
| `tests/twilio-consent.test.ts` | fail (exit 1) | Twilio consent tests: 5 passed, 12 failed | 1.1s |
| `tests/two-factor-api.test.ts` | fail (exit 1) | PASS account stays unprotected after a failed confirmation | 1.1s |
| `tests/two-factor-enrollment.test.ts` | pass | Two-factor enrollment tests: 45 passed, 0 failed | 1.1s |
| `tests/two-factor.test.ts` | pass | Two-factor primitive tests: 41 passed, 0 failed | 0.4s |
| `tests/unsubscribe-flow.test.ts` | pass | Unsubscribe flow tests: 14 passed, 0 failed | 1.0s |
| `tests/unsubscribe-token.test.ts` | pass | Unsubscribe token tests: 18 passed, 0 failed | 0.6s |
| `tests/vercel-env-plan.test.ts` | pass | Vercel env plan: 40 passed, 0 failed | 0.3s |
| `tests/visual-config.test.ts` | pass | ✅ All 78 visual-config tests passed | 0.3s |
| `tests/website-draft-initialization.test.ts` | fail (exit 1) | An operation failed because it depends on one or more records that were required but not found. No record was found for an update. | 0.6s |
| `tests/website-publish.test.ts` | fail (exit 1) | Website draft/publish tests: 7 passed, 14 failed | 0.9s |

**24 suite(s) did not pass.** Treat the program's regression claim as unproven until these are green.

Note: the Playwright browser specs (70 of them) are gated in CI, not by this script.
This record covers the local suites only; see the latest green Template CI run for the
browser evidence.

## Suites that need more than a scratch database

Some suites are not self-contained: they expect the seeded demo shop, a session
fixture, or a live browser, so on a bare scratch database they fail for setup reasons
rather than product reasons. They are listed in the table above with their own failure
line, and the authoritative result for them is the CI job, which provisions the demo
database and runs the full matrix. Do not read a local failure in this group as a
regression; read the CI run.
