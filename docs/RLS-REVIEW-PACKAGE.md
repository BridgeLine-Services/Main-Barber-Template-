# RLS review package

For the owner's review before production RLS is considered. Nothing here enables
anything. Production RLS is **off**, and stays off until this review and the staging
gates are both signed off.

## What changed in this round

`production-rls.sql` read `app.business_id` in all seven policies while
`src/lib/tenant-context.ts` writes `app.current_business_id`. The enforcement suite
passed because it set the old name itself, so it proved the policies work when handed a
name the application never writes. Enabling RLS as it stood would have denied every
tenant query in production while every test stayed green.

Policies and the suite now use one name. CI proves 42 checks against a real PostgreSQL
service with `RLS_TEST_REQUIRED=true`, so a skipped run is a failure, not a pass.

`tests/rls-context-name.test.ts` (13 assertions) pins the agreement: one tenant setting,
written by the helper and read by the policies; `app.platform_staff` as the only other
setting policies may read; the helper never granting itself platform access; fail-closed
when unset; no persistent `SET`.

## What is proven, and where

| Claim | Evidence |
|---|---|
| Per-tenant isolation | 42 checks in CI, `tests/rls-enforcement.test.ts` |
| Fail-closed with no tenant | Same suite |
| Cross-tenant INSERT refused | Same suite |
| UPDATE/DELETE affect 0 rows | Same suite |
| Setting cleared at COMMIT and ROLLBACK | Same suite |
| Policies read the setting the app writes | `tests/rls-context-name.test.ts` |
| Role names consistent | `stage-1-roles.sql` and `production-rls.sql` both use `barber_*` |

## What is not proven

- No staging database has run the application as `barber_app` with RLS on.
- Role attributes have not been read back from a live server (`rolsuper`, `rolbypassrls`,
  table ownership).
- Concurrent pooled transactions have not been exercised with the application, only with
  the test harness.
- Platform support access has not been exercised from an application route.
- Rollback has not been rehearsed against a copy of production data.

These are the gates in `docs/RLS-STAGING-PLAN.md`. They need a staging database, which is
an owner action, not a code change.

## The risk to weigh

RLS is a second line of defence behind the application's own tenant scoping, which is
already enforced and tested. Turning it on before the staging gates pass converts an
untested configuration into a production outage: every query without transaction-local
context fails closed. The safer sequence is staging first, then production with a
documented rollback, which is why this remains blocked rather than done.
