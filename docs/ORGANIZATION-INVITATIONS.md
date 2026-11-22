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

## What remains

1. **The "People and access" screen.** The routes above are ready; no page was built in this
   task. It needs: the member list, the invitation list with pending/accepted/expired/
   cancelled wording, an invite form with role explanations, and confirmations before each
   change.
2. **Email delivery.** No invitation email is sent. The repository has no organization-level
   delivery channel, and inventing one was out of scope. `POST` returns the acceptance link
   once, with `delivery: 'not-sent'` and a note, so an owner can pass it on directly. Wiring
   this to the existing notification worker needs a decision about which mailbox sends
   organization mail.
