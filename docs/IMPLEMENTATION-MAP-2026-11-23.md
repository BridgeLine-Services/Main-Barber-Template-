# Implementation map

Inspected 2026-11-23 at `8c3f162` on `main`, working tree clean. This is the map the master
instructions ask for before any development: what exists, which file decides it, and what was
actually verified rather than assumed.

Method: source, schema, migration history, tests and CI were read directly. Where a claim
mattered for planning it was checked by running something. Nothing here is copied from a
status document without that check, because two status documents turned out to be stale
(section 3).

Not verified: anything needing a live database, staging, or production credentials. This
machine has no `DATABASE_URL`, no Stripe, Twilio, SMTP or Upstash credentials, and no
staging deployment. Claims about those are marked as unverified rather than green.

## 1. Baseline

| Fact | Value |
| --- | --- |
| `main` | `8c3f162` |
| Runtime | Node 24 |
| Framework | Next 16.4.6, React 19.3, TypeScript 5.5 |
| Database | PostgreSQL 15, Prisma 6.19.3, production RLS deliberately not enabled |
| Prisma models | 85 |
| Migrations | 66, newest `20261123140000_organization_announcement_delivery` |
| API route handlers | 192 |
| Dashboard pages | 63 |
| Test files | 147, of which `npm run test:ci` runs 83 |
| Documentation | 75 files in `docs/` |
| CI workflows | 7: `ci`, `client-ci`, `architecture`, `backup-archive`, `backup-offsite`, `media-backup`, `vercel-diagnostics` |

`npm run test:ci` is the main gate. `.github/workflows/ci.yml` runs, in order: `npm ci`,
`test:vercel-build`, `test:optional-integrations`, `npm audit --omit=dev`, `license:inventory`,
`architecture:check`, `deploy:migration-check`, `rls:plan`, `test:architecture`, `lint`,
`typecheck`, `prisma validate`, `prisma generate`, `prisma migrate deploy`, `test:ci`,
`test:backup`, `test:operations`.

## 2. Areas, the file that decides each, and verified status

Status vocabulary: **verified working** means read and exercised here. **Verified present**
means the code and tests exist and were read, but the behaviour was not run against a
database. **Partial** means some of the claim holds and some does not.

| Area | Deciding files | Status | Evidence |
| --- | --- | --- | --- |
| Session and auth | `src/lib/auth.ts`, `auth-helpers.ts`, `tests/session-security.test.ts` | Verified present | `requireAuth` is the guard every dashboard route uses; 54-check security sweep passes |
| Organization capabilities | `src/lib/organization/capabilities.ts` | Verified working | Role matrix with `can(role, capability)`; exercised through the announcement suites |
| Organization resolution | `src/lib/organization/resolve.ts` | Verified working | Resolves org, role and open locations from the session only; never from a request |
| Locations and lifecycle | `src/lib/organization/locations.ts`, `tests/organization-isolation.test.ts` | Verified present | Closed locations excluded by the resolver; isolation suite needs a database |
| Branding | `src/lib/organization/branding.ts` | Verified present | Read only |
| Service templates | `src/lib/organization/service-templates.ts` | Verified present | Read only |
| Reporting | `src/lib/organization/reporting.ts`, `report-query.ts`, `dashboard-view.ts` | Verified present | Read only |
| Invitations | `src/lib/organization/invitations.ts`, `api/dashboard/organization/invitations` | Verified present | Suite needs a database, so it was not run here |
| Announcement audience rules | `src/lib/organization/announcements.ts` | Verified working | `resolveAudience`, `limitToSenderScope`, `maySendAnnouncement`; 101-check suite |
| Announcement inbox and delivery | `announcement-inbox.ts`, `announcement-delivery.ts`, 2 API routes, page, `AnnouncementInbox.tsx` | Verified working | In-app only; no email or SMS anywhere in the path |
| Franchise and corporate overview | `src/lib/organization/franchise-view.ts` | Verified working | 57-check suite |
| Referrals | `src/lib/growth/referrals.ts`, `api/dashboard/referrals`, attribution in `availability.ts` | Verified present | Program, code and attribution models exist; no reward or redemption ledger |
| Queue and waitlist | `src/lib/queue.ts`, `tests/queue.test.ts` | Verified present | Read only |
| Commissions | `src/lib/commissions.ts` | Partial | `CommissionRateType` is `PERCENT` and `FIXED` only (schema line 1598); hourly, booth rental and hybrid are absent |
| Payroll | `src/lib/payroll.ts` | Verified present | Computes; no tax filing, which is correct |
| Campaigns and marketing | `src/lib/marketing.ts`, `email-marketing.ts` | Verified present | Audience resolution, campaign rows, send path |
| Review requests | `src/lib/review-requests.ts` | Verified present | Read only |
| Retention and rebooking | `rebooking-engine.ts`, `retention.ts`, `retention-dashboard.ts` | Verified present | Read only |
| Gift cards | `src/lib/gift-cards.ts`, gift-card migration | Verified present | RLS enabled on three tables with no policies: the documented blocker for the runtime role switch |
| Website builder and draft/publish | `src/lib/visual-style.ts`, `home-modules.ts`, `WebsiteContent` | Partial | One `publishedContent` snapshot (schema line 1232); no version history, no custom navigation model |
| Reliability | `src/lib/platform-reliability/` | Verified present | Read only |
| Backup and restore | `scripts/rehearse-restore.ts`, `tests/backup*` | Verified present | 142 checks in `test:backup` |
| RLS staging | `prisma/rls/production-rls.sql`, `scripts/rls-plan.ts`, `tests/rls-reconciliation.test.ts` | Verified working | `rls:plan` classifies 1 organization root, 11 organization-scoped, 5 global, 0 unclassified; 39 checks pass |
| Growth stages | `src/lib/growth-stages` area, `tests/growth-stages` | Verified present | Read only |
| Template version and updates | `TEMPLATE-VERSION.json`, owner-only version endpoint | Verified present | Read only |
| Maintenance history | `MaintenanceAction` model, migration `20261120090000` | Verified present | Business-scoped, in the RLS list |
| Security sweep | `tests/security-sweep.test.ts` | Verified working | 54 checks, fails on a lost route guard or a request-supplied tenant id |
| Accessibility guard | `tests/accessibility-guard.test.ts` | Verified working | 44 static checks; not a screen-reader audit |

