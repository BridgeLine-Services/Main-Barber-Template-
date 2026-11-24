# Organization invitations and member management

## What exists now

The backend for inviting people into an organization, and for managing the people already
in it. Every operation is authorized on the server against the caller's organization
context, which is resolved from the session, never from the request body.

| Path | Method | What it does |
| --- | --- | --- |
| `/api/dashboard/organization/invitations` | `GET` | Members, invitations and the roles that can be offered, for the caller's organization |
| `/api/dashboard/organization/invitations` | `POST` | Invite an address as one of the offered roles |
| `/api/dashboard/organization/invitations/[id]` | `POST` | Resend: issues a new link and retires the old one |
| `/api/dashboard/organization/invitations/[id]` | `DELETE` | Cancel a pending invitation |
| `/api/dashboard/organization/members/[id]` | `PATCH` | Change a role, or suspend and restore access |
| `/api/auth/accept-organization-invitation` | `POST` | Accept as the signed-in person |

## The rules it enforces

- **Authority is the existing capability system.** Managing members needs
  `organization.manage`, which only the organization owner holds. No second permission
  system was added.
- **A role cannot be granted by someone who lacks it.** The target role's capabilities must
  be a subset of the granter's.
- **Ownership is never granted by invitation**, and the owner's own membership cannot be
  changed or suspended from these routes.
- **Nobody raises their own role.**
- **Tokens** are 32 random bytes, shown once, stored as a sha256 hash, single use, valid
  seven days. Resending replaces the hash, so the previous link dies immediately.
- **Acceptance checks identity as well as the link.** The signed-in email must match the
  invited address, so a forwarded link cannot be claimed by whoever receives it.
- **Cross-organization ids do nothing.** Every lookup is scoped by the caller's
  organization id.
- **Nothing is deleted.** Suspending a membership changes a status; the person, their shop
  membership and their history stay.

## The migration, and why it was needed

`prisma/migrations/20261122160000_organization_invitations/migration.sql` adds one table
(`OrganizationInvitation`) and six audit action values. It is additive: no existing table,
column, index or row is altered or removed.

It was genuinely required. `OrganizationMember` is keyed on `(organizationId, userId)`, so it
can only describe someone who already has an account, and it has nowhere to hold a token,
an expiry or an invitation state. Reusing `StaffInvitation` was not an option either: that
table is scoped to a single `businessId` and grants shop-level roles, which is exactly the
boundary this feature must not cross.

**Owner action:** the migration is applied to the local test database only. Applying it to
production is your call, per the standing rule about migrations.

## Invitation email delivery

Organization invitations use the existing SMTP configuration and notification worker; no
new mail provider or sender address is introduced. The sender is exactly `SMTP_FROM`, and
the owner must configure it as an address on a domain verified with their SMTP provider.
Set `EMAIL_ENABLED=true` and provide `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and
`SMTP_FROM` in the Vercel project environment. `SMTP_SECURE` remains optional (TLS is
inferred for port 465). The current project has no SMTP variables configured, so invitations
created in this environment use the copy-link fallback until those settings are supplied.

The queue records `Created`, `Queued`, `Sending`, `Sent`, `Delivery failed`, and `Retry
scheduled` states; the invitation itself separately shows `Accepted`, `Expired`, and
`Cancelled`. A queue entry is not considered sent: it becomes sent only after the SMTP
provider accepts it. The API runs the existing worker after responding, and the daily
`/api/cron/organization-invitation-delivery` job picks up due retries. Temporary provider
failures retry up to four attempts with 1-, 5-, and 15-minute backoff; because this project
uses a daily Vercel Cron schedule, later attempts can wait until the next daily run. The cron
route requires `CRON_SECRET`. A manual retry rotates the token and expiry, invalidating the
previous link before enqueuing the new message. Cancellation invalidates queued work and the
worker checks invitation state again immediately before dispatch.

The invitation row stores only the token hash. While delivery is pending, the notification
queue stores the minimal token payload encrypted with AES-256-GCM using a key derived from
`NEXTAUTH_SECRET`; the payload is erased once delivery completes or fails permanently. The
plaintext token is never written to application logs or returned after the email has been
queued. When SMTP is disabled, incomplete, or unavailable, the one-time creation/resend
response includes a manual link and the screen offers a copy action.

## Operational note

The invitation schema migrations are additive. The delivery migration,
`prisma/migrations/20261124190000_organization_invitation_delivery/migration.sql`, adds the
notification type and retry counter. Apply migrations to the local test database before
running the database-backed invitation and delivery suites; production deployment remains
an owner-controlled action.
