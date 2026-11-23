# Priorities 1 to 5: what is done, what is not, and why

Written 2026-11-20 against template version 1.2.0 (63 migrations). This document is the
honest ledger. Anything listed as done has a test that proves it and a green run recorded at
the bottom. Anything listed as not done says what is missing and what it would take.

## Verification recorded for this pass

| Gate | Result |
| --- | --- |
| `npm run architecture:check` | Passed, 701 source files scanned |
| `npx tsc --noEmit` | Clean |
| `npm run lint` | 0 errors, 99 pre-existing warnings (all in test files) |
| `npm run build` | Succeeded |
| Migrations on an empty PostgreSQL 15 | 63 of 63 applied, zero schema drift |
| `tests/tenant-isolation` | 22 passed |
| `tests/role-permissions` | 37 passed |
| `tests/maintenance-history` | 86 passed |
| `tests/security-sweep` | 54 passed |
| `tests/file-validation` | 57 passed |
| `tests/reliability-program` (new) | 102 passed |
| `tests/organization-architecture` (new) | 155 passed |
| `tests/organization-isolation` (new) | 29 passed |
| `tests/growth-referrals` (new) | 66 passed |
| `tests/rls-reconciliation` (new) | 40 passed |

## Priority 1: reliability program

### Done

- **Restore rehearsal evidence.** A completed rehearsal now records its outcome in the
  `RestoreDrill` table the maintenance report already reads: backup identifier, start and
  completion times, tables restored, rows compared, whether the counts matched, the real
  error when there is one, and the duration. Writing is opt-in through
  `RESTORE_DRILL_EVIDENCE_URL`, so the default command still writes nothing but its JSON
  evidence file; the scratch database is never used for this. A record says `succeeded`
  only when the rehearsal passed and the counts actually matched, and a failed write can
  never turn a failed restore into a reported success (`tests/restore-drill-evidence.test.ts`).
- **Security advisory monitoring.** `advisory-monitor.ts` turns a raw advisory into a
  business-impact sentence, states whether a fix exists (and never invents a patched version
  when none is published), and separates "needs action today" from "next maintenance window".
- **Compatibility monitoring.** `compatibility.ts` checks the runtime, framework, database and
  driver against the tested line, plus three combinations that break in practice (Next 16 with
  React 18, Next 16 on an old Node, Prisma 6 on an old Node). An unparseable version is
  `unknown`, never `supported`.
- **Dependency update automation.** `update-plan.ts` groups routine updates, holds back every
  breaking and security change for its own approval, names the tests to run, and writes the
  pull-request body and the rollback. `autoMerge` and `autoDeploy` are literal `false` in the
  type, so a caller cannot switch them on.
- **Gated repair automation.** `repair-policy.ts` classifies every repair as automatic,
  approval, or specialist. A suspected breach, a failed restore, a payment mismatch, corrupted
  records or a tenant-isolation concern always lands on specialist and stops automation while
  keeping evidence. Every verdict carries the five required explanations.
- **Scheduled maintenance reports.** `scheduled-report.ts` builds a six-section report where an
  unverified section can never read as healthy, and renders it to Markdown. Exposed at
  `GET /api/cron/maintenance-report`, protected by `CRON_SECRET`, read-only.
- **Repair history.** Already existed (`maintenance-history.ts`, 86 assertions) and is reused by
  the config audit for redaction rather than duplicated.
- **Restore verification.** `recovery-verification.ts` distinguishes four states: verified,
  failed, stale (older than 30 days) and never tested. Creating a backup is explicitly not
  proof. New additive table `RestoreDrill` holds the evidence.
- **Client update notices.** `client-update-notice.ts` separates informational, recommended,
  security, owner-action, migration-required and deployment-required, and states every time
  that nothing is applied automatically.

### Not done, and why

- **No live advisory feed.** Nothing fetches npm audit or OSV data; the modules parse records a
  caller supplies. The cron endpoint therefore reports the security section as *not verified*
  rather than pretending it is clear. Adding a feed is a network dependency and a scheduling
  decision, not a code gap.
- **No UI for the maintenance report.** It is available as JSON and Markdown from the endpoint.
  The reliability page was left as it was.
- **`scripts/rehearse-restore.ts` does not write a `RestoreDrill` row yet.** The table, the
  reader and the verdict logic exist and are tested, but until the rehearsal script records its
  result the report will honestly say recovery was never tested.
- **No pull-request automation.** The plan generator is deliberately not connected to GitHub.
  Opening pull requests automatically was not requested and would be a production side effect.

## Priority 2: multi-location organization layer

### Done

