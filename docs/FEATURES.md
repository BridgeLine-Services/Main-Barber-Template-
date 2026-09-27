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
