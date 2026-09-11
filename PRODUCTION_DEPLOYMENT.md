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
