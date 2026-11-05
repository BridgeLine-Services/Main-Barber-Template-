# Client setup

This template uses one isolated deployment and database per barber shop.

## New client workflow

1. Create the client's Vercel project and connect its Neon/PostgreSQL database.
2. Add the required `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL` variables in the deployment settings.
3. Deploy the project. Vercel applies reviewed Prisma migrations before the build.
4. If running locally or from an operator environment, run `npm run setup`.
5. Open the deployed application and create the owner account at `/login`.
6. Complete the first-run onboarding wizard. Business name, address, timezone, policies, services, barbers, and schedules are stored in the database.
7. Verify the dashboard and create a test booking.

## Commands

- `npm run setup` — checks Node, applies migrations, generates Prisma Client, and verifies the database.
- `npm run db:setup` — applies migrations and generates Prisma Client.
- `npm run db:verify` — checks required tables and appointment columns.
- `npm run db:doctor` — diagnoses environment, connection, schema, migration, and database structure issues.

These commands never run `prisma migrate reset`, delete records, or seed a placeholder business. Re-running setup is safe; completed migrations are skipped by Prisma and onboarding remains the source of truth for client configuration.

## QA and launch

- `npm run test:smoke` — checks the deployed homepage, booking route, login route, and health endpoint. Set `SMOKE_BASE_URL` to the client deployment URL. It is read-only; booking creation and cancellation remain a deliberate manual acceptance step.
- Run the dashboard Factory Launch check before connecting the client domain. Required failures block launch; optional integrations and media warnings remain visible for operator review.
- See `DELIVERY-WORKFLOW.md` for the complete clone-to-launch and support-safe update process.

## If setup fails

Check the message first and run `npm run db:doctor`. Common causes are a missing `DATABASE_URL`, an unreachable database, or a migration mismatch. Do not reset the database or manually delete migration records. Preserve the database and investigate the reported migration or environment problem.

## Configuration boundaries

Required deployment variables are connection/authentication values. SMTP, Twilio, Google Business Profile, and cron values are optional integrations. Client-specific business information belongs in database records, not in the master template or committed environment files.

---

## The guided path (recommended, and the one that catches the old failure)

A new deployment used to fail in the same place every time: someone opened the site,
tried to create the first owner account, and got "Too many attempts" because the
rate-limit store was never configured. The registration form was the last thing to
find out. Now the configuration is verified before anyone can reach it.

```bash
npm run client:setup       # guided, dry run: answers questions, writes nothing
npm run client:setup -- --apply   # saves the values it collected to .env.local (0600)
npm run client:preflight   # the gate: exits 0 only if registration would work
npm run env:doctor         # per-variable status plus database and Redis probes
```

`client:preflight` refuses to pass unless all of these are true:

1. **Database** — reachable, schema applied (`Business` table exists), no migration left
   unfinished.
2. **Session secret** — `NEXTAUTH_SECRET` present and at least 32 characters.
3. **Public URL** — `NEXTAUTH_URL` set, or derivable from the platform hostname.
4. **Rate-limit store** — both Upstash values present **and** answering `PING`.
5. **Environment template** — `.env.example` documents the required variables.

If it fails, it says which item and why, in terms an operator can act on, and prints no
secret values. Do not open registration while it is failing: the site will answer 503
to every visitor who tries, which looks like the shop is broken.

### What the wizard will not do

It never overwrites a value that already exists, never rotates `NEXTAUTH_SECRET` or
`TWO_FACTOR_ENCRYPTION_KEY` (rotating them signs everyone out and invalidates existing
2FA enrolments), never resets or re-seeds the database, and never enables an optional
integration you did not ask for. Running it twice is safe.
