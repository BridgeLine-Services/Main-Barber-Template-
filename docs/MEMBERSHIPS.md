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

## Recurring billing — REQUIRED EXTERNAL SETUP (not yet live)

Recurring charges need a **Stripe Subscriptions** configuration: STRIPE
secret key + webhook secret, a Stripe Customer per member
(`Customer.stripeCustomerId`), a Stripe Price per plan, and handling of
`invoice.paid`, `invoice.payment_failed` and
`customer.subscription.deleted` webhooks. Until that setup exists the
system **never fabricates a renewal charge**: lapsed memberships move to
PAST_DUE and expire per the grace policy above. The activation path
(`activateMembershipForPayment`) and the `subscriptionRef` field are ready
to receive subscription invoice events unchanged.

## Scheduling

Add a scheduled job (e.g. daily cron calling
`processMembershipPeriodEnds` per business) — see the Superagent/workflow
scheduler or any external cron hitting a protected admin endpoint.

## Tests

```
npm run test:memberships   # 31 assertions: gate, activation, benefits,
                           # dedup, isolation, cancellation, period-end, stats
```

Runs in CI (`npm run test:ci`). All fixtures are created and removed by the
test itself; no production data is ever touched.