## 3. Corrections to the existing status documents

`docs/COMMERCIAL-PRIORITIES-MATRIX.md` was inspected at `7ac8dd5`, three migrations and one
program before `main`. Three of its lines are now wrong, and planning from them would have
caused duplicate work:

| Claim in the matrix | What is true now | Evidence |
| --- | --- | --- |
| "Personalised QR booking code: no QR encoder or generator anywhere in `src`" | Implemented | `src/lib/barber/qr.ts` encodes with the `qrcode` package, refuses non-http payloads and payloads over 512 characters; used by `/dashboard/my-numbers`; covered by `tests/barber-qr.test.ts` |
| "TikTok support: `Barber` has no TikTok field, so this is also a migration" | The field exists | `prisma/schema.prisma` has two TikTok references; `/barbers` renders a TikTok link and the profile page edits it |
| "Announcement delivery: audience resolution implemented; sending is not" | In-app delivery is implemented | `docs/ANNOUNCEMENT-INBOX.md`; email and SMS remain unimplemented, which is still accurate |

`docs/CURRENT-STATUS.md` already says `PRIORITIES-1-5-STATUS.md` supersedes it for what is
done, so that file was read as history, not as current state.

## 4. Genuinely blocked by the schema (verified, not assumed)

These are the items that cannot be finished without an additive migration. Each was checked
against `prisma/schema.prisma` directly.

| Item | What is missing | Smallest additive change |
| --- | --- | --- |
| Referral rewards and redemption | Only `ReferralProgram`, `ReferralCode` and `ReferralAttribution` exist; there is no reward or redemption record | One reward ledger table keyed to attribution, plus a redemption state |
| Birthday segmentation | `Customer` has no birthday field | One consented date field, nullable |
| Published website version history | `WebsiteContent` keeps one `publishedContent` snapshot | One versions table, business-scoped, append-only |
| Custom navigation editing | No model | One navigation model, business-scoped |
| Hourly, booth rental and hybrid commission | `CommissionRateType` is `PERCENT` and `FIXED` | Two enum values plus the fields each needs |

The master instructions say not to apply production migrations without explicit owner
authorization, and this project's own convention is that these four-plus items stop at the
gate. They stop here.

## 5. Test and CI coverage

- 147 test files exist. `test:ci` runs 83 of them; the other CI steps add `test:backup`,
  `test:operations`, `test:architecture`, `test:tenant` and `test:permissions`.
- 14 test files are referenced by no npm script and no workflow, so no gate runs them:
  `appearance-reset`, `business-deactivation`, `feature-flags`, `font-url-guard`, `fonts`,
  `owner-registration-mode`, `ownership-transfer`, `pwa`, `rate-limit-ci-mode`,
  `review-invite-copy`, `staff-invitations`, `totp`, `trusted-storage-url`,
  `website-draft-initialization`.
- The announcement inbox suite had an npm script but was not in `test:ci`, so CI never ran it.
  Wired in during this phase.
- `deploy:migration-check` reports the newest migration as backward compatible.
- Not run anywhere here: CodeQL, any staging deployment, and any suite needing a database.

## 6. Phase plan

Each phase is a branch and a pull request. No phase is merged or deployed without the owner.

**Phase 0, this phase.** The map above, the CI wiring for the announcement suite, and the
correction of the stale claims. No production code changes.

**Phase 1 candidates, no schema change.** Each is additive UI or library work over data that
already exists:

1. Per-barber growth overview: revenue, rebooking and retention for one barber, from
   `analytics.ts` and `commissions.ts`.
2. Consolidated marketing performance: one view over campaign rows that already exist.
3. Slow-day recommendations: the audience resolver already understands dormant customers.
4. Tablet previews for the website builder, desktop and mobile being done.

**Phase 2, needs an owner-approved additive migration.** Referral reward ledger, birthday
field, website version history, custom navigation, hourly and booth commission types. Each is
its own migration and its own pull request.

**Phase 3, needs owner authorization and a staging run.** Applying
`20261123140000_organization_announcement_delivery` to production, the RLS rollout, and the
runtime role switch, which stays blocked until the three gift-card policy gaps are closed.

## 7. Outstanding owner decisions

1. Whether to apply the announcement delivery migration to production.
2. Whether to approve any of the five additive migrations in Phase 2, one at a time.
3. When to run the RLS rollout, and whether to close the gift-card policy gap first.
4. Which Phase 1 candidate to build first, if the order above is not the one wanted.
