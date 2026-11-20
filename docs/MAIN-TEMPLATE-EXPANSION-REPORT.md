# Main Barber Template: expansion report

Branch: `expansion/phase-0-8`. Baseline: `main` at `70e20b7` (clean tree, recorded before any
change). Template version: 1.1.0. Date: 2026-11-19.

Nothing existing was removed, replaced or rebuilt. No production database was touched, no
migration was applied to a production system, and no security control was disabled.

## 1. Test results (executed, not assumed)

| Check | Result |
| --- | --- |
| `npm run test:ci` (78 suites) | PASS, exit 0 |
| `npm run architecture:check` | PASS, 671 source files |
| `npm run typecheck` | PASS, no errors |
| `npm run lint` | PASS, 0 errors, 98 warnings (same warning count as baseline) |
| `npm run build` | PASS, 75/75 static pages, requires `DATABASE_URL` and `NEXTAUTH_SECRET` |
| `npm run test:tenant` | PASS, 22 |
| `npm run test:permissions` | PASS, 37 |
| `npm run test:coowner-permissions` | PASS |
| `npm run test:backup` | PASS, 142 checks |
| RLS enforcement | PASS, 42/42 against local PostgreSQL 15 with the admin credential supplied |
| New: `test:growth-stages` | PASS, 71 |
| New: `test:support-sources` | PASS, 48 |
| New: `test:security-sweep` | PASS, 52 |
| New: `test:template-updates` | PASS, 56 |
| New: `test:role-experience` | PASS, 71 |
| New: `test:maintenance-history` | PASS, 96 |
| New: `test:maintenance-window` | PASS, 30 |
| New: `test:accessibility` | PASS, 44 |

Not executed, and not claimed: GitHub Actions CI on the pushed branch, CodeQL, and any run
against a real staging deployment with Upstash, Stripe, Twilio and SMTP credentials.

## 2. What changed, and why

Every file below is additive or an extension. Line numbers are intentionally not quoted;
`git diff 70e20b7..expansion/phase-0-8 -- <path>` gives them exactly.

