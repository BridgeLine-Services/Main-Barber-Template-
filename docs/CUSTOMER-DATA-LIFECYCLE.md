# Customer Data Lifecycle

What the master template collects about customers, why, where it lives,
who can see it, how long it is kept, and how it is exported or removed.
This is the technical reference for §21; the privacy-policy framework in
`docs/LEGAL-PLACEHOLDERS.md` must match the behavior described here.

## What is collected and why

| Data | Required? | Purpose | Storage |
| --- | --- | --- | --- |
| First/last name | Required (booking) | Identify the customer at the chair | `Customer` |
| Phone | Required (booking) | Contact for reminders/changes; lookup key | `Customer` |
| Email | Optional where configurable; used for confirmations/portal | Notifications, customer portal access | `Customer` |
| Appointment history (service, barber, times, status) | Automatic | Business record; reporting; rescheduling | `Appointment` |
| Free-text notes | Optional (staff-entered) | Service context for the barber | `Customer.notes`, `Appointment.customerNotes` |
| Service preferences (guard length, style, etc.) | Optional (customer-entered via portal) | Better repeat visits | `Customer.preferences` (JSON) |
| Tags | Optional (staff-entered) | Marketing segmentation | `Customer.tags` |
| SMS consent flag | Explicit | Lawful sending of SMS reminders | `Customer.smsConsent` |
| Intake answers | Optional, per booking | Barber preparation | `AppointmentIntakeResponse` |
| Portal session tokens (hashed) | Automatic on portal use | Portal authentication | `PortalSession` |

Booking is possible **without a customer account**: public booking links
customers to appointments by a random per-appointment access token, not by
an account.

## Who can access it

- **Business Owner** — full access to their business's customers (scoped
  by `businessId`; see `docs/TENANT-ISOLATION.md`).
- **Barbers/staff** — access customers of their own business through
  dashboard screens only; customer deletion/anonymization is owner-only.
- **The customer** — their own profile, preferences, and appointment
  history through the customer portal (hashed portal session), plus a
  self-service data export.
- **Nobody else.** Other businesses can never reach these records; every
  query is business-scoped and verified by an automated IDOR matrix.

## Retention

- Active customer records: retained while the business relationship is
  active. There is no automatic deletion timer in the template (a per-
  deployment retention policy can be layered on via cron).
- Archived customers: retained indefinitely with all data, but hidden
  from lists/analytics/booking.
- Anonymized customers: PII removed permanently (see below); the shell
  record remains only so appointment history stays referentially intact.
- Appointment records are business records and are never deleted by the
  customer lifecycle endpoints.

## Export

1. **Business export** — `GET /api/dashboard/customers/export` (OWNER
   only, audited): CSV of the business's customers with appointment
   counts, spend, notes, and an `Archived` flag. Business-scoped.
2. **Customer self-export** — `GET /api/public/portal/data-export`
   (portal session only): JSON download with the customer's profile and
   full appointment history for that business. Served with
   `Cache-Control: no-store`; contains no other customers' data.

## Deletion / anonymization behavior

`DELETE /api/dashboard/customers/[id]` (OWNER only, business-scoped, audited):

| Mode | Effect | Reversible? |
| --- | --- | --- |
| `archive` (default) | Sets `archivedAt`; hidden from lists, analytics, booking | Yes (clear `archivedAt`) |
| `anonymize` (requires `confirm: "ANONYMIZE"`) | Archive + PII scrubbed: name → "Removed Customer", phone → "deleted", email → `anonymized-<id>@deleted.invalid`, notes/preferences/tags cleared, consent flags reset. `Appointment.customerNotes` scrubbed. Portal sessions revoked. | **No** |

What is **preserved** after anonymization, by design:

- The appointment rows (times, service, barber, status) — historical
  business reporting and revenue analytics remain valid.
- The anonymized customer shell — keeps foreign keys resolvable.
- Audit log entries (they contain only minimal old-value indicators).

What a customer portal session can never do: export, see, or modify
another customer's data or any staff/business configuration.

## Third parties

The template itself sends customer data to no third party. Deployments
that enable email (SMTP), SMS (Twilio), or analytics introduce their own
data flows — document them per deployment in
`docs/OPERATIONS.md` §3 (Third-Party Services) and the deployment's
privacy policy.

## Automated verification

`tests/customer-data-lifecycle.test.ts` proves: archive hides the
customer from lists/analytics; anonymize scrubs PII while appointments
stay intact and counted in reporting; the confirm token is required;
portal sessions are revoked; the customer self-export is session-scoped
and never leaks other customers; and the whole flow is business-scoped.
