# Staging environment (Priority 4)

A staging environment is only useful if it is the same shape as production. This document
lists what must match, how to prove it matches, and what must never be copied into it.

## Must match production

| Item | Why |
| --- | --- |
| Commit | A test that passes on a different commit proves nothing |
| Migration set | `prisma migrate deploy` on an empty database must reach the same schema |
| Node.js major | The compatibility matrix treats an out-of-line runtime as unsupported |
| Runtime database role | Isolation behaviour differs between the owner role and `barber_app` |
| Environment variable **names** | A missing variable is a configuration bug, and staging should reveal it |
| Feature flags | A flag that is on in production and off in staging hides the bug you are hunting |

## Must never be copied into staging

- Real customer records, phone numbers, emails or addresses.
- Production secrets. Staging gets its own, and they are rotated separately.
- Payment provider live keys. Staging uses test keys.
- Real backups. Restore drills use a sanitised copy.

Seed data uses RFC 2606 reserved domains (`.invalid`, `.example`, `.test`), which
`tests/architecture.test.ts` enforces for fixture routes.

## Proving staging matches

```bash
# 1. Schema parity: this must print "No difference detected."
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code

# 2. The suites that exercise isolation
npm run test:tenant
npm run test:organization
npm run test:rls-reconcile

# 3. The runtime role can do its job without RLS policies
DATABASE_URL="$STAGING_APP_ROLE_URL" npm run test:tenant
```

## The staged database-role switch

The RLS plan is deliberately not enabled. Enabling it has two separate, reversible steps:

1. **Role switch, no policies.** Point the runtime at `barber_app`, which is not a superuser,
   does not bypass RLS and does not own the tables. Run the full suite. This proves the role
   has the grants the application needs, before any policy can deny a query.
2. **Apply policies.** Follow `docs/RLS-STAGING-PLAN.md`. Verify with
   `npm run db:rls-status` and `npm run db:rls-reconcile`.

Step 1 is safe to reverse by pointing the connection string back. Step 2 is reversible per
table with `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`, but should be treated as a
production change and approved as one.

## Known staging gaps

- **Gift-card tables have RLS enabled and no policy** until the staged plan is applied.
  `npm run db:rls-reconcile` reports this and prints the exact policy. It is harmless on the
  owner role and would be a fail-closed outage on the runtime role, so the role switch in
  step 1 must not be attempted until the policies are applied.
- No automated teardown of staging data yet; seeding is idempotent but not reversible.
