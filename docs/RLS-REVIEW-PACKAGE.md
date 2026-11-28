# RLS review package

Production RLS remains **off**. This review does not enable it, alter database roles,
or connect to any database. The revised policy template and harness have not yet been
executed in PostgreSQL after the changes below.

## Current code changes

- The planner now treats `User` as shop-scoped because the model has `businessId`, and
  statically checks every classified model against its policy class.
- The staged policy now includes indirect scopes for `Schedule`, `OrderItem`, and
  `TwoFactorRecoveryCode`; organization invitations; and both scopes for models carrying
  shop and organization keys.
- Platform RLS access is role-based (`barber_platform` membership), not a custom session
  variable. Stage 1 no longer grants that group to `barber_app`.
- The status and reconciliation tools require explicit database URLs and do not fall back
  to `DATABASE_URL`. The status report checks `FORCE ROW LEVEL SECURITY` as well as policy
  presence.
- Gift-card detail reads now use `withTenant()` and filter ledger rows by both the card
  and business identifiers, with an adversarial regression fixture.

## Evidence available

| Claim | Evidence / state |
|---|---|
| Model classification | `scripts/rls-plan.ts --check`; static comparison in `tests/rls-reconciliation.test.ts` |
| Gift-card scoped history query | `tests/gift-cards.test.ts` (database-backed; not run in this environment) |
| RLS policy execution | Not run after this update; requires isolated PostgreSQL test setup |
| Application runtime with RLS enabled | Not proven; no staging run as `barber_app` |
| Organization context | Not wired; no application helper currently sets `app.current_organization_id` |
| Support authorization and audit from app route | Not proven by the RLS harness; existing platform API gates/audit still need route-level review |
| Production RLS / production role configuration | Not inspected or changed |

## Remaining rollout gates

Before any staging or production enforcement, prove the role attributes and table ownership,
complete business and organization transaction-context adoption, run the full suite as the
non-owner runtime role, test concurrent pooled requests, verify support operations are
explicitly authorized and audited, and rehearse rollback on an isolated staging database.
See `docs/RLS-STAGING-PLAN.md`. Never claim production enforcement from a static policy file
or a disposable harness run.
