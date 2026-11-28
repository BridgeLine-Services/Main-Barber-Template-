# Tenant Isolation & Data-Scoping Model

How the master template guarantees that one business can never see,
modify, export, or delete another business's data — in code, over HTTP,
and (where a deployment chooses to enable it) at the database level.

## Isolation model

Every business-scoped table carries a `businessId` foreign key. The
application enforces isolation at every layer:

1. **Authentication** — every dashboard API route requires a signed-in
   session (`requireAuth` / `requireOwner` / `requireStaff` in
   `src/lib/auth-helpers.ts`); the business is resolved **from the
   authenticated session's database user**, never from a client-supplied
   `businessId`.
2. **Authorization** — role + business checks are server-side only
   (`src/lib/permissions.ts`, `src/lib/auth-helpers.ts`).
3. **Query scoping** — all Prisma reads/writes include
   `where: { businessId }` from the session-resolved business. Lookups by
   id (e.g. `/api/dashboard/appointments/[id]`) always filter by BOTH the
   route id AND the caller's `businessId`, so a foreign id is simply
   "not found" (404) rather than reachable.
4. **Exports** — CSV/export endpoints are business-scoped and audited
   (see `tests/cross-tenant-matrix.test.ts`).
5. **Destructive actions** — additionally require owner permission,
   business membership of the target, and audit entries.

Public customer routes (booking, appointment lookup by token) are
intentionally token-scoped: the random `customerAccessToken` / portal
verification secret IS the authorization. These tokens are long
cryptographic secrets scoped to a single appointment or customer.

## Platform owner role

`PLATFORM_OWNER` accounts are business-independent and administer
businesses through the platform console (`/platform`) and
`/api/platform/businesses`. They never gain access to a business's
dashboard context by default. See `docs/ARCHITECTURE_CONSTITUTION.md`.

## Automated verification

| Suite | What it proves |
| --- | --- |
| `tests/cross-tenant-matrix.test.ts` | HTTP-level IDOR matrix: an authenticated owner of Business A attempts GET/PATCH/DELETE/POST against ~20 route groups using Business B's ids — every attempt blocked, no data leaked, B's rows byte-identical afterwards. Also: list/CSV export/audit/analytics endpoints contain no B data, anonymous access rejected. |
| `tests/tenant-isolation.test.ts` | DB-query-level scoping (business-scoped queries return only own rows; cross-tenant filters return nothing). |
| `tests/platform-owner.test.ts` | Platform/business role boundaries and privilege preservation. |
| `tests/ownership-transfer.test.ts` | Ownership transfer stays within one business. |

Run: `npm run test:tenant`, `npx tsx tests/cross-tenant-matrix.test.ts`,
`npm run test:platform` (server on :3000 + `DATABASE_URL` required).

## Database-level RLS (staged; not production-enforced)

Application-level checks remain the active protection. PostgreSQL RLS is not enabled
in production, and this repository does not have evidence that its deployed runtime
uses a non-owner role or that every protected query sets the correct tenant context.
Do not enable RLS or change a production connection as part of routine application
work.

`prisma/rls/production-rls.sql` is a staged template, not a migration. It sets
`app.current_business_id` and `app.current_organization_id` policies transactionally;
`src/lib/tenant-context.ts` currently sets only the business context and is adopted by
selected service and route paths. Organization APIs do not yet set an organization
context, and many tenant-sensitive queries remain outside `withTenant()`. The app has
not been proven end-to-end as `barber_app` with RLS enabled.

The schema planner classifies every Prisma model. Static reconciliation tests compare
tenant-root, direct, indirect, and organization-scoped models with the staged policy
lists. `scripts/rls-status.ts` checks `ENABLE`, `FORCE`, and policy presence only when
provided an explicit `RLS_STATUS_DATABASE_URL`; `scripts/rls-reconcile.ts` similarly
requires `RLS_RECONCILIATION_DATABASE_URL`. Only point either at a positively
identified disposable or staging database. They never infer a target from
`DATABASE_URL`.

The gift-card migration enables RLS on `GiftCardSettings`, `GiftCard`, and
`GiftCardTransaction` without creating policies. The staged SQL now supplies the
business policy for all three; this closes the design gap in the template only. It
does not prove a deployed database has received the policy. The template also scopes
`Schedule`, `OrderItem`, and `TwoFactorRecoveryCode` through their tenant-bearing
parents and includes organization invitations plus dual shop/organization rows.

`tests/rls-enforcement.test.ts` exercises staged SQL on an isolated scratch database
when its explicit `RLS_TEST_*` settings are provided. Its session-variable platform
bypass check does **not** prove that application support operations are authorized
and audited. That proof and the runtime role/context gates remain prerequisites.

See `docs/RLS-STAGING-PLAN.md` for the gated rollout. Production RLS remains off until
the role split, full application context coverage, staging verification, support-path
audit proof, backup, and explicit production approval are all complete.

## Adding a new business-scoped route (checklist)

- Resolve `businessId` from the session (never the request body/query).
- Filter every Prisma query by it, including lookups by unique id.
- Use `requireOwner`/`requireStaff` + `src/lib/permissions.ts` `can()`.
- Audit destructive actions (`logAudit`).
- Add a case to `tests/cross-tenant-matrix.test.ts`.