| File | Original behaviour | New behaviour | Reason | Security | Database | Tests | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/lib/growth/stages.ts` (new) | — | Five stages with per-capability availability and real destinations | Part 4.1 | None; pure data | None | `growth-stages` | Delete file |
| `src/lib/growth/stage-store.ts` (new) | — | Reads/writes the owner's declared direction; missing column reads as "not said" | Part 4.2 | Owner-only caller, tenant from session | Reads new nullable column | `growth-stages` | Delete file |
| `prisma/migrations/.../add_intended_stage/migration.sql` (new) | — | Adds nullable `Business.intendedStage` | Part 4.2 | No permission change | Additive, nullable | `growth-stages` | Drop column |
| `src/app/api/dashboard/growth-stage/route.ts` (new) | — | Owner-only POST that validates and audits a declared direction | Part 4.2 | `requireOwner`, session tenant, audit log | Writes one nullable column | `security-sweep`, `growth-stages` | Delete route |
| `src/lib/setup-guidance.ts` | Stage inference from barber count | `resolveStage()` separates intention from evidence; progress counts unknown as unknown | Parts 4.2, 4.3 | None | None | `setup-guidance` (127) | Revert file |
| `dashboard/getting-started/page.tsx` | Checklist | Adds stage resolution, selector, honest progress, action links, planned-vs-ready capability list | Parts 4.1-4.5 | No new access | None | `setup-guidance`, `growth-stages` | Revert file |
| `dashboard/growth/page.tsx` | Growth view | Adds stage strip and ready-vs-not-built summary | Part 4.1 | None | None | `growth-overview`, `growth-stages` | Revert file |
| `components/dashboard/StageSelector.tsx` (new) | — | Owner-only direction picker posting to the route above | Part 4.2 | Posts to a guarded route | None | `growth-stages` | Delete file |
| `components/dashboard/Sidebar.tsx` | Three pages existed with no navigation entry | Adds Next Steps, Growth Plan, Maintenance links | Part 4.5 | No change | None | `role-experience`, `growth-stages` | Revert file |
| `src/lib/platform-reliability/support-sources.ts` (new) | — | Authoritative source catalogue and `buildSupportRecord()` | Part 5.1 | None; no network, no secrets | None | `support-sources` | Delete file |
| `src/lib/platform-reliability/dependency-monitor.ts` | Findings without provenance | Every finding carries source, checked date, support status, security and compatibility notes | Part 5.1 | None | None | `dependency-monitor` (36) + `support-sources` | Revert file |
| `dashboard/reliability/page.tsx` | Sections and readiness checks | Adds "Software versions and support" and "Which version is this?" | Parts 5.1, 8.1 | Owner-only page | None | `reliability-sections`, `support-sources` | Revert file |
| `src/lib/platform-reliability/maintenance-history.ts` (new) | — | Repair record rules: creation with redaction, two-party approval, A/B/C state machine, outcome that requires passing checks, plain-English description and summary; reports itself as not enabled | Part 5.3 | Cannot store a secret; imports no database client | None; no migration created | `maintenance-history` (75) | Delete file |
| `tests/maintenance-history.test.ts` (new) | — | Pins the rules, and asserts the migration is additive only and that the store cannot leak across businesses | Part 5.3 | Strengthens | None | itself | Delete file |
| `prisma/migrations/20261120090000_maintenance_action/migration.sql` (new) | — | Creates the table, two indexes and one cascading foreign key. No DROP, no ALTER of an existing table, no data statement | Part 5.3, approved by owner | None; no permission change | Additive table only | `maintenance-history`, RLS 42/42 | Drop the table |
| `src/lib/platform-reliability/maintenance-history-store.ts` (new) | — | Business-scoped write, read and update, redacting again on write | Part 5.3 | Cannot cross a tenant boundary | Writes the new table | `maintenance-history` | Delete file |
| `prisma/rls/production-rls.sql` | Staged tenant list | Adds `MaintenanceAction` to the staged policy list so a new tenant table is never the unprotected one | Part 5.3, Part 6.1 | Keeps the plan complete; still not applied to production | Staged SQL only | RLS 42/42 | Revert line |
| `src/lib/platform-reliability/maintenance-window.ts` (new) | — | Decides whether a repair may run now, should wait for a quiet period, or is never automatic; unknown opening hours mean wait | Part 5.5 | Runs nothing, imports no database client | None | `maintenance-window` (30) | Delete file |
| `dashboard/reliability/page.tsx` | Version card | Adds "Repairs and their history" stating the honest not-enabled state and what a record will show | Parts 5.1-5.4 | Owner-only page | None | `maintenance-history`, `reliability-sections` | Revert file |
| `tests/accessibility-guard.test.ts` (new) | — | Static accessibility guard over the dashboard surfaces this expansion touched | Part 7.2 | Strengthens | None | itself | Delete file |
| `src/components/dashboard/Sidebar.tsx` | Clickable mobile backdrop with no aria state | Backdrop is `aria-hidden`; Close button is an explicit `type="button"` | Part 7.2 | None | None | `accessibility` | Revert file |
| `tests/security-sweep.test.ts` (new) | — | Fails when a route loses its guard, a tenant comes from the request, or FORCE RLS enters a migration | Part 6 | Strengthens | None | itself | Delete file |
| `docs/SECURITY-EXPANSION-REVIEW.md` (new) | — | Records what was verified and three findings | Part 6 | Documentation | None | — | Delete file |
| `src/lib/role-experience.ts` (new) | — | Per-role focus and boundary copy; unknown role fails closed | Part 7.1 | Grants nothing | None | `role-experience` | Delete file |
| `components/dashboard/RoleWelcomeCard.tsx` (new) | — | Renders the above above the today view | Part 7.1 | No new access | None | `role-experience` | Delete file |
| `dashboard/page.tsx` | Returned the today view | Returns the card plus the unchanged today view | Part 7.1 | Barber filter untouched | None | `role-experience` | Revert file |
| `TEMPLATE-VERSION.json` (new) | — | Version, date, release commit, Node requirement, migration count | Part 8.1 | None | None | `template-updates` | Delete file |
| `src/lib/template-version.ts` (new) | — | Mirrors the JSON for the running app | Part 8.1 | None | None | `template-updates` | Delete file |
| `src/lib/template-updates.ts` (new) | — | Classifies an upstream change; no I/O | Part 8.2 | None | None | `template-updates` | Delete file |
| `scripts/template-version.ts` (new) | — | `version`, `stamp`, `check` | Parts 8.1, 8.2 | Never writes business data | None | `template-updates` | Delete file |
| `api/dashboard/template-version/route.ts` (new) | — | Owner-only, read-only version report | Part 8.1 | `requireOwner` | None | `template-updates` | Delete file |
| `docs/TEMPLATE-UPDATES.md` (new) | — | The update process and its refusals | Part 8.2 | Documentation | None | `template-updates` | Delete file |
| `docs/ORGANIZATION-ARCHITECTURE-PROPOSAL.md` (new) | — | Parts 9 and 10 as a proposal | Parts 9, 10 | Proposal only | Proposal only | — | Delete file |
| `docs/MAIN-TEMPLATE-EXPANSION-BASELINE.md` (new) | — | Phase 0 audit and classification | Part 3 | Documentation | None | — | Delete file |
| `package.json` | Scripts | Seven new test/version scripts appended to `test:all` and `test:ci` | Part 11 | None | None | all | Revert file |

## 3. Completion dashboard

Percentages are computed from the requirement lists in the directive, not chosen. A
requirement counts only where a test or a file proves it; "a file exists" earns nothing.

| # | Category | Weight | Requirements | Done | Partial | Blocked | Not done | % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Core barbershop foundation | 15% | 20 | 19 | 1 | 0 | 0 | 95% |
| 2 | Solo barber and startup experience | 12% | 11 | 10 | 1 | 0 | 0 | 95% |
| 3 | Growing shop capabilities | 12% | 10 | 8 | 1 | 1 | 0 | 85% |
| 4 | Multi-location readiness | 8% | 10 | 1 | 0 | 0 | 9 | 10% |
| 5 | Franchise readiness | 5% | 9 | 1 | 0 | 0 | 8 | 11% |
| 6 | Security and data protection | 18% | 25 | 20 | 2 | 1 | 2 | 80% |
| 7 | Reliability Program | 12% | 16 | 14 | 1 | 0 | 1 | 94% |
| 8 | Nontechnical user experience | 10% | 12 | 11 | 1 | 0 | 0 | 96% |
| 9 | Client-copy and delivery process | 10% | 13 | 11 | 1 | 0 | 1 | 85% |
| 10 | Testing and release confidence | 8% | 10 | 7 | 1 | 2 | 0 | 75% |

Weighted overall: **87%** (Reliability 94% after the repair record landed; nontechnical UX 96% after the accessibility guard and the backdrop fix).

```
Core foundation        ███████████████████░  95%
Solo / startup         ███████████████████░  95%
Growing shop           █████████████████░░░  85%
Multi-location         ██░░░░░░░░░░░░░░░░░░  10%
Franchise              ██░░░░░░░░░░░░░░░░░░  11%
Security               ████████████████░░░░  80%
Reliability            ███████████████████░  94%
Nontechnical UX        ███████████████████░  96%
Client delivery        █████████████████░░░  85%
Testing confidence     ███████████████░░░░░  75%
                       ─────────────────────
