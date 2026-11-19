# Main Template Expansion — Phase 0 baseline audit

**Directive:** the 16-part Master Implementation Directive (growth, reliability, security,
usability, enterprise expansion).
**Audited:** 2026-11-19, by inspecting the repository itself, not its README claims.

## 1. Starting commit

| Item | Value |
| --- | --- |
| Repository | `https://github.com/BridgeLine-Services/Main-Barber-Template-` |
| Default branch | `main` |
| Starting commit SHA | `70e20b7367721148287de21511c87c4d23575249` |
| Commit subject | "Say why a payout is what it is, without storing a single word" |
| Working tree at start | clean (`git status --porcelain` empty) |
| Tags | none |
| Branch protection | not verifiable from a clone; `docs/ARCHITECTURE_CONSTITUTION.md` §13 records that administrators must apply it manually |
| Development branch used for this work | `expansion/phase-0-8` |

Nothing was force-pushed, no history was rewritten, and no commit was made directly onto
`main` without review.

## 2. Repository architecture (observed)

| Layer | Reality |
| --- | --- |
| Framework | Next.js 16.4.6 (App Router, Turbopack build), React 19.3, TypeScript 5.5 |
| Data | PostgreSQL 15 via Prisma 6.19.3; 67 models, 40 enums, 57 migrations |
| Auth | NextAuth 4 with a Prisma adapter, credentials provider, 2FA, session registry |
| Tenant | `Business` is the operational tenant; every operational model carries `businessId` |
| Styling | Tailwind 3.4 with a CSS-variable dashboard theme; no second UI framework |
| Runtime | Node 24 (`.nvmrc`, `engines.node >= 24`, CI on Node 24) |
| Size | 910 tracked files, 562 under `src`, 179 API route handlers, 655 files scanned by the architecture checker |
| Integrations | Stripe, SMTP (nodemailer), Twilio SMS, Vercel Blob, Upstash Redis rate limiting |
| Tests | 122 files under `tests/`, 10 Playwright specs under `e2e/` |
| CI | 8 workflows: `ci.yml`, `architecture.yml`, `client-ci.yml`, backup (3), media backup, Vercel diagnostics |

## 3. Existing features

Verified by reading the implementation and by the suites named in §9. Classification uses
the directive's five states; a model or component existing is never enough to be called
implemented.

| Area | State | Evidence |
| --- | --- | --- |
| Public marketing site (8 brand identities) | IMPLEMENTED | `src/app/(customer)/*`, visual-config and theme-sanitization suites |
| Booking engine, double-booking prevention, concurrency | IMPLEMENTED | `tests/booking.test.ts`, `booking-concurrency.test.ts` |
| Cancel / reschedule with policy windows | IMPLEMENTED | `booking-rules.test.ts`, `cancellation-fill.test.ts` |
| Customer accounts, portal, password reset | IMPLEMENTED | `customer-auth-security.test.ts`, `customer-password-reset.test.ts` |
| Barber dashboard, own schedule, portfolio | IMPLEMENTED | `barber-mode.test.ts`, `portfolio.test.ts` |
| Staff invitations and roles | IMPLEMENTED | `role-permissions.test.ts`, `coowner-permissions.test.ts`, e2e staff specs |
| Commissions, time clock, payroll reporting | IMPLEMENTED | `commissions`, `time-clock`, `payroll` suites |
| Memberships, gift cards, e-commerce, inventory | IMPLEMENTED | dedicated suites per module |
| Marketing campaigns, rebooking, waitlist, queue | IMPLEMENTED | `marketing`, `queue`, `cancellation-fill` suites |
| SEO health, homepage modules, brand assistant | IMPLEMENTED | `seo-health`, `home-modules`, `brand-assistant` suites |
| Review requests | IMPLEMENTED | `tests/review-requests.test.ts` (85 assertions, added 2026-10-17) |
| Reliability Program (owner screen, 6 sections) | IMPLEMENTED | `reliability-sections`, `reliability` suites |
| Dependency / runtime monitor | PARTIAL | Logic and classification exist and are tested; vendor support data is never fetched, so live status is always "could not check" |
| Business Growth Center | PARTIAL | `src/lib/growth/overview.ts` reports reach, retention, rebooking, campaigns, reviews; no business-stage model, no stage selection |
| Getting Started guidance | PARTIAL | Four stages exist (`starting`, `growing`, `established`, `multi-location`); no franchise stage, no owner-selected intended stage, no action links |
| Template version identification | NOT IMPLEMENTED | No version constant, file, or endpoint anywhere in the tree |
| Controlled update pathway for client copies | NOT IMPLEMENTED | `DELIVERY-WORKFLOW.md` covers copy creation only; nothing detects or applies upstream changes |
| Maintenance history | NOT IMPLEMENTED (proposal exists) | `docs/PROPOSED-MAINTENANCE-HISTORY-MIGRATION.md`; no model, no migration |
| Multi-location / organization layer | NOT IMPLEMENTED | `Business` is the only tenant; `docs/FEATURE-MATRIX.md` says so explicitly |
| Franchise / corporate roles | NOT IMPLEMENTED | Role enum has `PLATFORM_OWNER, OWNER, BUSINESS_ADMIN, BARBER, CUSTOMER` |
| Production RLS | NOT CONFIGURED (deliberate) | Design + 42 offline enforcement checks pass; not enabled in production |
| Google Business Profile sync | PARTIAL | Helpers exist, never verified against a live account |
| SMS | PARTIAL | Consent flow implemented; provider credentials per installation |

