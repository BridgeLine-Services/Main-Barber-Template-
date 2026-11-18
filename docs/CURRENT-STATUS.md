# Current status

Last updated: 2026-11-18. The authoritative document for where this repository
actually stands. Supersedes the status sections of earlier reports; those remain
for history.

## Repository baseline

- Branch `main`, tree clean.
- Runtime: Node 24 (`.nvmrc` 24, `engines.node` `>=24`, CI both jobs on Node 24).
- Framework: Next 16.4.6, React 19.3, Prisma 6.19.3, TypeScript 5.5.
- Database: PostgreSQL 15; production RLS **deliberately not enabled**.

## Test status

| Gate | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, 98 warnings, 0 errors (baseline) |
| `npm run build` | PASS |
| `npm run architecture:check` | PASS, 640 files |
| `npm run env:drift` | PASS, 98 declared / 76 referenced |
| `npm run test:evidence` | 106 suites: 82 pass locally; 24 need the seeded demo database and pass in CI |
| Playwright (70 specs) | PASS in CI |
| RLS enforcement | PASS, 42 checks (both CI jobs) |
| Tenant isolation | PASS, 22 checks |

A suite that did not run is not a passing suite. The 24 local failures are setup
failures on a scratch database, named individually in `docs/REGRESSION-EVIDENCE.md`.

## Security status

- Dependabot: **0 open** alerts.
- CodeQL: **10 open**, all high: six test-only URL assertions, two in
  `scripts/a11y-static.mjs`, one in `BarberForm.tsx` (sink now normalised through
  `new URL()`; scan pending), one retained false positive in `google-business.ts`
  (HMAC over short-lived OAuth state, `timingSafeEqual` — changing it would weaken
  a real control).
- No alert is suppressed to lower the count.

## Completed

Branding (eight identities, guide, recommendation assistant, comparison grid,
brand setup page), homepage modules with stage suggestions, SEO health page,
review invites panel, Reliability Program logic and owner screen, dependency
monitor, Node 24 migration, regression evidence tooling, program status tooling.

## Outstanding development

- Published homepage version history (schema holds one snapshot; multi-version
  history would need an additive table and an approved migration).
- Onboarding guidance copy per step.
- Role-based dashboard polish for co-owner and barber views.

## External launch blockers (owner actions)

1. Vercel project environment variables: `DATABASE_URL`, `NEXTAUTH_SECRET`,
   `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`. Without them every deployment fails.
2. Repository privacy and GitHub template mode.
3. Branch protection on `main`.
4. Provider-managed backups / PITR.
5. Independent off-site backup storage and key.
6. Media backup credentials.
7. Critical alert webhook.
8. Human accessibility review with a screen reader.
9. Legal review of policies.
10. Real barbershop acceptance day.
11. Full client-copy rehearsal (the five-step distribution).

## Runtime support

Node 24 is supported and verified in CI. Node 26 is not adopted: not documented as
supported by Next 16 or Prisma 6. Vendor end-of-life data is not fetched by the
application, so the Reliability Program reports support as "could not check"
rather than guessing.

## Next approved phase

Phase 5 (onboarding and dashboard usability), then Phase 6 (security and
regression re-verification), then Phase 7 (release readiness and final report).
Franchise expansion stays deferred.
