# Current status

> 2026-11-20: priorities 1 to 5 of the master prompt were implemented to the extent recorded in
> `docs/PRIORITIES-1-5-STATUS.md`. That document is authoritative for what is done and what is not;
> this file describes the state before that pass.


Last updated: 2026-11-19, after the expansion branch `expansion/phase-0-8` was merged into
`main` at `5169c79`. This is the authoritative document for where the repository stands.

## Repository baseline

- `main` at `5169c79`; the pre-expansion baseline was `70e20b7`.
- Runtime: Node 24 (`.nvmrc` 24, `engines.node` `>=24`, CI both jobs on Node 24).
- Framework: Next 16.4.6, React 19.3, Prisma 6.19.3, TypeScript 5.5.
- Database: PostgreSQL 15; production RLS **deliberately not enabled**.
- Template version: 1.1.0 (`TEMPLATE-VERSION.json`).

## Test status (local, this machine)

| Gate | Result |
| --- | --- |
| `npm run test:ci` | PASS, exit 0, 78 suites green |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, 0 errors, 98 warnings (unchanged from baseline) |
| `npm run build` | PASS, 75/75 static pages (needs `DATABASE_URL` and `NEXTAUTH_SECRET`) |
| `npm run architecture:check` | PASS, 671 files |
| `npm run test:tenant` | PASS, 22 |
| `npm run test:permissions` | PASS, 37 |
| `npm run test:backup` | PASS, 142 checks |
| RLS enforcement | PASS, 42/42 with local admin credential supplied |
| New this cycle | `test:growth-stages` 71, `test:support-sources` 48, `test:security-sweep` 52, `test:template-updates` 56, `test:role-experience` 71, `test:maintenance-history` 75, `test:maintenance-window` 30, `test:accessibility` 44 |

Not executed: GitHub Actions on this branch, CodeQL, and any run against staging with real
Stripe, Twilio, Upstash and SMTP credentials.

## What exists now that did not before

- **Growth stages.** Five stages (independent barber, growing shop, established shop,
  multi-location, franchise) with per-capability availability, an owner-declared direction
  stored in a nullable column, honest progress that counts unknown as unknown, and a clear
  split between what is ready and what is not built.
- **Vendor support sources.** Every dependency finding carries its source, the date it was
  checked, and security and compatibility notes; anything unchecked says "Could not check
  this information" rather than showing green.
- **Security sweep.** An executable guard that fails when a route loses its guard, when a
  tenant id is taken from the request, or when `FORCE ROW LEVEL SECURITY` appears in a
  migration, plus `docs/SECURITY-EXPANSION-REVIEW.md`.
- **Role views.** Each role is told what its page is for and what it cannot do; an unknown
  role falls back to the visitor view.
- **Template identity and updates.** Version stamp, owner-only version endpoint, and a
  read-only update check that classifies changed files and never applies anything.

## Deliberately not done

- Multi-location and franchise: proposal only (`docs/ORGANIZATION-ARCHITECTURE-PROPOSAL.md`).
- Maintenance history: implemented and switched on, after the owner approved the additive
  `MaintenanceAction` table (migration `20261120090000_maintenance_action`). Records are
  business-scoped, redacted on write, and the table is in the staged RLS policy list.
- RLS activation: staged plan unchanged and still awaiting approval.
- Gift-card RLS inconsistency (three tables enabled with no policies): recorded, not changed,
  because fixing it is a tenant-isolation change.

## Launch blockers

1. Production integrations unset here: Stripe, Twilio, SMTP, Upstash.
2. RLS not enabled in production; authorization currently relies on the server-side layer.
3. No staging deployment has run this branch.
4. CodeQL has not run; 10 baseline alerts remain open.

Full detail, per-file change table and the weighted completion dashboard:
`docs/MAIN-TEMPLATE-EXPANSION-REPORT.md`.