## 4. Existing security controls

| Control | Where | State |
| --- | --- | --- |
| Central capability model | `src/lib/permissions.ts` | IMPLEMENTED — 6 roles, ~30 capabilities, single `can()` entry point |
| Server-side guards | `src/lib/auth-helpers.ts` | IMPLEMENTED — `requireOwner`, `requireBusinessAdmin`, `requireBarber`, scoped resolvers |
| Tenant resolution | `src/lib/tenant.ts` | IMPLEMENTED — `TENANT_MODE` single/multi, fail-closed on invalid mode |
| Tenant isolation, layer 1 | every query filtered by `businessId` | IMPLEMENTED — 22 isolation checks + cross-tenant matrix |
| Tenant isolation, layer 2 (RLS) | `prisma/rls/production-rls.sql` | NOT CONFIGURED — staged plan, offline enforcement proven |
| CSRF / headers / CSP | `src/proxy.ts`, `tests/csp.test.ts` | IMPLEMENTED |
| Rate limiting | Upstash-backed, fail-closed on store failure | IMPLEMENTED — `rate-limit-*` suites |
| Session registry and revocation | `UserSession` model | IMPLEMENTED — `session-revocation`, `session-devices` suites |
| Password hashing and verification | `src/lib/passwords.ts` | IMPLEMENTED — centralized, bcrypt |
| 2FA for owners | `docs/OWNER-2FA.md`, `two-factor.test.ts` | IMPLEMENTED |
| Webhook authenticity and replay | Stripe event claim table | IMPLEMENTED — `stripe-event-claim.test.ts` |
| Audit logging | `AuditLog` model + `/dashboard/audit-log` | IMPLEMENTED |
| Secret hygiene | env registry, drift check, architecture checker | IMPLEMENTED — `env-registry`, `security-hardening` suites |

## 5. Existing reliability capabilities

`src/lib/health.ts` (database, booking readiness, backup freshness, encryption, media,
alerting, optional integrations), `src/lib/platform-reliability/dependency-monitor.ts`
(finding classification, `RepairClass` typed as `automatic | approval | manual`),
`src/lib/platform-reliability/reliability-sections.ts` (six owner-facing sections),
`/dashboard/reliability`, `/dashboard/factory-status`, `/api/health`, `/api/readiness`,
backup + off-site + archive + media workflows, restore rehearsal in CI.

Gap: no vendor support data source. The monitor reports "could not check" honestly, which
is correct but leaves the owner with no actionable support answer.

## 6. Existing onboarding capabilities

`/dashboard/getting-started` renders `STAGE_COPY` from `src/lib/setup-guidance.ts` and
`buildGuidanceProgress`. `/dashboard/onboarding` is the five-step setup flow.
`scripts/client-setup.ts` and `scripts/client-preflight.ts` handle deployment-side setup.
Gap: no links from a guidance step to the page that completes it; stage is inferred from
barber count alone; no franchise stage; no owner-declared intent.

## 7. Existing growth functionality

`src/lib/growth/overview.ts` (`buildGrowthCards`, `summariseGrowth`) and
`/dashboard/growth`. Cards: reach, returning, rebooking, campaigns, reviews, copy, google.
Gap: no five-stage model, no intended-stage selection, no capability-vs-stage mapping,
no referral attribution, no per-barber growth analytics.

## 8. Existing client distribution

Five-step process in `DELIVERY-WORKFLOW.md`; `scripts/prepare-client-copy.sh` strips
`.github/workflows/ci.yml` and keeps security workflows; `scripts/client-setup.ts`;
`.github/workflows/client-ci.yml`; `scripts/client-independence.ts`.
Gap: no version stamp, no update detection, no changed-file report, no conflict check.

