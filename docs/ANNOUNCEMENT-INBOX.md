# The organization announcement inbox

Written 2026-11-23. This describes the in-app half of Priority 3, part E. There is no email
or SMS delivery anywhere in this feature, and nothing here calls a delivery provider.

## What a person sees

`/dashboard/organization/announcements` shows every announcement that was delivered to an
open location the signed-in person may act on, newest first. Each one shows its title, its
message, who sent it, the date it was sent, and the audience in plain words ("Region: West",
"Downtown and 1 more", "Every open location"). New announcements carry a `New` badge until
that person marks them read.

The page is the same for every role that holds `announcements.read`. Barbers see it; a
customer role does not, and a person with no organization is told so in a sentence rather
than shown an error.

## How an audience becomes a delivery

1. The sender picks everyone, regions, or specific locations in the form.
2. `planDelivery` resolves that audience against the sender's own locations, not the whole
   organization, so "everyone" from a regional manager means everyone in their regions.
   `limitToSenderScope` then runs again as a second guard.
3. Closed locations are dropped by the existing resolver. A send that matches nothing is
   refused with a sentence explaining why, and nothing is written.
4. The resolved set is stored on the announcement as `resolvedBusinessIds`, fixed at send
   time. Reading is decided from that set, never by re-resolving the declared audience,
   because a later region change must not re-address something already sent.
5. The send is recorded in the existing `OrganizationConfigAudit` through
   `buildConfigAuditEntry`, so the configuration history has one kind of entry, not two.

## Read status

One row per person per announcement in `OrganizationAnnouncementRead`, unique on
`(announcementId, userId)`. The receipt is always written for the session user, the
announcement lookup is scoped to the organization resolved from the session, and a row
addressed to locations the reader is not part of is refused. An announcement from another
organization answers 404 rather than 403, so its existence is not confirmed.

A failed read of receipts shows announcements as new instead of claiming they were seen.

## The migration, and why it was needed

The stored announcement had an audience but no recipients and no read state, so read status
could not be tracked at all. The smallest additive change is one table plus one column:

- `OrganizationAnnouncementRead` (id, announcementId, organizationId, userId, readAt) with
  a unique key on `(announcementId, userId)` and two cascading foreign keys.
- `OrganizationAnnouncement.resolvedBusinessIds` as a non-null text array defaulting to an
  empty set.

`prisma/migrations/20261123140000_organization_announcement_delivery` contains exactly
that. It drops nothing, alters nothing existing, and deletes no row. It is written but not
applied; until it runs, the inbox fails closed rather than showing or marking anything.

The empty default means an announcement written before this column existed would resolve to
"delivered to nobody" and stay invisible. Nothing in the application wrote an announcement
before this change, so no legitimate row is hidden by that default.

## Tests

`tests/organization-announcement-inbox.test.ts` (101 assertions) covers audience
restrictions, closed locations, wrong-organization access, read-status isolation,
unauthorized senders, sender scope, unknown audience types, the server-side length limits,
empty states, the server boundary checked in source, and a static mobile and accessibility
guard. It needs no database.

## What remains

- Applying the migration above.
- Email and SMS delivery. The `POST` response already reports `delivery: 'in-app-only'`; a
  future channel would read the same resolved set without changing a single rule.
- An unread count on the sidebar link. It needs a per-request read in the dashboard layout,
  which was out of scope for this pass.
- A named-group picker. The resolver understands a group, but no model in this repository
  defines one, so the form does not invent the concept.
