# Final release acceptance — external items

Created 2026-11-05 on branch `fix/final-commercial-readiness`, baseline `eb05d8f`.

This file exists because a source-code pass cannot close these items. Every line below
was checked against the repository, and none of them is satisfied by code in it. The
columns are deliberate: **Evidence needed** is the thing to show someone, not the thing
to believe.

## Release recommendation

**READY AFTER EXTERNAL ACCEPTANCE.** See the end of this file for what that means.

## A. Mandatory before the first paying client

| # | Item | State | Evidence needed to close |
| --- | --- | --- | --- |
| 1 | Upstash configured in Preview and Production | Not done | `npm run client:preflight` returning ✅ for the rate-limit store in the target environment |
| 2 | Neon/PostgreSQL production database configured | Not done | A successful `npx prisma migrate deploy` against the production URL, in the Vercel build log |
| 3 | Production migrations applied | Not done | `npx prisma migrate status` reporting "Database schema is up to date!" |
| 4 | `NEXTAUTH_SECRET` configured | Not done | Set in the host's environment settings (never in the repo); a signed-in session surviving a restart |
| 5 | Public application URL configured | Not done | `NEXTAUTH_URL`/`NEXT_PUBLIC_APP_URL` pointing at the real domain; sign-in redirect landing on the dashboard |
| 6 | First-owner registration tested on the real deployment | Not done | A screenshot or log of the first owner account created on the deployed instance |
| 7 | Hosting plan appropriate for commercial use | Not owner-decided | Chosen plan, with the concurrency and cron limits noted against expected shop traffic |
| 12 | Production backups configured | Not done | Provider backup schedule and retention visible in the provider dashboard |
| 13 | Production restoration rehearsed | Not done | A dated restore of a real backup, with a person signing in to the restored shop afterwards |
| 14 | Monitoring and alerts configured | Not done | An alert delivered to a human for a deliberately failed health check |
| 15 | Human accessibility assessment | Not done | A written report from someone using a screen reader. Automated axe checks are not this |
| 16 | Legal documents approved by counsel | Not done | `docs/LEGAL-PLACEHOLDERS.md` reviewed and signed off by a qualified lawyer in the operating jurisdiction |
| 17 | Master repository made private | Not done | Repository visibility setting. Only the owner can change it, and this task must not |
| 18 | Main branch protection configured | Not done | Branch protection rule requiring the Template CI check |
| 19 | Client deployment procedure documented and rehearsed | Partly documented | One full copy-and-configure run performed against a second account, timed and recorded |

## B. Optional integrations — required only if the feature is offered

A disabled optional feature is not a working service. Nothing in this table is claimed
to work; each is off by default or fails closed until configured.

| Feature | Provider | State | Notes |
| --- | --- | --- | --- |
| Online payments | Stripe | Not tested against Stripe | `onlinePayments` defaults off and fails closed; `npm run test:optional-integrations` proves the gate logic only, with no network call |
| Email notifications | SMTP | Not tested against a real mail server | In-person payments and dashboard access are unaffected when unset |
| SMS notifications | Twilio | Not tested against Twilio | Worker skips the send and logs a plain reason when unconfigured |
| Review requests | depends on email/SMS | Gated off | Cannot work before one of the above is configured |
| CSP nonce in staging | hosting headers | Not accepted | Nonce generation exists; it has not been observed in a staging response |
| Media backups | storage provider | Not configured | Uploads live outside the database, so no database backup covers them |
| Off-site backup copy | any | Not configured | A provider incident currently takes the primary and its backups together |

## C. What has actually been verified, and where

Verified locally on `5c17945` (see the commit message and `docs/TESTING.md` for the
method): `prisma validate`, `prisma generate`, typecheck, lint (0 errors), 
`architecture:check` (601 files), `test:architecture`, `client:independence`,
`env:drift` (0 across 546 files), `test:ci`, production `build`, Playwright
(68 passed, 1 skipped), `test:a11y` (8 passed), `test:optional-integrations` (20 passed).

Verified in CI on `eb05d8f` (`main`): Template CI run 42166463819, `success`, which
includes migration deployment to a real Postgres service, the seed, the backup and
restore verification, the production build and the browser suite.

Not verified anywhere: any real third-party provider, any production infrastructure, and
any human accessibility or legal review.
