# Optional features

> **Current state — verified 2026-11-05 at commit 4105997 on `feat/non-technical-business-dashboard`.**
>
> Every claim below this banner that contradicts the audit output is historical and
> kept as a record of what was true at the commit it names. Read this box first.
>
> - `npm run audit:features` reports **20 of 20 keys consulted by server code**. Note
>   the precise word: *consulted*. For read-oriented features (gallery, reviews,
>   analytics) that means the server withholds the data; for write-oriented features
>   (online booking, waitlist, queue) it means the endpoint refuses the action. A
>   switch is never described to an owner as "deleting" anything, because none do.
> - There is now an owner-facing **Settings > Features** tab
>   (`src/components/dashboard/FeaturesTab.tsx`). Before this commit the toggles were
>   enforced server-side but had no interface at all, which meant an owner could not
>   see or change them.
> - Features that depend on an outside service (email, SMS, online payments, review
>   requests) fail closed when that service is not configured, and the tab says so in
>   the owner's own words rather than listing an environment variable.
> - Disabling a feature never deletes business data: appointments, photos, membership
>   records and customer details are untouched, and the copy states that.
>
> The historical audit sections below (including the one that found "1 of 24 keys
> enforced") are intentionally preserved. They are how the gap was found and closed.

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

## Enforcement status, verified 5 November 2026 (final revision)

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
- `memberships` — enrolling a customer is refused; existing memberships are untouched.
- `gallery` — adding a picture is refused; existing pictures stay.
- `multipleBarbers` — adding a barber is refused.
- `loyalty` — configuring the programme is refused.
- `onlinePayments` — starting a card payment is refused before a Payment row exists.
- `analytics` — the report payload is refused.
- `deposits` — requesting a deposit is refused before any payment intent exists.
- `customerPortal` — a portal link no longer resolves.
- `emailNotifications`, `smsNotifications` — the worker marks a queued message with the
  reason instead of calling the provider. Nothing is deleted, so the owner can see what
  did not go out.

Still presentation-only, and must not be described to owners as fully switched off:
- `waitlist` — claiming an opening is refused; the waitlist entry is left in place so the
  owner still sees it.
- `pwa` — the manifest stops being installable (no icons, `display: browser`). The site
  itself is unaffected.

`promotions` has been removed. Nothing in the application implemented it, so the toggle
could not do anything, and a switch that does nothing is worse than no switch: an owner
turns it off and believes something changed.

That is 20 of 20 enforced by a server check, with no presentation-only keys left. The count is deliberately stated as a number
so it can be checked rather than believed.


## Enforcement classes, verified by location

Checked on 2026-11-05 at `b56f310`. `audit:features` answers "does server code consult this key";
this table answers the follow-up question an owner actually cares about: *what stops?*

| Class | What the switch stops | Keys |
| --- | --- | --- |
| Refused at the API | The request is denied, so the operation cannot happen at all. | `onlineBooking`, `customerPortal`, `gallery`, `loyalty`, `waitlist`, `queue`, `inventory`, `marketing`, `analytics`, `multipleBarbers`, `deposits`, `onlinePayments`, `memberships`, `ecommerce` |
| Changed on the public side | The public route or worker behaves differently; no dashboard feature is removed. | `reviews` (public `/reviews` page shows nothing), `barberProfiles` (public `/barbers/[slug]` page refuses), `pwa` (`app/manifest.ts` stops offering install), `emailNotifications` (notification worker skips the send), `smsNotifications` (notification worker skips the send), `reviewRequests` (review-request worker skips the request) |

Two consequences for how this is described to owners:

- The six in the second row must never be sold as "switches the feature off". They govern
  publication and sending. The Features tab carries that sentence on each of those rows.
- `reviews` has no public submission form. Reviews arrive through the dashboard reviews
  screen and the Google Business import, so the switch withholds publication, and the tab
  says "Reviews you have recorded appear on your website" rather than promising that
  customers can post one.

Nothing in either class deletes a record.
