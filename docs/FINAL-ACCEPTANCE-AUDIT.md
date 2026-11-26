# Final project-wide acceptance audit

Baseline: `main` at `f32913573fe76398025bf65275d91966e1410000` (PR #96). Audit written 2026-11-25.
Every number below was produced by running the command named. Nothing in this file is inferred
from a previous status report.

## 1. What was delivered, and where

Each phase is a separate branch off `main`. `main` was never committed to.

| Phase | Branch | Commit | What it changed |
| --- | --- | --- | --- |
| 1 — release confidence | `phase1/release-confidence` | `577051a` | Cron policy test scoped to the report sweep; security sweep recognises the CRON_SECRET cron route; docs corrected, Hobby/sub-daily cron consequence stated |
| 2 — organization scope | `phase2/organization-explicit-scope` | `88b4066` | `allRegions` additive migration with backfill; resolver fails closed on empty scope and on lookup errors; invitation scope must be explicit; 9 new isolation assertions; reconciliation documented |
| 3 — timezone reliability | `phase3/timezone-cache-freshness` | `70b4166` | Bounded, expiring timezone cache with explicit invalidation on write |
| 4 — corporate screens | `phase4/organization-service-templates` | `d9f4a91` | Service-template editor (service layer, two routes, page, component, nav, 30 assertions). **Branding editor not built** |
| 5 — tenant isolation | `phase5/tenant-inventory` | (pushed) | Generated tenant-scope inventory from source; Phase 5 facts measured (withTenant unused, aggregates separately authorised, RLS off) |
| 7 — operations | `phase7/operations-truth` | (pushed) | Operations status separating implemented / configured / verified; corrected a stale claim before shipping it |
| 8 — template versioning | `phase8/template-versioning` | (pushed) | `TEMPLATE-VERSION.json`, pure manifest library, `--check` update assessment, 33 assertions |
| 9 — type safety | `phase9/type-safety` | (pushed) | Three compiler flags enabled after measurement; two real control-flow defects fixed |

**No pull request exists for any of these.** The service-account token pushes commits and returns
`403 Resource not accessible by personal access token` on `POST /pulls`, on every token supplied
(seven so far). The repository's `ci.yml` triggers only on pull requests and pushes to `main` or
`v0/**`, so **none of these branches has a CI run**. They are locally verified only.

## 2. The twenty categories

| # | Category | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Core barbershop operations | IMPLEMENTED BUT NOT FULLY VERIFIED | `test:booking` 20/20, `test:tenant` 22/22, `test:permissions` 37/37 run locally on the phase branches; no CI run for them |
| 2 | Solo-barber operations | IMPLEMENTED BUT NOT FULLY VERIFIED | `test:barber-mode` 23/23 locally |
| 3 | Owner and co-owner permissions | IMPLEMENTED BUT NOT FULLY VERIFIED | `test:coowner-permissions` 35/35 with a live server; capability matrix asserted in `tests/organization-service-templates.test.ts` |
| 4 | Barber and employee workflows | IMPLEMENTED BUT NOT FULLY VERIFIED | `test:barber-mode` 23/23; barber nav spec is credential-gated and skipped in CI |
| 5 | Customer booking and accounts | IMPLEMENTED BUT NOT FULLY VERIFIED | `test:booking` 20/20; browser suite `public-booking` and `customer-auth` specs pass locally (5 and 3 tests) |
| 6 | Multi-location management | IMPLEMENTED BUT NOT FULLY VERIFIED | `organization-isolation` 38/38, `organization-location-management` via `test:organization`; RLS layer not active |
| 7 | Franchise and corporate administration | PARTIALLY IMPLEMENTED | Locations, assignments, regions, pricing approvals, announcements, standard services exist; **corporate branding editor does not** |
| 8 | Organization-level reporting | IMPLEMENTED BUT NOT FULLY VERIFIED | Cron route + scheduling library + 15-minute sweep; scheduling DST tests pass; **delivery to a real inbox never tested** |
| 9 | Financial and employee data security | IMPLEMENTED BUT NOT FULLY VERIFIED | Payroll CSV injection guard and commission tests pass; no independent security review |
| 10 | Booking and timezone correctness | IMPLEMENTED, LOCALLY VERIFIED | `timezone-dst` 23/23 including the cache-freshness assertions added in Phase 3; `test:booking` 20/20 |
| 11 | Tenant isolation | IMPLEMENTED BUT NOT FULLY VERIFIED | `tenant-isolation` 22/22, `organization-isolation` 38/38; inventory generated (77/86 models tenant-scoped, 205 routes); RLS deliberately inactive |
| 12 | Database migration integrity | IMPLEMENTED BUT NOT FULLY VERIFIED | Phase 2 migration applied locally via `prisma migrate deploy`; `prisma validate` clean; **not applied to any real database from this workspace** |
| 13 | Backup and disaster recovery | BLOCKED BY EXTERNAL SETUP | CI restore verification exists; provider-level daily backups with retention are not configured; no rehearsal on real data |
| 14 | Monitoring and alerting | IMPLEMENTED BUT NOT FULLY VERIFIED | Health and readiness endpoints, alert workflows with plain-language messages; no alert channel verified connected |
| 15 | Third-party integrations | BLOCKED BY EXTERNAL SETUP | Stripe, Twilio, SMTP, Blob, Google Business all implemented in code; **no provider acceptance run**; credentials state unknown from here |
| 16 | Accessibility and mobile usability | REQUIRES HUMAN PROFESSIONAL REVIEW | `accessibility.spec.ts` 8/8 and `responsive.spec.ts` 24/24 pass locally; automated checks are not a screen-reader review |
| 17 | Client-copy distribution | IMPLEMENTED BUT NOT FULLY VERIFIED | `prepare-client-copy.sh` protections retained; `client-independence.ts` still fails the build on client-specific data |
| 18 | Template update safety | PARTIALLY IMPLEMENTED | Detection and description implemented and tested (33 assertions); **applying an update is deliberately not automated** |
| 19 | Environment and deployment readiness | BLOCKED BY EXTERNAL SETUP | `env-registry.ts` is the single inventory; paid plan required (Hobby forbids commercial use and sub-daily crons); no deployment performed |
| 20 | Legal and commercial launch requirements | REQUIRES OWNER DECISION | LICENSE is a structural framework awaiting attorney approval; repository is public |

No percentage is given. Counting files or features would produce a number that says nothing about
whether a shop can take money on Monday.

## 3. Remaining defects found and left open

1. **Corporate branding editor does not exist.** `branding.manage`, `resolveBrand()` and
   `requestLocationOverride()` are implemented and tested; there is no screen. Phase 4 built the
   service-template editor and stopped there.
2. **Role-specific dashboards are shared surfaces.** Co-owner, barber and location-manager views
   reuse the owner dashboard with role framing; Phase 6 was not started.
3. **`withTenant()` has zero call sites in `src/`.** Tenant isolation is entirely application-level.
   Introducing it requires classifying every query first.
4. **Cron policy is inconsistent on `main` until Phase 1 merges**: `optional-integrations` is
   19 passed, 1 failed on `main` (verified), fixed on `phase1/release-confidence`.
5. **`noImplicitAny` (225 errors) and `strictNullChecks` (404 errors)** remain off. Measured, not
   estimated; see `docs/TYPE-SAFETY.md`.
6. **65 guarded routes have no visible tenant filter.** Many are legitimate organization-wide or
   platform reads; each needs a reader to confirm. The inventory says which.
7. **`scheduleAppointmentReminders()` previously returned `undefined` on one path** — fixed in
   Phase 9. Worth noting because it was live behaviour, not a type nit: a caller reading
   `.scheduled` would break only for shops with email configured.

## 4. Remaining security risks

- A regional manager's empty region list no longer grants everything, but **existing members must be
  reviewed** with the SQL in `docs/ORGANIZATION-PERMISSIONS-MATRIX.md` before the migration is
  deployed; the backfill preserves current access, including any accidental all-region grant.
- RLS is staged and inactive. Application-level checks are the only layer.
- No independent security review or penetration test has been performed on this repository.

## 5. Deployment blockers

1. No pull requests, therefore no CI runs for the eight phase branches.
2. Paid hosting plan required (commercial use and sub-daily crons).
3. Provider credentials and acceptance: Stripe, Twilio, SMTP, Blob, Google Business.
4. Provider-level database backups with retention, plus a real restore rehearsal.
5. Upstash Redis in the deployment, or first-owner registration is refused by design.

## 6. Required owner actions

- Open pull requests for the phase branches (one click each), or issue a token with
  *Pull requests: write* and *Security events: read*.
- Decide the hosting plan and authorise the upgrade.
- Approve or reject the reconciliation assumption for existing empty-region managers.
- Authorise the LICENSE review and any repository-visibility change.
- Sign off on launch after the provider acceptance in section 7.

## 7. Required external and human reviews

| Review | Who | Why it cannot be done here |
| --- | --- | --- |
| Provider acceptance (Stripe test payment + webhook, Twilio SMS with STOP, SMTP delivery, Blob upload) | owner, with credentials | No credentials and no deployment access in this workspace |
| Restore rehearsal on real data | owner or DBA | Needs a production or staging database |
| Accessibility (screen reader, keyboard, real devices) | human specialist | Automated axe runs are not a substitute |
| Legal review of LICENSE | attorney | Commercial licensing decision |
| Independent security review | external | Not performed at any point |

## 8. Test report, as executed

Run locally on the named branches. Every count below came from the command's own output.

| Suite | Result |
| --- | --- |
| `optional-integrations` (Phase 1) | 21/21 |
| `security-sweep` (Phase 1) | 58/58 |
| `organization-isolation` (Phase 2) | 38/38 |
| `organization-invitations` (Phase 2) | 62/62 |
| `organization-franchise-overview` (Phase 2) | 57/57 |
| `organization-dashboard` (Phase 2) | 66/66 |
| `organization-assignment-management` (Phase 2) | 62/62 |
| `timezone-dst` (Phase 3) | 23/23 |
| `test:booking` | 20/20 |
| `organization-service-templates` (Phase 4) | 30/30 |
| `template-version` (Phase 8) | 33/33 |
| `notification-resilience` (Phase 9) | 16/16 |
| `rate-limit-store-failure` | 15/15 |
| `typecheck` | clean, with `noImplicitReturns`, `noFallthroughCasesInSwitch`, `strictFunctionTypes` enabled |
| `lint` | 0 errors (103–105 pre-existing warnings, varying by branch) |
| `build` | exit 0 on Phase 4 and Phase 9 branches |
| `prisma validate` | schema valid |

**Not run here:** `test:ci` to completion (the backup chain needs a `psql` binary that this sandbox
does not have; 52 suites pass before it stops), and no CI run at all for any phase branch.

## 9. Commercial launch assessment

**Not production-ready, and not because it fails to build.** It builds, its suites pass locally,
and the booking, permission and tenant paths are covered by real assertions. What is missing is
everything that separates "the software works on my machine" from "a shop can take money on
Monday": provider acceptance, configured backups with a proven restore, a paid plan that permits
the schedules the product needs, an independent accessibility pass, a legal licence, and CI having
seen any of this work.

The three highest-value next steps, in order: open the pull requests so CI judges this work; run
Stripe test-mode acceptance and one real restore rehearsal; then build the branding editor and the
role-specific dashboards that Phases 4 and 6 left open.