- **Additive schema.** Migration `20261120150000_organization_and_referrals` adds 12 organization
  tables and two enums. It contains no `DROP`, no `ALTER` of an existing table and no row
  deletes; `Business` gains one optional back-relation and no column. `OrganizationLocation`
  references `Business` with `ON DELETE RESTRICT`, so deleting an organization can never delete
  a shop.
- **Capability model.** Seven roles with an explicit capability list. No corporate role holds
  `reporting.customer.read`, and that is asserted from four directions.
- **Session-only resolution.** `resolveOrganizationContext(userId)` is the only entry point. It
  never accepts an organization id, filters a regional manager by region, pins a franchise owner
  and location manager to their own shop, widens reach only through explicit assignments, and
  refuses a suspended member, an unknown role, and a failed read.
- **Consolidated reporting.** `reporting.ts` sums only what it can verify: one unreadable
  location makes the total `null`, not smaller. `aggregateOnlyGuard` refuses to send a payload
  containing a customer identity, and the route fails closed if it ever finds one.
- **Routes.** `GET /api/dashboard/organization` and `GET /api/dashboard/organization/report`,
  both session-scoped, both covered by the security sweep.

### Not done, and why

- **No user interface.** No organization page, no membership invite flow, no reporting
  configuration screen. The API and rules exist; the screens do not.
- **Stages 2 to 6 of the proposal are not built.** Membership management, reporting delivery,
  staff assignment writes, organization settings writes and approved write operations all
  remain proposals. Only stage 1 (schema and relationships) and stage 3 (read-only aggregate
  reporting) are implemented.
- **No write endpoints.** Nothing in this layer creates or changes a record through the API, so
  the approval-controlled write operations described in the proposal are still to come.

## Priority 3: franchise and corporate management

### Done

- **Branding with approved exceptions.** Corporate values resolve by default; a location may
  override only a field corporate has allowed, with a valid colour or URL, and every resolved
  field names its source.
- **Service templates and pricing.** A location either uses the standard price or records an
  exception that requires a reason and an approver. Changes produce field-by-field history.
- **Location lifecycle.** A state machine (`onboarding → active → closing → closed`) with a
  refusal that explains why, plus opening and closing checklists where every step states what
  it does, what changes, who may do it, whether it can be undone and what happens if it fails.
- **Staff assignments.** Effective-dated, overlap-rejected, with an audit sentence for creation
  and for ending.
- **Announcements.** Audience resolution for all, region, location and named group; closed
  locations excluded; unknown ids dropped; a sender can never reach outside their own scope.
- **Announcement inbox (in-app).** `announcement-inbox.ts` decides who may see a stored
  announcement, what it says about its audience, and what a send would actually reach;
  `announcement-delivery.ts` reads the inbox for the session user, publishes inside the
  sender's own scope, and writes one read receipt per person. Screens at
  `/dashboard/organization/announcements` (owner and barber nav), with
  `GET`/`POST /api/dashboard/organization/announcements` and
  `POST /api/dashboard/organization/announcements/[id]/read`. Read state is per person and
  cannot be written for another person or another organization. Delivery is in-app only:
  no email and no SMS.
- **Configuration auditing.** Every change records actor, before, after and a readable summary,
  with secrets redacted through the existing maintenance-history redactor.
- **Customer privacy boundary.** A corporate role is refused an individual customer record even
  at a location it administers. Cross-location history needs an explicit, unrevoked consent
  record naming a location involved, in the same organization.

### Not done, and why

- **No franchise UI or endpoints.** These are rules and tests, not screens or routes. Building
  them needs the organization UI above to exist first.
- **No email or SMS announcement delivery.** The in-app inbox is complete. Sending an
  announcement outside the app is still not built, and `POST` answers with
  `delivery: 'in-app-only'` rather than implying a message went out.
- **The announcement migration is written but not applied.**
  `prisma/migrations/20261123140000_organization_announcement_delivery` adds one column
  (`resolvedBusinessIds`, fixed at send time) and one table (`OrganizationAnnouncementRead`).
  It is additive only. Until it is applied, the inbox routes will fail closed rather than
  show or mark anything.
- **No unread badge and no group picker.** The sidebar link is plain, and the send form
  offers everyone, regions and locations. A named group can be sent through the API because
  the resolver already understands one, but nothing in this repository defines groups, so
  the form does not invent them.
- **No scheduled corporate reporting.** The configuration table exists; nothing reads it on a
  schedule.

### Verification recorded for the announcement inbox pass

