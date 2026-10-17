# Memberships — optional, owner-controlled paid membership plans

Prompt 6 feature. Each shop can independently offer paid memberships (e.g.
"$25/month: 2 included cuts + 20% off additional services"). The system is
**fail-closed**: off for every business until the owner turns it on, and a
membership is **never active until its first payment is verified**.

## Enablement (per business)

Two switches, both required:

1. `MembershipSettings.enabled` — the owner master switch
   (`PATCH /api/dashboard/memberships/settings`).
2. Feature flag `memberships: true` in `Business.featureOverrides`
   (standard feature-flag system, see `src/lib/features.ts`).

Neither ships enabled. Existing memberships and history are never touched
when the switch goes back off.

## Data model (migration 20261017061911_add_memberships)

| Model | Purpose |
|---|---|
| `MembershipSettings` | per-business master switch, notice days, grace days, terms text |
| `MembershipPlan` | name, price, billing interval (MONTHLY/QUARTERLY/YEARLY), benefits: `serviceDiscountPercent` (0–100), `includedVisitsPerPeriod` (0 = none, -1 = unlimited), rolling `visitWindowDays`, active flag |
| `Membership` | customer enrollment; status machine below; period bounds; `subscriptionRef` (provider subscription id, never card data) |
| `MembershipUsage` | one row per benefit redemption; `@@unique([membershipId, appointmentId, benefitType])` makes duplicate redemption of the same appointment **impossible at the database level** |

Membership payments reuse the existing `Payment` ledger (`kind: CHARGE`,
`metadata: { membershipId, membershipEnrollment: true }`) — the same
pattern as gift-card purchases, so refunds, reconciliation and the payment
state machine apply unchanged.

## Status machine

```
enroll ─────────────▶ PENDING ──(verified payment)──▶ ACTIVE ──(period ends, autoRenew)──▶ PAST_DUE
                       │  ▲                              │                                   │
                       │  └──(payment failed)────────────┘                                   │(grace days)
                       │                                                                       ▼
   cancel(pending) ────┼──────────────────────▶ CANCELED ◀──(period ends, !autoRenew)──  EXPIRED
```

- **PENDING** — enrolled, awaiting first payment. Duplicate enrollment is
  rejected while PENDING or ACTIVE. Cancellation is immediate.
- **ACTIVE** — first payment settled (POS or Stripe webhook; activation is
  idempotent). Benefits available. Cancellation keeps benefits until period
  end (auto-renew off).
- **PAST_DUE** — period ended with auto-renew on and no verified renewal.
  No benefits. Expires after `pastDueGraceDays` (default 7).
- **PAYMENT_FAILED / CANCELED / EXPIRED** — terminal states for a period.

`processMembershipPeriodEnds(businessId)` performs period-end transitions.
It must be run by a scheduled job per business (see "Scheduling" below).

## Benefits

`quoteBenefit()` (pure, no writes) returns what an appointment's service
price would cost: included visit first (while visits remain in the rolling
window), then the percentage discount. `applyBenefitForAppointment()`
records the redemption; the unique constraint makes double-redemption of
the same appointment a safe no-op.

## API surface

Owner/staff (dashboard, role-checked, tenant-scoped via session business):
- `GET/PATCH /api/dashboard/memberships/settings`
- `GET/POST /api/dashboard/memberships/plans`, `PATCH/DELETE .../plans/:id`
- `POST /api/dashboard/memberships/enroll` — creates PENDING + membership
  payment (POS or Stripe PaymentIntent with membership metadata)
- `POST /api/dashboard/memberships/:id/cancel`
- `GET /api/dashboard/memberships` — stats + list

## Recurring billing (Stripe Subscriptions)

Implemented end-to-end server-side (`src/lib/payments/stripe-subscriptions.ts`
+ lifecycle handlers in `src/lib/memberships.ts`). With STRIPE_SECRET_KEY
configured:

1. `enrollWithSubscription` creates the PENDING membership, then the real
   Stripe Customer (reusing `Customer.stripeCustomerId` when present),
   Product + Price per plan (Price id cached on `MembershipPlan.providerPriceRef`),
   and Subscription (idempotency-keyed). The membership still activates
   ONLY on a signature-verified webhook — never on a redirect.
2. Webhooks (all idempotent; the StripeEvent unique table dedups event
   deliveries, handlers add state-level idempotency):
   - `invoice.paid` → period advances ONLY forward (replayed or stale
     invoices can neither duplicate nor rewind a period)
   - `invoice.payment_failed` → PAST_DUE (ACTIVE) or PAYMENT_FAILED (PENDING);
     never a free period
   - `customer.subscription.updated` → syncs `cancel_at_period_end`
     (autoRenew) and provider past_due/canceled state
   - `customer.subscription.deleted` → CANCELED (or PAYMENT_FAILED when
     never activated). Webhooks for ended memberships are refused and
     flagged for reconciliation (no resurrection).
3. Provider cancellation: `cancelSubscription` (immediate) and
   `scheduleSubscriptionCancelAtPeriodEnd` (period-end, mirrors owner-side
   cancellation).

Fail-closed: without STRIPE_SECRET_KEY the subscription path throws a clear
`RECURRING_NOT_CONFIGURED` error and NEVER simulates a charge. Lapsed
memberships still move to PAST_DUE and expire per the grace policy. The
one-time first-period POS path is unchanged.

## Scheduling (durable period processing)

`GET /api/cron/memberships` — Vercel Cron hourly (see `vercel.json`), same
CRON_SECRET Bearer protection as the reminders job. Per business with the
memberships flag enabled, runs `processMembershipPeriodEnds`:
ACTIVE+ended+autoRenew → PAST_DUE (a renewal ONLY happens via a verified
invoice webhook — the job never invents a charge), ACTIVE+ended+!autoRenew
→ CANCELED, PAST_DUE beyond grace → EXPIRED. Every transition is guarded
by status + period timestamps, so missed runs converge safely on catch-up.
Returns `{ok, businesses, processed, errors, detail}` for monitoring.

## Tests

```
npm run test:memberships           # 31 assertions: gate, activation, benefits,
                                   # dedup, isolation, cancellation, period-end, stats
npm run test:memberships-renewals  # 30 assertions: subscription lifecycle
                                   # (renew/replay/out-of-order, failed renewal,
                                   # delete/update sync, period-end job, grace,
                                   # idempotent re-runs, isolation, no-resurrect)
```

Runs in CI (`npm run test:ci`). All fixtures are created and removed by the
test itself; no production data is ever touched.
