# Master template delivery workflow

This repository is the reusable master. Each client receives an independent GitHub repository, Vercel project, PostgreSQL database, environment-variable set, business dataset, branding, and domain. Client-specific changes belong in the client repository or database configuration, never in this master.

## Master: build, verify, polish, lock

1. Build reusable functionality.
2. Run lint, typecheck, architecture checks, tests, and an isolated production build.
3. Polish the generic experience without adding client identity.
4. Review tenant isolation, authentication, onboarding, and production safety.
5. Perform production verification against an isolated preview.
6. Lock the master: merge only reviewed generic improvements to `main`.

Recommended GitHub protection for `main`: require pull requests, at least one review, stale-review dismissal, resolved conversations, passing architecture/CI checks, up-to-date branches, restricted force pushes/deletions, and limited bypass actors. This workspace cannot verify or enable repository branch protection; administrators must apply and verify these settings in GitHub.

## Two supported deployment modes

### Mode A: pre-provisioned client

1. Copy the master into a separate client repository.
2. Create the client Vercel project and PostgreSQL database.
3. Run production migrations.
4. Provision the `Business`, owner/user relationship, services, barbers, schedules, and configuration through supported provisioning/admin workflows.
5. Optionally set `SINGLE_BUSINESS_ID` to the already-existing `Business.id` for public tenant fallback.
6. Deploy, test, review, and hand off.

`SINGLE_BUSINESS_ID` is optional and is only a tenant selector/fallback. It does not create a Business, Owner, User, relationship, database records, services, barbers, schedules, migrations, or configuration. It must reference an existing Business. It cannot replace provisioning or onboarding.

### Mode B: self-onboarding client

1. Create the client GitHub repository, Vercel project, PostgreSQL database, and environment variables.
2. Run `npx prisma migrate deploy` through the production build/deployment process.
3. Leave `SINGLE_BUSINESS_ID` unset.
4. The owner registers/logs in with no Business, is sent to onboarding, submits business details, and onboarding creates the Business and connects `User.businessId`.
5. Configure branding, services, barbers, schedules, booking settings, domain, and launch checks through the dashboard.

For a fresh self-onboarding deployment, `SINGLE_BUSINESS_ID` normally remains unset. It never bypasses the authenticated user-to-business relationship or dashboard authorization.

## Client delivery checklist

1. Copy the untouched master repository.
2. Create a separate client GitHub repository.
3. Create a separate Vercel project.
4. Create a separate PostgreSQL database.
5. Configure environment variables.
6. Run production migrations.
7. Configure business through onboarding or reviewed provisioning.
8. Configure branding, services, barbers, schedules, booking settings, and domain.
9. Test authentication, onboarding/provisioning, booking, dashboard, public website, and tenant isolation.
10. Review, deploy, and sell/hand off to the client.

For the next client, return to the untouched master and copy it again. Never modify a previous client's production repository to create the next client.

## Database lifecycle

Development may use `npx prisma db push` and explicitly marked local/demo seed workflows. Production client databases must use `npx prisma migrate deploy`; production must not depend on demo seed data. Initialize a fresh production database with migrations, then configure it through onboarding or provisioning. Never use destructive reset/seed workflows against client production.

## Environment variable contract

| Variable | Required | Visibility / purpose |
| --- | --- | --- |
| `DATABASE_URL` | Production | Secret PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Production | Secret session-signing value |
| `NEXTAUTH_URL` | Production | Deployed application URL; not a secret |
| `NEXT_PUBLIC_APP_URL` | Recommended production | Public canonical/domain URL; not a secret |
| `NEXT_PUBLIC_APP_NAME` | Optional | Public generic application name |
| `APP_MODE` | Recommended | `production` for clients; `demo` is local/demo only |
| `OWNER_REGISTRATION_MODE` | Optional | `onboarding`, `invite_only`, or `disabled` |
| `SINGLE_BUSINESS_ID` | Optional | Existing Business selector/fallback only |

Never place secrets in `NEXT_PUBLIC_*` variables. Optional SMTP, Twilio, Google, and cron values are required only when their corresponding feature is enabled.

---

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
