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