Weighted overall       87%
```

Why the security category is not higher: RLS is implemented and proven offline but
deliberately not enabled in production, which the directive itself requires to stay blocked
until its staged plan is approved. Why testing is not higher: the suite is green locally and
the build succeeds, but CI has not run on this branch and no staging deployment exists.

## 4. WHAT STILL NEEDS WORK

1. ~~Maintenance history table.~~ **Done, on your approval (2026-11-20).** The additive
   `MaintenanceAction` table is created and applied to the test database, the schema model and
   the `Business` back-relation exist, and the store writes and reads with redaction applied a
   second time on the way in. Proven: a record written with a key-shaped value stores
   `[removed]`, one business cannot read or change another's records, and the RLS enforcement
   test confirms the new table is in the staged policy file rather than left unprotected.
2. **RLS activation.** The staged plan exists and its 42 offline checks pass. Enabling it in
   production is a tenant-isolation change and stays blocked on approval.
3. **Gift-card RLS inconsistency.** Three tables have RLS enabled with no policies by an
   earlier migration. Inert for the owner connection, inconsistent with the plan. Fixing it
   is a tenant-isolation change, so it is recorded, not changed.
4. **Accessibility: static guard in place, human audit still needed.** `tests/accessibility-guard.test.ts`
   (44 assertions) now fails on a click handler on a non-interactive element, an image without
   alt text, an unlabelled input, a section with no heading, a skipped heading level, or a hard
   pixel width. It found a real defect: the mobile menu backdrop was a clickable div with no
   accessible close path of its own. It is now `aria-hidden`, and the real Close button carries
   `type="button"`. A keyboard and screen-reader walkthrough by a person is still not something
   this repo can claim.
5. **Remaining reliability automation.** Patch-update pull requests and the scheduled
   maintenance report are specified but not automated; the classification, the honest
   reporting and the repair record rules are implemented.
6. **Co-owner invitations** in the growing-shop stage: staff invitations exist, a distinct
   co-owner invitation flow does not.
7. **Multi-location and franchise implementation.** Proposal only, by design.
8. **Referral attribution and per-barber growth analytics** from the competitive review:
   listed as planned in the stage model, not built.
9. **CI on the branch and a staging deployment** with real Stripe, Twilio, Upstash and SMTP
   credentials.
10. **`docs/CURRENT-STATUS.md`** should be regenerated to include this expansion; it still
    describes the state before it.

## 5. PRODUCTION LAUNCH BLOCKERS

These are immediate and separate from future franchise work.

1. Production secrets and integrations are unset in this environment: Stripe keys and
   webhook secret, Twilio, SMTP, Upstash. Booking and payments cannot be proven end to end
   without them.
2. RLS is not enabled in production; the application connection currently relies on
   server-side authorization alone, which is verified but is a single layer.
3. No staging deployment has run this branch.
4. CodeQL has not run; 10 alerts remain open in the baseline record.
5. The three-table RLS inconsistency above should be reconciled before RLS is switched on.

## 6. What was preserved

Booking, appointments, customers, barbers, commissions, payroll, time clock, memberships,
gift cards, e-commerce, inventory, marketing, waitlist, reviews, website customization, SEO,
payments, email and SMS, audit logging, backups, security middleware, deployment
configuration and GitHub Actions are unchanged in behaviour. The regression suite that
covers them is the evidence: 75 suites, exit 0.

## 7. Rollback

Revert the merge commit. Nothing in this branch alters existing columns or data, so a revert
restores the previous behaviour with no data loss. The one schema addition is a nullable
column with a default of null; if it must be removed, drop it after the revert.
