# Organization authorization matrix

Who may do what, and what enforces it. Every row names the capability in
`src/lib/organization/capabilities.ts` and the place the rule is actually checked. A hidden
button is not authorization: each API re-reads the role from the session.

Roles: **OWN** organization owner, **CORP** corporate admin, **REG** regional manager,
**FRAN** franchise owner, **LOC** location manager, **BAR** barber, **CUS** customer.

| Action | Capability | OWN | CORP | REG | FRAN | LOC | BAR | CUS | Enforced in |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| See the organization | `organization.read` | yes | yes | yes | yes | yes | yes | no | `resolve.ts`, every org page |
| See locations | `locations.read` | yes | yes | yes | yes | yes | yes | no | `GET /api/dashboard/organization/locations`, `loadManagedLocations` |
| Create a location | `locations.manage` | yes | no | no | no | no | no | no | `POST /api/dashboard/organization/locations` |
| Edit a location | `locations.manage` | yes | no | no | no | no | no | no | `PATCH /api/dashboard/organization/locations/[id]` |
| Open a location | `locations.manage` | yes | no | no | no | no | no | no | `POST .../[id]` action `activate` |
| Start closing | `locations.manage` | yes | no | no | no | no | no | no | `POST .../[id]` action `start-closing` |
| Close a location | `locations.manage` | yes | no | no | no | no | no | no | `POST .../[id]` action `close` |
| Reopen a closed location | none | no | no | no | no | no | no | no | Not permitted by the state machine. See the proposal below. |
| Move a location into a region | `locations.manage` + region scope | yes | no | no | no | no | no | no | `regionChangeVerdict` in `location-service` |
| Rename a region | `locations.manage` | yes | no | no | no | no | no | no | `POST /api/dashboard/organization/regions` |
| See assignments | `organization.read` | yes | yes | yes | yes | yes | yes | no | `GET /api/dashboard/organization/assignments` |
| Assign an employee | `staff.assign` | yes | no | yes | no | no | no | no | `POST /api/dashboard/organization/assignments` |
| Transfer an employee | `staff.assign` | yes | no | yes | no | no | no | no | `POST .../assignments/[id]` |
| End an assignment | `staff.assign` | yes | no | yes | no | no | no | no | `PATCH .../assignments/[id]` |
| Set corporate branding | `branding.manage` | yes | yes | no | no | no | no | no | `capabilities.ts` (editor not built in this phase) |
| Revoke a branding exception | `branding.manage` | yes | yes | no | no | no | no | no | Not built in this phase |
| Edit service templates | `services.manage` | yes | yes | no | no | no | no | no | `capabilities.ts` (editor not built in this phase) |
| Approve a price exception | `services.manage` | yes | yes | no | no | no | no | no | Not built in this phase |
| View organization financial totals | `financial.organization.read` | yes | yes | no | yes | no | no | no | `reporting.aggregate.read` guard on the overview |
| View one location's financials | `financial.location.read` | yes | no | yes | yes | yes | no | no | `resolve.ts` location scope |
| Read the configuration audit | `config.audit.read` | yes | yes | no | no | no | no | no | `capabilities.ts` |
| Read one customer's record | `reporting.customer.read` | no | no | no | no | yes | yes | no | `privacy.ts`, never granted to a corporate role |
| Send an announcement | `announcements.send` | yes | yes | yes | no | no | no | no | `POST /api/dashboard/organization/announcements` |
| Configure corporate reports | none | no | no | no | no | no | no | no | Not built: no scheduler for this report type |

## Scope on top of capability

A capability says what a role may do; `resolve.ts` says where. Three rules hold everywhere:

1. The organization comes from the session. No request body or query parameter can name a
   different one.
2. The location list comes from membership and active assignments. A regional manager holds
   only the regions on their membership row, and an assignment only inside its effective dates.
3. A capability never stands in for access to a specific shop. `staff.assign` plus a
   businessId outside the resolved list is refused, and the refusal is the same 404 shape a
   missing location produces.

## What this phase did not change

Role permissions, the capability table, organization isolation, the configuration audit, the
location lifecycle state machine and the customer privacy boundary are untouched. The only
additions are new callers of the existing rules.
