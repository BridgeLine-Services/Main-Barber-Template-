# Feature configuration

Centralized, tenant-aware feature configuration (Requirement 27).
One registry — `src/lib/features.ts` — defines every feature, its safe
default, and how it resolves per business. No feature check is scattered
ad hoc through the codebase.

## Resolution order

```
FEATURE_DEFAULTS (src/lib/features.ts)
  ← merged with Business.featureOverrides (migration 20260927170000)
```

- Defaults are SAFE and match current template behavior. `onlinePayments`
  is `false` and additionally fail-closed at the provider layer
  (`resolvePaymentProvider` throws unless a provider is registered —
  see docs/PAYMENTS.md).
- `featureOverrides` is a sparse JSON map `{ featureKey: boolean }` on
  the Business row — tenant-scoped by construction.
- Unknown keys are rejected by the settings API (400) and ignored on read;
  non-boolean values never override a default.
- Existing dedicated columns stay authoritative where they exist (e.g.
  `paymentInPerson`, `customerRescheduleEnabled`, reminder flags in
  RetentionSettings); the registry layers over them rather than replacing
  them.

## Feature keys

onlineBooking, customerPortal, reviews, gallery, promotions, loyalty,
waitlist, queue, inventory, marketing, analytics, multipleBarbers,
barberProfiles, deposits, pwa, emailNotifications, smsNotifications,
onlinePayments.

## Enabling/disabling (no code changes)

Owner-only API, tenant-scoped from the session (never the request body),
audited as `FEATURE_CONFIG_UPDATED`:

```
GET /api/dashboard/features        # resolved map + defaults + raw overrides
PUT /api/dashboard/features       # { "reviews": false } — partial, merged
```

## Enforcement

Disabled features are blocked SERVER-SIDE, not merely hidden in the UI.
Implemented gates:

- `onlineBooking` — `POST /api/public/appointments` returns 403 when the
  resolved feature is off.

When adding a new gated surface, use
`assertFeatureEnabled(businessId, key)` (throws `FeatureDisabledError`)
or `isFeatureEnabled(business, key)` — never re-implement resolution.

## Tests

`tests/feature-flags.test.ts` (16 assertions): defaults incl. fail-closed
onlinePayments, override on/off, malformed override handling, per-tenant
isolation of feature state, unauthenticated API rejection, and a live
end-to-end proof that disabling `onlineBooking` blocks the public booking
route with 403 while another business stays bookable.

## Master-template validation

`npm run client:independence` scans application source for hardcoded
client data (phone numbers, emails, non-platform domains) and fails on
findings. `npm run master:check` chains architecture, independence, lint,
typecheck, Prisma validate/generate and the production build into one
gate for "master template ready".

---

## Enforcement status, verified 5 November 2026 (afternoon revision)

`npm run audit:features` walks `src`, and for every key in `FEATURE_KEYS` reports whether
any server file both mentions the key and consults the feature layer
(`isFeatureEnabled`, `isFeatureEnabledForBusiness`, `assertFeatureEnabled`).

Result at this commit: **1 of 24 keys is enforced server-side.**

| Enforced | `onlineBooking` — `src/app/api/public/appointments/route.ts` refuses the write |
| --- | --- |
| Settings-only (no server enforcement found) | `customerPortal`, `reviews`, `gallery`, `promotions`, `loyalty`, `waitlist`, `queue`, `marketing`, `analytics`, `inventory`, `memberships`, `giftCards`, `ecommerce`, `multipleBarbers`, `barberProfiles`, `deposits`, `pwa`, `emailNotifications`, `smsNotifications`, `onlinePayments` |

### What this means, stated plainly

For every key except `onlineBooking`, turning the switch off removes navigation and hides
UI, but the corresponding API routes still accept the operation. A shop that switches off
`reviews` still accepts a review submission; one that switches off `waitlist` still accepts
a waitlist claim. This is a real gap, not a documentation problem.

### Why it is recorded rather than patched in a single pass

Each of those routes needs an `assertFeatureEnabled(businessId, key)` guard placed after
tenant resolution and before the write, plus a regression test proving the refusal and
proving the enabled path still works. Doing 23 guards blind, in one commit, across booking,
payments, notifications and marketing is exactly the change that breaks working features.

### Until then

Do not describe these toggles to an owner as disabling the capability. The honest wording
is that the switch hides the feature from the interface. `onlineBooking` is the only
toggle that can be described as fully disabling its feature.

Enforced on the server as of this revision, each proven by `tests/feature-enforcement.test.ts`:

- `onlineBooking` — the booking flow was already gated; unchanged.
- `queue` — a public queue join is refused.
- `inventory` — creating stock is refused; reading stays open so history remains visible.
- `marketing` — creating a campaign is refused, checked before the owner test.
- `ecommerce` — checkout is refused before any order is created.
- `reviews` — published reviews are no longer presented on the public site.
- `barberProfiles` — the public profile page returns 404.
- `reviewRequests` — the cron stops enqueuing new requests; queued ones are untouched.

Still presentation-only, and must not be described to owners as fully switched off:
customerPortal, gallery, promotions, loyalty, waitlist, analytics, multipleBarbers,
deposits, pwa, emailNotifications, smsNotifications, onlinePayments, memberships.

That is 8 of 21 enforced, 13 outstanding. The count is deliberately stated as a number
so it can be checked rather than believed.

