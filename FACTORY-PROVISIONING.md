# Factory provisioning

`npm run db:provision` creates or reconciles one white-label tenant without deleting existing data.

## Required configuration

Set `DATABASE_URL` and `SEED_OWNER_PASSWORD` in the environment. The command also accepts the existing `SEED_BUSINESS_*`, `SEED_OWNER_EMAIL`, `SEED_BUSINESS_SLUG`, `SEED_TIMEZONE`, and `APP_MODE` inputs used by the template. These values are configuration, not embedded credentials.

## Behavior

- Runs tenant creation, owner binding, starter services, barbers, schedules, and barber/service links in one Prisma transaction.
- Uses the business slug and owner email as stable identities.
- Uses existing records where possible and does not delete or overwrite customized business, service, barber, or schedule data.
- Uses `createMany({ skipDuplicates: true })` for schedules and relationships.
- Re-running the command is safe; it reconciles only records owned by the provisioning defaults.
- A failure rolls the transaction back, so a partial tenant is not left behind.
- `npm run db:seed` remains the explicit destructive reset/demo fixture path and still requires its existing safeguards.

## Verification

The command returns structured counts and verifies that the business, owner, expected services, barbers, schedules, and relationships are present. `npm run db:verify` and `npm run db:doctor` remain available for broader database checks.

Production deployments continue to use `prisma migrate deploy`; provisioning is separate from migration execution.

---

## Mandatory before the first owner registers: the sign-in protection store

Sign-in, registration and every public endpoint are rate limited, and the limiter **fails
closed**. With no shared store, the entire deployment refuses every sign-in and every
registration with a 503. This is the single most common cause of a fresh copy of the
template looking broken.

1. Create a free Redis database at upstash.com.
2. Copy the REST URL and REST token from the database's detail page.
3. Add both to the Vercel project (Settings -> Environment Variables) for **Production
   and Preview**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
4. Redeploy. Environment changes do not reach a running deployment.
5. Verify: `npm run client:preflight` must print
   `Rate-limit store (Upstash): configuration present and PING answered`, or open
   `/dashboard/factory-launch` as the owner once one exists.

If registration answers 503, the store is missing or the provider is down — it is never a
rate-limit violation, and raising limits or setting `RATE_LIMIT_CI_IN_MEMORY` in a
customer deployment are not workarounds: the first does nothing and the second disables
the protection.

Recovery from an outage: confirm the Upstash database still exists and is not suspended,
confirm both variables are still present, then confirm the deployment can reach Upstash.
No code change is needed; the deployment resumes by itself.
