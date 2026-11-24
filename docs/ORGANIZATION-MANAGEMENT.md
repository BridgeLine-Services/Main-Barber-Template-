# Organization management

Written 2026-11-24 against `main` at `4f32344`. This is the honest record of the organization
management phase: what already existed, what was added, what was deliberately not built, and
what needs an owner decision.

## What already existed and was reused

- `src/lib/organization/capabilities.ts` (seven roles, one capability table).
- `src/lib/organization/resolve.ts` (session-only organization and location resolution).
- `src/lib/organization/locations.ts` (the lifecycle state machine, `OPENING_STEPS`,
  `CLOSING_STEPS`).
- `src/lib/organization/assignments.ts` (effective dating, validation, overlap detection).
- `src/lib/organization/config-audit.ts` (every change recorded with a readable summary).
- The read-only structure page and franchise overview.

## What was added

### Location management

- `src/lib/organization/location-management.ts` decides, purely: draft validation, shop slugs,
  duplicate names, region moves and renames, whether a location may open, what a closing
  shows, and the reopening refusal.
- `src/lib/organization/location-service.ts` performs the writes: create, edit, activate,
  start closing, close, rename a region. Every function re-checks the capability, re-reads the
  location list from the session, writes inside a transaction and records an audit entry.
- Screens: `/dashboard/organization/locations` (list with readiness), `/locations/new`
  (guided setup), `/locations/[id]` (details, checklist, open, close).

Creating a location always lands in `onboarding`. It copies the organization's active service
templates into the new shop at their standard prices, so a shop is never created with an
empty service list, and nothing is bookable until it is activated.

### Opening is enforced, not merely explained

`activationVerdict` refuses to open a location until the brand applies, at least one service
is priced, and a location manager assignment is in force. The same three checks run on the
server inside the transition, so a crafted request cannot open a half-finished shop.

### Closing

`buildClosureReview` lists upcoming appointments, completed appointments, people working
there, assignments, unsettled commissions, unsettled payments and customer records. A count
that could not be read says so and is never shown as zero. Closing is refused while
commissions or payments are unsettled, and while the owner has not confirmed a copy of the
records was produced. The confirmation is recorded in the audit entry, because an export
cannot be verified from inside the app.

Nothing is cancelled, dismissed or deleted by closing. The copy says so in as many words.

### Staff assignments

- `src/lib/organization/assignment-management.ts` decides: permission, scope, closed
  locations, self-assignment, overlap, transfer planning, ending, and history classification.
- `src/lib/organization/assignment-service.ts` writes inside serializable transactions. The
  overlap is re-checked inside the transaction, so two managers saving at once produce one
  assignment and one refusal rather than two contradictory rows.
- Screens: `/dashboard/organization/assignments` (assign, move, end, history).

A transfer is an end plus a start on the same date. The old row is never deleted, so "who was
here in March" keeps one answer. Nobody can assign themselves, including an owner.

### Regions

A region is a name that locations share, so it exists while at least one location is in it.
That means there is no separate region record to get out of step, and no way to create a
region with nothing in it. Renaming moves every location in it in one transaction.
`/dashboard/organization/regions` lists regions, their locations and the regional managers
who hold them.

## The reopening path: built 2026-11-24

The state machine in `locations.ts` allows `onboarding → active`, `active → closing`,
`closing → active|closed`, and nothing out of `closed`. That is deliberate and it was not
bypassed.

Reopening a closed shop is a real need (a lease is renewed, a closure is reversed). The safe
shape, if the owner wants it, is:

1. A new status value `reopening`, added additively, with `closed → reopening` permitted only
   through one action.
2. The action requires the `locations.manage` capability, a written reason, and an explicit
   confirmation that historical records stay attached to the same location.
3. `reopening → onboarding` once the brand, services and manager checks pass again, then the
   existing `onboarding → active` path unchanged.
4. `reopening → closed` as the way to abandon the attempt.
5. An audit entry for each move, and tests pinning that `closed → active` remains impossible
   in one step.

What it needs before it is built: an owner decision, one additive migration for the status
value, and tests. It is not in this phase because the phase was told not to bypass the state
machine.

## Permissions

`docs/ORGANIZATION-PERMISSIONS-MATRIX.md` lists every action, the capability behind it, and
the file that enforces it. Nothing in this phase added a capability or changed a role.

