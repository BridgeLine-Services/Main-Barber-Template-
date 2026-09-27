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

## Database-level RLS (optional, deployment infrastructure)

The application layer above is the enforced isolation mechanism shipped
in the repository. Some deployments additionally want PostgreSQL Row
Level Security as defense-in-depth. RLS is **not enabled in this
repository's migrations** because Prisma uses a single pooled database
role and cannot safely set per-request session variables — enabling RLS
without that wiring would either be bypassed (table-owner connections) or
break all queries (FORCE RLS with no `app.business_id` set). We do not
ship fake security.

To add real RLS in production, the DBA must:

1. Create a dedicated non-owner database role for the application
   (`app_user`), grant `SELECT/INSERT/UPDATE/DELETE` on all tables.
2. Enable RLS with `FORCE ROW LEVEL SECURITY` on business-scoped tables.
3. Add policies keyed on `current_setting('app.business_id')::text`.
4. Refactor data access to set `app.business_id` per request inside a
   Prisma interactive transaction (`$transaction` +
   `SELECT set_config('app.business_id', $1, true)`), so reads/writes run
   on the same connection that carries the variable.

These steps are external infrastructure + a data-access refactor and are
documented here as the explicit production checklist; they are not
claimed to be active.

## Adding a new business-scoped route (checklist)

- Resolve `businessId` from the session (never the request body/query).
- Filter every Prisma query by it, including lookups by unique id.
- Use `requireOwner`/`requireStaff` + `src/lib/permissions.ts` `can()`.
- Audit destructive actions (`logAudit`).
- Add a case to `tests/cross-tenant-matrix.test.ts`.