## 9. Existing automated tests (executed for this audit)

Environment: local PostgreSQL 15, all 57 migrations applied, Node 24.22.0, no external
provider credentials.

| Command | Result |
| --- | --- |
| `npm run architecture:check` | PASS — 655 files |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 errors, 98 warnings (matches documented baseline) |
| `npm run build` | PASS with a placeholder `DATABASE_URL`; without one it fails by design (`src/lib/prisma.ts:13`) |
| `npm run env:drift` | PASS — 98 declared, 76 referenced, 597 files |
| `npm run test:tenant` | PASS |
| `npm run test:permissions` | PASS |
| `npm run test:reliability` | PASS |
| `npm run test:client-distribution` | PASS |
| `npm run test:guidance` | PASS |
| `npm run test:dependency-monitor` | PASS |
| `npm run test:reliability-sections` | PASS |
| `npm run test:growth` | PASS |
| `npm run test:backup` | PASS — 142 checks across 5 suites |
| `npm run test:operations` | PASS — 126 checks; RLS enforcement additionally run with admin credentials: 42/42 |
| `npm run test:matrix` | BLOCKED — needs a running application server on `127.0.0.1:3000` |
| `npm run test:ci` | started, not completed within the audit window; zero failures recorded in the portion that ran |

## 10. Known defects and honest gaps

1. Vendor support data is never fetched, so dependency support status is permanently
   "could not check" (correct, but not useful).
2. Growth stage is inferred from barber count only; a one-chair shop with ten services
   and a four-chair shop are classified without any owner intent.
3. Guidance steps are not actionable: no link to the page that completes each step.
4. No template version identity and no update pathway for client copies.
5. `docs/CURRENT-STATUS.md` records 10 open CodeQL alerts (tests, tooling, one documented
   false positive in `google-business.ts`).
6. Published homepage version history is single-snapshot; restoring an older version
   needs an additive table.
7. Co-owner and barber dashboard views share the owner surface (role framing not built).

## 11. Outstanding external configuration (owner actions, not code)

Vercel environment variables (`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`,
`NEXT_PUBLIC_APP_URL`), repository privacy and template mode, branch protection, provider
backups/PITR, off-site backup bucket and key, media backup token, alert webhook, human
screen-reader review, legal review, real-shop acceptance day, full client-copy rehearsal.

## 12. Existing technical limitations

- Production RLS deliberately off; the staged plan requires a non-owner app role and
  transaction-local tenant context before activation.
- No organization layer above `Business`; multi-location means separate deployments.
- No maintenance history table (proposal only).
- Reliability support data has no vendor feed.

## 13. Proposed improvements (this directive, in order)

| Phase | Improvement | Risk |
| --- | --- | --- |
| 0 | This baseline | none |
| 1 | Five-stage growth model, owner-declared intent, actionable steps, honest progress | low, additive, pure logic |
| 2 | Vendor support data with source + checked date, owner messages, maintenance history proposal extension | low, no migration |
| 3 | Security review: authorization sweep of new/existing routes, cross-tenant tests, attack-surface checks | low, tests only unless a defect is found |
| 4 | Role-specific dashboard framing for owner, co-owner, barber | low, additive UI |
| 5 | Template version stamp + controlled update pathway (detect, diff, classify, propose) | low, additive scripts and docs |
| 6 | Multi-location architecture proposal | none, document only |
| 7 | Franchise architecture proposal + capability matrix | none, document only |
| 8 | Final regression, completion dashboard, acceptance report | none |

## 14. Files likely to be affected

`src/lib/setup-guidance.ts`, `src/lib/growth/overview.ts`,
`src/app/(dashboard)/dashboard/getting-started/page.tsx`,
`src/app/(dashboard)/dashboard/growth/page.tsx`,
`src/lib/platform-reliability/dependency-monitor.ts`,
`src/lib/platform-reliability/reliability-sections.ts`,
`src/lib/platform-reliability/support-sources.ts` (new),
`src/app/(dashboard)/dashboard/reliability/page.tsx`,
`src/lib/permissions.ts` (additive capabilities only),
`src/components/dashboard/Sidebar.tsx` (additive navigation),
`package.json` (new test scripts), `tests/*` (new suites),
`scripts/template-version.ts` (new), `scripts/check-template-updates.ts` (new),
`TEMPLATE-VERSION.json` (new), `docs/*` (reports and proposals).

## Preservation statement

This audit changed nothing. No database was modified, no migration was applied to any
production system, no environment variable was altered, no existing test assertion was
removed, and no security control was disabled.
