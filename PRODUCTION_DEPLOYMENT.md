# Production Deployment

The [Architecture Constitution](docs/ARCHITECTURE_CONSTITUTION.md) is the
governing contract for this workflow. Shop identity, branding, services,
barbers, schedules, policies, and booking settings are configured through the
database/onboarding layer; deployment secrets remain in the provider's
environment-variable store.

`DEPLOYMENT.md` is the authoritative production deployment guide. It covers
the current client workflow:

1. Create the hosting project and a fresh PostgreSQL database.
2. Configure core environment variables in the hosting provider's environment
   settings. Keep secrets in the provider's secret store.
3. Deploy the application and apply reviewed Prisma migrations with
   `npx prisma migrate deploy`.
4. Create the owner account at `/login`.
5. Complete the existing onboarding wizard.
6. Open **Dashboard -> Launch Console** and follow its prioritized next action.
7. Verify the custom domain, run the automated checks outside the dashboard,
   perform the live acceptance test, and obtain human launch approval.

## Production rules

- Use `APP_MODE=production`; never seed demo data into a client database.
- Do not use `prisma db push` for production schema changes.
- Do not store database URLs, authentication secrets, SMTP passwords, Twilio
  tokens, OAuth secrets, or cron secrets in source code, the database, or
  configuration exports.
- Leave optional integrations disabled unless the client deliberately enables
  them and configures their provider credentials.
- Treat the Launch Console's `MANUAL` checks as required human actions, not
  automatic passes.

## Local demo workflow

For local evaluation only, set `APP_MODE=demo`, apply the local schema, and run
`npm run db:seed`. Demo credentials and sample appointments are never suitable
for a customer deployment.

## Human-controlled steps

The operator remains responsible for provider accounts and billing, domain
ownership and DNS, production secret entry, legal content, business policies,
and final client acceptance. The application can validate safe metadata for
these items but cannot prove ownership or approve business decisions.

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
