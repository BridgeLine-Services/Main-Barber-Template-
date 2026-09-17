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

## If setup fails

Check the message first and run `npm run db:doctor`. Common causes are a missing `DATABASE_URL`, an unreachable database, or a migration mismatch. Do not reset the database or manually delete migration records. Preserve the database and investigate the reported migration or environment problem.

## Configuration boundaries

Required deployment variables are connection/authentication values. SMTP, Twilio, Google Business Profile, and cron values are optional integrations. Client-specific business information belongs in database records, not in the master template or committed environment files.
