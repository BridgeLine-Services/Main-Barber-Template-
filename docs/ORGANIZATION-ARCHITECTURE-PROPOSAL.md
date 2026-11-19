# Multi-location and franchise architecture: proposal only

Parts 9 and 10 of the expansion directive. **Nothing in this document is implemented.**
No model was added, no migration was written, no permission was changed. It is a proposal
for approval, as the directive requires, and it is deliberately shaped so the existing
`Business` model stays the operational tenant.

## 1. Current schema map (verified)

- `Business` is the tenant. Every operational record carries `businessId`:
  appointments, customers, barbers, services, payments, commissions, time entries,
  memberships, gift cards, orders, inventory, marketing, audit entries.
- `User` holds one role (`OWNER`, `BUSINESS_ADMIN`, `BARBER`, `CUSTOMER`, `PLATFORM_OWNER`)
  and one `businessId`. A person who works at two shops therefore needs two accounts today.
- `src/lib/tenant.ts` and `src/lib/auth-helpers.ts` resolve the business from the session.
  Nothing resolves it from the request. That is the property the whole proposal preserves.
- `prisma/rls/production-rls.sql` defines the staged row-level policies, keyed on a
  transaction-local tenant id.

## 2. Proposed schema map (not created)

```
Organization                     id, name, slug, createdAt
OrganizationMember               organizationId, userId, role, status
OrganizationLocation             organizationId, businessId  (one Business per location)
StaffLocationAssignment          organizationId, userId, businessId, effectiveFrom/To
OrganizationBrandSettings        organizationId, sharedAssets, approvedOverrides
OrganizationReportingConfiguration  organizationId, metrics, schedule
```

`OrganizationLocation` is a join, not a replacement: a `Business` row keeps owning its own
appointments, customers, payments and staff. Deleting an organization must not cascade into
business data, so the join is `onDelete: Restrict` on the business side.

## 3. Roles and the capability matrix that must accompany them

| Role | Reads | Writes | Never |
| --- | --- | --- | --- |
| Organization Owner | Consolidated reports across its locations; location settings | Add/remove locations, appoint managers, brand settings | Another organization’s data |
| Corporate Administrator | Reports and configuration for its organization | Reporting config, brand assets | Raw customer records unless separately granted |
| Regional Manager | Assigned locations only | Schedule and staffing for assigned locations | Payments settings, deleting locations |
| Franchisee Owner | Its own location, plus its franchise reporting | Its own location | Other franchisees |
| Location Manager | One location | Day-to-day operations of that location | Organization-wide settings |
| Barber | Own appointments and customers | Own schedule requests, time clock | Other barbers, shop finances |
| Customer | Own appointments and details | Own bookings | Anything else |

Rule: a corporate role that can see a report cannot thereby read individual customer
records. Reporting reads aggregates; opening a customer record is a separate permission.

## 4. Shared customers

A customer identity strategy that recognises the same person across approved locations must
not merge accounts automatically and must not expose one shop’s history to another. The
proposed route is an explicit, consented link: the customer opts in at a second location, the
link is recorded with a timestamp and the locations involved, and either side can revoke it.
Without that link, the second location sees only its own history with that person.

## 5. Consolidated reporting, honestly labelled

Revenue, appointment volume, retention, staff performance, memberships, gift cards,
inventory, utilisation and commissions are all derivable from existing records. Operating
expenses are only available where a shop records them. The report must label gross sales,
refunds, commissions, recorded expenses and estimated figures separately, and must never
present a computed "profit" that mixes them.

## 6. Migration and rollout requirements (before any code)

1. Additive migration only: new tables, no change to existing columns, no data rewrite.
2. Backfill: every existing `Business` optionally joins an organization; a shop with no
   organization keeps working exactly as it does today.
3. Authorization: every new read resolves the organization from the session, then checks
   the location belongs to it. No new endpoint may accept an organization id from the client.
4. RLS: new tables enter the staged RLS plan on the same terms as existing tenant tables.
5. Tests before merge: cross-organization isolation, role matrix, and a regression run of
   the existing tenant and permission suites.
6. Rollback: drop the new tables. Because nothing existing is altered, rollback cannot lose
   business data.
7. Deployment order: migration, then read-only reporting, then write paths, each approved
   separately.

## 7. What would have to be true before this is built

- A decision on whether a barber working at two shops gets one account or two.
- Approval for a schema change (currently out of scope without it).
- A staging environment with realistic multi-location data to test isolation against.
- Agreement on the customer-linking consent wording, since it is a privacy decision.

## 8. Competitive research (Part 10) and what it changed here

SQUIRE, Booksy, theCut, Vagaro, Fresha, Square Appointments, GlossGenius, Boulevard,
Mangomint and Zenoti were used as product references only. The three patterns that recur and
that this platform already covers are online booking with a personal link, commission and
payroll reporting, and retention tooling (waitlist, rebooking, reviews). The gaps that
matter for a solo barber are referral attribution and per-barber growth analytics; both are
listed as planned in the growth stage model rather than claimed as built. No proprietary
design or code was copied, and no feature was added on the strength of a competitor having
it alone.
