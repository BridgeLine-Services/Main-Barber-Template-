# Client Onboarding & Delivery Workflow

This guide documents the standardized, evidence-based client delivery lifecycle for the barbershop application template. Each client receives an isolated application deployment, database, and repository.

## Client Delivery Workflow

1. **Verify Master Template**:
   Confirm that the master repository code is locked and fully verified by executing `npm run master:check` (runs architecture checks, client independence verification, linting, typechecking, Prisma schema validation, performance checks, and production build).

2. **Preserve Reusable Master Source**:
   Maintain the master template repository at `https://github.com/BridgeLine-Services/Main-Barber-Template-` as an untouched, read-only source. Never modify master source code, schema, or configuration files to store client-specific identity, credentials, or data.

3. **Import/Copy to Client Repository**:
   Create a fresh, separate client-owned repository (e.g. `github.com/client-org/barbershop-client-name`) by copying the clean master repository.

4. **Provision Deployment & Environment**:
   - Create a dedicated Vercel project connected to the client repository and assign a dedicated Neon PostgreSQL database instance (`neondb`).
   - Configure required Vercel environment variables as specified in `docs/environment-configuration.md` (`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_NAME`).
   - Attach custom client domain and verify SSL/DNS settings.
   - Provision the business and initial owner account via either:
     - **Self-Onboarding (primary)**: With `OWNER_REGISTRATION_MODE=onboarding` (the default), the client registers the initial owner themselves at `/login` → **Create Owner Account** (offered only while no owner exists) and completes the `/dashboard/onboarding` wizard (stores business info, services, barbers, schedules, and policies in DB). No pre-created credentials, tokens, or database edits are needed.
     - **Operator CLI Provisioning (alternative)**: Run `npm run db:provision` with `SEED_OWNER_PASSWORD` set (non-destructive; creates business, owner, and starter catalog). The browser-side provisioning endpoint was removed — there is no token-gated HTTP path.

5. **Independent Verification & Launch Acceptance**:
   - Execute `SMOKE_BASE_URL=https://client-domain.com npm run test:smoke` to verify homepage, booking route, login route, and health endpoints.
   - Open **Dashboard -> Launch Console** to complete all launch checks (branding, services, barbers, hours, custom domain, legal pages).
   - Test end-to-end guest booking and owner dashboard management independently before client handoff.

## Data & Isolation Boundaries

- **Database Isolation**: Each client deployment connects to its own per-deployment Neon PostgreSQL database via a unique `DATABASE_URL`. Client database instances and connection strings are completely isolated.
- **Multi-Tenant Schema Scoping**: Verified in `prisma/schema.prisma`, domain entities (`User`, `Barber`, `Service`, `Appointment`, `Customer`, `Payment`, `Review`, `WaitlistEntry`, `WebsiteContent`, `InventoryItem`, `Membership`, etc.) carry a required or scoped `businessId` foreign key referencing the `Business` model. Application queries explicitly filter by `businessId`.
- **Zero Credentials in Master**: The master repository must never contain client API keys, database connection secrets, payment tokens, or real client customer data. All client configuration is managed exclusively via provider environment variables or runtime database onboarding records.
