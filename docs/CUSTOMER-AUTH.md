# Customer Authentication & Access Model

The template supports **two complementary customer access paths**, deliberately
kept side by side because guest booking is a first-class requirement:

1. **Guest (token) path** — a customer who books without an account receives a
   per-appointment `customerAccessToken` in their confirmation links. Token
   routes (`/api/public/appointments/[token]/…`) act on exactly one
   appointment: cancel, reschedule, calendar export. Tokens are
   unguessable, scoped to the appointment, and rejected when malformed,
   unknown, or when the appointment is in a terminal state.

2. **Account (session) path** — a customer can create an account at
   `/api/auth/register`. Public signup **always** creates a `CUSTOMER` role
   user; any client-supplied role is ignored (server-side determined). Staff
   and owner accounts can only be created through gated, invite-only flows.

## Session path

- Login/logout uses the NextAuth credentials provider; passwords are bcrypt
  hashes. Sessions carry `role` and (after linking) `customerId`.
- **Account → customer-record linking is established server-side only** on
  the customer's first booking at a business: the booking API overrides the
  submitted email with the authenticated account email, links
  `User.customerId`, and writes a `CUSTOMER_LINKED` audit entry. A customer
  account is never bound to a business before a real booking.
- A customer with records at several shops sees each shop's data **only
  through that shop's tenant** (host-resolved business). The portal resolves
  the `Customer` record from `businessId + account email`; on a shop where the
  account has no record, the portal is simply empty (`customer: null`),
  never another customer's data.

## What is never trusted

No identifier from the browser is ever trusted on the portal APIs:
`customerId`, `userId`, and `businessId` query/body values are ignored. The
portal routes (`/api/portal/*`) resolve business + customer exclusively from
the session and the tenant host.

## Capabilities

The authenticated portal (`/portal` → `CustomerPortalAuthed`) provides:

- profile display and sign-out
- upcoming appointments and history
- **cancel** (honors `cancellationDeadlineHours`, atomic guard against races)
- **reschedule** (honors `customerRescheduleEnabled`,
  `customerRescheduleMinNoticeHours`, `customerRescheduleWindowDays`,
  re-validates the slot, runs in a serializable transaction, records
  `RescheduleHistory` with actor `CUSTOMER`)

The token path offers cancel/reschedule for the single linked appointment
under the same business rules.

## Authorization boundaries

- `CUSTOMER` capabilities (`src/lib/permissions`): view-own-appointments and
  manage-own-profile only. Every dashboard API returns 403 and dashboard pages
  server-redirect customers to `/portal`.
- Ownership-scoped lookups (`id + session customer + business`) make another
  customer's appointment indistinguishable from a nonexistent one (404).
- All portal actions are rate-limited and audit-logged.

## Password recovery (account path)

Customers reset their own passwords via `/api/auth/forgot-password` +
`/api/auth/reset-password`:

- **Enumeration-safe**: the request response is identical whether or not the
  email exists (including malformed input). Production without SMTP fails
  honestly with the same generic message — it never pretends a mail was sent.
- **Token hygiene**: 32-byte random token, stored only as its SHA-256 hash,
  1-hour expiry, single active token per user, single use (cleared on
  completion). Failed attempts never mutate the password.
- **Shared policy**: the new password passes the same strength policy as
  registration; a completed reset stamps `passwordChangedAt` and clears
  `mustChangePassword`.
- **Audit**: both `PASSWORD_RESET_REQUESTED` and `PASSWORD_RESET_COMPLETED`
  are recorded; both endpoints sit behind the stricter 3/min/IP rate limit.

## Verification

`tests/customer-auth-security.test.ts` (run against a live server:
`npx tsx tests/customer-auth-security.test.ts`) proves: server-determined
signup role, gated owner onboarding, dashboard lockout, session-forced booking
identity, IDOR protection (view/cancel/reschedule), cross-business isolation,
reschedule rule enforcement, expired/invalid credential rejection, and the
login/logout audit trail.

`tests/customer-password-reset.test.ts` (also live; both suites run with
`npm run test:auth`) proves the recovery flow end-to-end: enumeration
safety, hash-only token storage, expiry and single-use enforcement, the
shared password policy, old-password invalidation, re-login with the new
password, rate limiting, and the reset audit trail.
