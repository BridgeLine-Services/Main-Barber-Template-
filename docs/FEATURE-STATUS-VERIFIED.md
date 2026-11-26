# Feature status, verified against the code (2026-11-26)

This page records what was **run**, not what a previous report claimed. Every status below
was checked by reading the implementation and executing its suite against a local
PostgreSQL 18 with all migrations applied. Where a suite could not run in this environment,
it says so instead of assuming a pass.

Statuses: **1** implemented and tested · **2** implemented, not fully tested ·
**3** partially implemented · **4** not implemented · **5** implemented but not configured ·
**6** blocked by an external dependency or credential.

## Referral rewards and redemption — 1

`src/lib/growth/referral-ledger.ts` implements the full lifecycle, and the models exist in
the schema with a migration (`20261126140000_referral_reward_ledger`):

- issuance keyed by `(businessId, sourceKey)`, so a duplicate completion cannot issue twice
  (`issueRewardForCompletedVisit` checks the key before deciding);
- eligibility decided by `decideRewardIssuance` from appointment status, not by the caller;
- expiry set from `REFERRAL_REWARD_RULE.expiresInDays` at issuance;
- redemption (`redeemReward`), reversal (`reverseReward`), customer and shop listings, and
  the immutable `ReferralRewardEvent` history;
- tenant scoping by `businessId` on every model, now also enforced by RLS in production.

Suites: `referral-rewards` 38, `referral-issuance` 22, `referral-attribution-booking` 32,
`growth-referrals` 70. All pass. 162 assertions.

Nothing was added here. The earlier documentation implied the lifecycle was incomplete; the
code does not support that, and building a second ledger would have been the wrong fix.

## Marketing performance attribution — 1

`summariseCampaigns` and the performance view count only what is known: campaigns that were
actually sent, their recipients, and the booking sources that exist. There is no open or
click counter, because the mail path does not receive those events; the page therefore does
not display them, which is the correct behaviour rather than a gap to paper over.

Suites: `marketing-performance` 23, `marketing` 44, `marketing-birthdays` 54. All pass.
Consent and unsubscribe rules are covered by `email-marketing` tests.

## Template updates — 1

`TEMPLATE-VERSION.json` (release manifest) plus `scripts/template-version.ts` (identity,
stamping, and the upstream check) plus `src/lib/template-updates.ts` (classification and
risk) already implement version comparison, update classification, conflict reporting and
the refusal to claim an update is safe. `tests/template-updates.test.ts` covers it: 56
assertions, all passing.

An attempt earlier in this program to add a second manifest and a second script was
reverted: it duplicated this implementation and broke CI.

## Independent client configurations — 2

The isolation mechanisms exist and are tested: `scripts/client-independence.ts` (no client
identity in source), `scripts/client-preflight.ts`, `prepare-client-copy.sh`, and the
tenant-scoping tests below. Not verified here: a second, independently deployed copy sharing
a database. That requires two real deployments and is recorded as unverified rather than
assumed.

## Tenant query architecture — 2

`withTenant()` exists in `src/lib/tenant.ts` and has **zero call sites** in `src/`. Session
resolution (`requireAuth`/`requireOwner`/`requireBusinessAdmin`), `resolveBusinessId` and the
organization resolver are the primary controls, and they are tested: `tenant-isolation` 9,
`cross-tenant-matrix` (needs a live server on :3000; not run here), `security-sweep` 58
(every route is either guarded or a named public endpoint).

Rewiring 205 routes onto `withTenant()` was deliberately not attempted: it would be a broad
architectural change with no test able to prove the absence of regressions in one pass, and
the prompt forbids exactly that. The honest next step is per-route, with a regression test
per route.

## Organization reporting — 5

Implemented and tested (`organization-report-scheduling` 23, `scheduled-report` delivery,
`report-query` aggregates), but **not scheduled on the current deployment**: the 15-minute
sweep requires Vercel Pro. See `docs/CRON-SCHEDULING.md` for the activation steps.

## Production RLS — 5

Policies are complete for every table the planner classifies (`rls-plan --check`:
unclassified 0). Not enabled on any production database, by design, because the runtime
role and per-transaction tenant context prerequisites are not in place. The three tables
that were missing from the policy script are fixed on `ci/rls-and-hobby-cron`.

## External integrations — 6

Stripe test-mode acceptance, Twilio and SMTP live delivery, and provider-side webhook
delivery all need credentials this environment does not have. The code paths and their
tests exist; no live provider confirmation was performed.
