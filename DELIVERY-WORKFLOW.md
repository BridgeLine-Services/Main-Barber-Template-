# Client delivery workflow

This repository is a master template for independent barber-shop websites. Each client gets a separate Vercel project and a separate database. There is no automatic propagation from this repository to launched client sites.

## New client

1. Clone the repository into a new client project.
2. Create the Vercel project and connect its PostgreSQL/Neon database.
3. Add only the variables used by the application: `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`. Add SMTP, Twilio, Google, or cron variables only when that client uses those integrations.
4. Deploy the project, then run `npm run db:setup` if migrations were not already applied by deployment.
5. Create the owner account and open `/dashboard/setup`. Fresh owners are guided through `/dashboard/onboarding`; the setup checklist remains the single place to resume configuration.
6. Configure business details, hours, timezone, booking policies, services, barbers, schedules, branding, homepage content, SEO, and client photography through the dashboard/database. Progress is stored in the client database; no source edits or browser-local drafts are required.
7. Run `npm run db:verify`, `npm run db:doctor`, and `npm run test:smoke` with `SMOKE_BASE_URL` set to the deployed URL.
8. Manually complete the booking handoff: choose a real service/barber/time, create a test booking, verify confirmation, and verify cancellation from the customer portal.
9. Run the launch/readiness check and connect the client domain only after all required checks pass.

## Configuration boundaries

- Database records: business identity, address, contact details, hours, timezone, policies, services, staff, branding, content, and SEO values.
- Environment variables: database/authentication secrets and optional third-party integration credentials.
- Never commit secret values or client credentials.
- Never use `prisma migrate reset` or destructive seed commands against a client production database.
- Do not manually edit generated Prisma files or migration history.

## Support-safe operation

A live client site changes only when its own repository and deployment are deliberately updated. Keep client repositories, Vercel projects, and databases separate from the master template. During the support window, reproduce issues against that client's deployment/database, make a focused change in that client repository, validate it, and deploy intentionally. Do not pull master changes into a client project without review and a backup/rollback plan.

## Updating the master template

Make improvements on a feature branch, run `npm run test:all`, `npm run typecheck`, `npm run build`, and the smoke test against an isolated preview. Merge only reviewed changes. New client projects may adopt the updated template deliberately; existing client sites remain unchanged until explicitly updated.
