# Feature matrix

What each group of people can do, and how far it is actually done. Five states,
used strictly:

- **Implemented** works and is covered by tests.
- **Partial** some of it exists; the gap is named.
- **Not implemented** no working path.
- **Not configured** built, but the owner has not switched it on.
- **Not tested** exists; no evidence it works.

## Customer

| Feature | State | Notes |
| --- | --- | --- |
| Browse services and prices | Implemented | Public site, all eight identities |
| Choose a barber | Implemented | Barber profiles and portfolio |
| Book an appointment | Implemented | Booking suites plus duplicate prevention |
| Cancel / reschedule | Implemented | Policy windows from business settings |
| Account and login | Implemented | Customer auth suites |
| Reviews | Implemented | Published/featured controls; requests via email |
| Memberships, gift cards | Implemented | Existing modules, unchanged |
| Mobile browsing | Implemented | Responsive; E2E covers phone viewport |

## Barber

| Feature | State | Notes |
| --- | --- | --- |
| Today's appointments | Implemented | Barber dashboard |
| Own schedule and availability | Implemented | Availability overrides |
| Own portfolio and profile | Implemented | Portfolio and before/after |
| Own commissions and payroll | Implemented | My commissions, my payroll, time clock |
| Customer details | Implemented | Scoped server-side to their appointments |
| Owner-only settings hidden | Implemented | Hidden **and** refused server-side |

## Owner

| Feature | State | Notes |
| --- | --- | --- |
| Business overview | Implemented | Dashboard |
| Website appearance | Implemented | Eight identities, guide, assistant, comparison |
| Homepage sections | Implemented | 13 modules, stage suggestions, draft then publish |
| Published version history | Partial | Current snapshot and publish time shown; restoring an older version needs an additive table |
| SEO health | Implemented | `/dashboard/seo-health` |
| Review invites | Implemented | Panel shows sent, waiting, failed, not sent |
| Reliability centre | Implemented | `/dashboard/reliability` |
| Backups and freshness | Implemented | Health checks plus CI rehearsal |
| Onboarding | Implemented | Five steps, unchanged |
| Staff management | Implemented | Invitations, roles, deactivation |
| Payments and memberships | Implemented | Existing Stripe integration |
| Marketing campaigns | Implemented | Existing module |

## Co-owner

| Feature | State | Notes |
| --- | --- | --- |
| Delegated management | Implemented | `canManageBusiness` server-side |
| Permission boundaries | Implemented | Permission suites, 37 checks |
| Own dashboard view | Partial | Shares the owner surface; role-specific framing not built |

## Platform administrator

| Feature | State | Notes |
| --- | --- | --- |
| Platform owner role | Implemented | Separate authorization boundary |
| Factory readiness | Implemented | `/dashboard/factory-status` |
| Cross-tenant audit log | Implemented | Audit log with tenant scoping |
| Production RLS | Not configured | Deliberately off; design and offline tests exist |

## Integrations

| Integration | State | Notes |
| --- | --- | --- |
| Email delivery | Implemented | Provider configured per installation |
| SMS | Partial | Twilio consent flow exists; provider credentials per installation |
| Stripe payments | Implemented | Webhooks with idempotent claim |
| Google Business Profile | Partial | OAuth and sync helpers exist; not verified against a live account |
| Off-site backup storage | Not configured | Needs owner bucket and key |
| Media backup | Not configured | Needs owner Blob token |
| Alert webhook | Not configured | Optional |

## Never claimed as working

Anything above marked Not configured or Not tested is not evidence that it works.
A feature existing in the code is not a feature that runs in production.