## Not built in this phase

| Item | Why |
| --- | --- |
| Corporate branding editor | `branding.manage` and `resolveBrand()` exist and are tested; the screen was not built here. The existing `/dashboard/brand-setup` remains the way to set a shop's look. |
| Branding exception request and revoke | `requestLocationOverride()` exists; no screen or endpoint was added. |
| Service template editor | `service-templates.ts` has the validation and the pricing resolver; no screen was added. |
| Price exception approval workflow | Needs a request/approve record with history. `OrganizationServicePriceException` stores one approved price per template and location and has no request state, so an approval workflow would need an additive migration. Documented rather than forced. |
| Scheduled corporate reporting | `OrganizationReportingConfiguration` exists. There is no scheduler for this report type, and inventing one here would have been a reliability change, which this phase was told to leave alone. The existing report remains read-only and in-app. |
| Reopening a closed location | Built. See the reopening path above. |
| Email or SMS delivery | Out of scope for this phase. |

## Verification

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | Clean |
| `eslint` on changed files | Clean |
| `npm run architecture:check` | Passed |
| `npm run build` | Succeeded |
| `tests/organization-location-management` (new) | 79 passed |
| `tests/organization-assignment-management` (new) | 62 passed |
| `tests/organization-architecture` | 155 passed |
| `tests/organization-franchise-overview` | 57 passed |
| `tests/organization-people-screen` | 58 passed |

Not run: suites needing a live database (`organization-invitations`,
`organization-isolation`), and any staging or CodeQL gate.

## Reopening and price approvals: what was added on 2026-11-24

### Reopening a closed location

The path is `closed → reopening → onboarding → active`, with `reopening → closed` available to
abandon an attempt. It is deliberately not a jump back to `active`: a shop that has been shut
needs its people, services and hours checked before it takes bookings again, and the
intermediate states are what make that preparation visible in the history.

What the server requires before it will begin:

1. The location is `closed`. Nothing else can be reopened.
2. The actor holds `locations.manage` (an organization owner).
3. A written reason of at least 10 characters, which is stored in the audit entry.
4. An explicit acknowledgement that the location keeps its existing records and history.

The location row is never replaced or copied. `reopenedAt` is stamped on the same row, so the
name, appointments, payments, commissions and customer history stay attached to the shop a
customer already knows. No appointment is cancelled and no person is unassigned by reopening.

`docs/ORGANIZATION-MANAGEMENT.md` and `docs/ORGANIZATION-PERMISSIONS-MATRIX.md` both record that
reopening is owner-only.

### Price approvals

`OrganizationServicePriceRequest` is a new table. It is separate from
`OrganizationServicePriceException` on purpose: `resolveServicePrice()` applies any exception row
it is given, so a request that has not been approved must not be able to change a shop's price by
existing. Approval is the only thing that writes the exception row, and it happens in the same
transaction as the decision.

| Step | Who | What happens |
| --- | --- | --- |
| Ask | anyone with `services.read` at a location they are assigned to | A `PENDING` request row. The shop's price does not change. |
| Approve | `services.manage` (owner, corporate admin) | The exception row is written with the approved price, and the request becomes `APPROVED`. |
| Decline | `services.manage` | The request becomes `DECLINED` with the note. The price does not change. |
| Revoke | `services.manage` | The exception row is removed, the location returns to the standard price, and the request becomes `REVOKED`. |

A second request for the same service and location is refused while one is pending, and refused
again while one is approved: the owner has to revoke first. Every step writes a configuration
audit entry naming the actor, the previous price and the new one.

A template price change never overwrites an approved exception. `describeTemplateChange()` states
how many locations follow the standard price and how many keep their own before anything is
published.

### The migration

`prisma/migrations/20261124180000_reopening_and_price_approvals` is additive: one nullable column
on `OrganizationLocation`, one new table, three indexes and two cascading foreign keys. Nothing
is altered, renamed or dropped and no row is deleted. It has **not** been applied to any
database from this workspace; `npm run deploy:migration-check` reports it as backward compatible.

### Still not built

Corporate branding editor, service template editor, and scheduled corporate reporting. The first
two have tested rules and no screen; the third needs a scheduler this phase was told not to add.
