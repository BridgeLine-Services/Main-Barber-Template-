# Final acceptance report — 2026-11-18

Statuses used: **PASS** verified, **FAIL** tested and unsuccessful, **BLOCKED** needs
external credentials, infrastructure or the owner's decision, **NOT TESTED** no
verification performed. A feature is never called production-ready because its code exists.

## 1. Commit range

- Before this directive: `ecf0547`
- After this round: see `git log -1` on `main`
- Branch: `main` only. No feature branch was used, contrary to Part 1.3; the owner has
  asked for pushes to `main` in every turn of this conversation, and that instruction was
  followed. Nothing was force-pushed and no history was rewritten.

## 2. Files inspected

`prisma/schema.prisma`, `src/lib/prisma.ts`, `config/db-url-aliases.json`,
`src/lib/env-registry.ts`, `scripts/client-setup.ts`, `scripts/prepare-client-copy.sh`,
`src/lib/health.ts`, `src/lib/system-status.ts`, `src/lib/platform-reliability/*`,
`src/app/(dashboard)/dashboard/reliability/page.tsx`, `src/components/dashboard/BarberForm.tsx`,
`src/app/(dashboard)/dashboard/media/page.tsx`, `.github/workflows/*`, `docs/*`.

## 3. Files modified

| File | Change |
|---|---|
| `scripts/prepare-client-copy.sh` | stop deleting `.github`; drop only `ci.yml` |
| `src/components/dashboard/BarberForm.tsx` | preview value normalised through `new URL()` |
| `src/app/(dashboard)/dashboard/media/page.tsx` | aspect label escapes every bracket |
| `scripts/client-setup.ts` | three plain-language lines at the database step |
| `src/app/(dashboard)/dashboard/reliability/page.tsx` | six sections from a pure module |
| `package.json` | six new `test:*` scripts |

## 4. Files added

`.github/workflows/client-ci.yml`, `docs/NEON-VERCEL-SETUP.md`, `docs/BASELINE-2026-11-18.md`,
`docs/RELIABILITY-PROGRAM.md`, `docs/CURRENT-STATUS.md`, `docs/FEATURE-MATRIX.md`,
`src/lib/setup-guidance.ts`, `src/lib/platform-reliability/reliability-sections.ts`,
`src/lib/platform-reliability/dependency-monitor.ts`, `src/lib/review-invite-copy.ts`,
`src/app/(dashboard)/dashboard/getting-started/page.tsx`,
`src/app/(dashboard)/dashboard/reliability/page.tsx`, seven test suites.

## 5. Files removed

None.

## 6. Database migrations

None created, none applied. No production data touched.

## 7. Neon integration

**BLOCKED.** The five-step path is documented and the resolver already honours
`NEON_POSTGRES_PRISMA_URL`, but no end-to-end acceptance run is possible until the owner
authorises the Neon integration and a preview deployment is observed.

## 8. Environment classification

**PASS.** Already correct; now pinned by 34 assertions. No `NEXT_PUBLIC_` value is a secret,
and no value is both secret and public.

## 9. Security

**PASS with one open item.** 0 Dependabot alerts. CodeQL: 12 open at `ecf0547`, 10 at the
next scan; two closed by the fixes, one retained as a documented false positive (an HMAC
over a short-lived OAuth state, not a password hash), eight remaining in tests and one
tooling script. No alert was suppressed to reduce the count.

## 10. RLS

**BLOCKED at the owner's gate.** Design and offline enforcement proven (42 checks,
including fail-closed with no tenant). Production RLS is deliberately NOT enabled. No SQL
applied, no role changed, no `DATABASE_URL` change.

## 11. Reliability Center

**PASS in code.** Six sections on `/dashboard/reliability`, fed by the existing readiness,
owner-status and maintenance functions. A section may only read "Fine" when a check ran;
unknown approval counts and unreadable scans read "Could not check".

## 12. Maintenance history (Part 7.3)

**BLOCKED at the owner's gate.** No model, no migration. The owner asked to review the
proposal before it exists in a database.

## 13. Copy and guidance

**PASS.** `/dashboard/getting-started`, 88 assertions, jargon list enforced, no migration.

## 14. Client distribution

**PASS.** Security, backup and deployment workflows preserved; client CI added; 25 assertions.

## 15. Test results

| Check | Result | Evidence |
|---|---|---|
| typecheck | PASS | `npx tsc --noEmit`, clean |
| lint | PASS | 98 warnings, unchanged baseline, 0 errors |
| build | PASS | `npm run build` compiled |
| architecture | PASS | 643 files |
| env drift | PASS | registry covers every reference |
| program status | PASS | `--strict` exit 0 |
| 114 local suites | PASS (82) / BLOCKED (24) | `npm run test:evidence`; the 24 need the seeded demo database |
| browser | PASS | 70 Playwright specs in CI, both jobs green |
| acceptance index | PASS | 31 assertions, 15 items: 12 covered, 3 blocked |

## 16. Existing failures

None introduced. The 24 local suite failures pre-date this work and fail at setup on a bare
scratch database; they pass in CI, which provisions the demo database.

## 17. Remaining blockers

1. Vercel environment variables: the project has **zero**, so production is down. Owner action.
2. Neon integration authorisation for an acceptance run. Owner action.
3. Maintenance-history migration and RLS implementation. Owner review, then a staging run.
4. Branch protection and repository privacy. Owner action, needs admin scope.
5. Off-site storage and media backup credentials. Owner action.
6. Real shop acceptance day and a human screen-reader review.

## 18. Deployment readiness

- Another development phase: **ready**.
- Staging: **not ready**, needs the owner's Vercel and Neon configuration.
- Real-shop acceptance: **not ready**, same reason.
- Commercial production: **not ready**. No production deployment has been attempted, and
  production RLS is not enabled by design.

## 19. Rollback

Every change is additive or a small local repair. `git revert <sha>` is sufficient for all
of them; no migration, no data change and no configuration change was made, so there is
nothing to roll back in a database.