Recorded 2026-11-23, on the working tree that adds the inbox.

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | Clean |
| `eslint` on the changed files | Clean |
| `npm run architecture:check` | Passed, 727 source files scanned |
| `tests/organization-announcement-inbox` (new) | 96 passed |
| `tests/organization-architecture` | 155 passed |
| `tests/organization-people-screen` | 58 passed |
| `tests/organization-franchise-overview` | 57 passed |
| `tests/accessibility-guard` | 44 passed |

Not run in that pass: `npm run build`, and any suite that needs a live database
(`tests/organization-invitations`, `tests/organization-isolation`), because no
`DATABASE_URL` was available. The new suite is deliberately free of database access.

## Priority 4: security and tenant isolation

### Done

- **CodeQL.** Six alerts were open, not ten. Five are fixed in code (a real second scheme check
  on the barber photo preview, a loop-until-stable comment stripper, and three URL checks that
  now compare parsed hostnames instead of substrings). The sixth is a documented false positive:
  an HMAC signature over an OAuth state token is not a password hash. Details in
  `docs/CODEQL-REMEDIATION.md`.
- **Gift-card RLS gap, reconciled and pinned.** `scripts/rls-reconcile.ts` reports any table
  with RLS enabled and no policy and prints the exact policy, read-only. On the live database it
  finds exactly the three gift-card tables. `tests/rls-reconciliation.test.ts` proves the gap,
  proves the staged plan closes it, and fails if any migration starts creating policies.
- **Staged RLS extended.** The plan now covers the 14 new tables: seven by `businessId`, seven
  by `app.current_organization_id`. `RestoreDrill` is documented as deliberately global.
- **Penetration test plan.** `docs/PENETRATION-TEST-PLAN.md`, with tenant isolation as the
  highest-value target and a pass/fail table per test.
- **Account protection review.** `docs/ACCOUNT-PROTECTION-REVIEW.md`: what already existed,
  what this pass added, four remaining gaps and the one decision an owner must make.
- **Staging requirements.** `docs/STAGING-ENVIRONMENT.md`, including the two-step role switch and
  the warning that the role switch must follow the policies, not precede them.

### Not done, and why

- **RLS is still not enabled.** This is deliberate and matches the standing instruction that
  sensitive database changes are approval-controlled. Enabling it is a production change with
  its own rollout, not something to slip into a feature branch.
- **The runtime database role was not switched to `barber_app`.** Same reason. Doing it before
  the gift-card policies exist would be a fail-closed outage for gift cards.
- **The penetration test was not executed.** The plan exists; running it needs a staging
  environment and a tester.
- **The CodeQL re-scan is not confirmed.** The fixes are in the tree; the alerts close only
  after GitHub scans the pushed commit. This will be checkable immediately after the push.

## Priority 5: solo barber experience

### Done

- **Referral attribution.** Codes are short, uppercase and avoid ambiguous characters; links and
  URL parameters are parsed rather than guessed; attribution refuses a second attribution, a
  self-referral and a returning visit, and records the reason either way. The database carries a
  unique key on the customer as a second line of defence.
- **Referral reporting.** Customers referred, converted, conversion rate, repeat bookings,
  revenue from referred customers and share of total revenue. A revenue total is `null` if any
  referred customer's revenue is unknown.
- **Per-barber analytics.** Six list questions (best channel, top services by money, returning
  customers, referrals, quietest day, money lost to cancellations) plus a labelled revenue
  block: taken, refunded, after refunds, tips, commission owed, recorded expenses. No profit
  figure anywhere, because costs are only known where a shop records them, and tips are `null`
  rather than zero when the shop does not record them.
- **Routes.** `GET`/`POST /api/dashboard/referrals` and `GET /api/dashboard/growth/analytics`.
  A barber is pinned to their own profile; an owner may name only a barber in their own shop.

### Not done, and why

- **Attribution is not wired into the booking flow.** Nothing calls `decideAttribution` when an
  appointment is created, so no attribution row is written in normal use. This is the single
  most important remaining piece for this priority: the rules, the table and the reporting are
  ready, but the booking transaction does not yet use them.
- **No barber or referral screens.** The analytics and referral data are available from the API
  only.
- **The referral programme is off by default** and codes are issued through the API. There is no
  customer-facing "share your code" surface.

## What I would do next, in order

1. Wire `decideAttribution` into the booking transaction, behind a flag, with a test that a
   second booking never double-counts.
2. Make `scripts/rehearse-restore.ts` record a `RestoreDrill` row so recovery verification has
   evidence to read.
3. Build the organization page and the barber analytics page, both read-only.
4. Approve and apply the staged RLS plan, then switch the runtime role.
5. Run the penetration test against staging.
