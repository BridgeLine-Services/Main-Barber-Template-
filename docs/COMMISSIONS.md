# Barber Commissions

An owner-controlled commission system that tracks what each barber earns, per
service, product, and tip, in an immutable per-appointment ledger. Fully
optional: it ships **disabled** and touches nothing until the owner turns it on.

## Design principles

- **Owner-only financials.** Only `OWNER` / `PLATFORM_OWNER` can configure
  rates, view shop-wide reports, or run payouts. Business admins get
  operational tools but not shop financials.
- **Safe by default.** The master switch starts OFF. Fresh shops read
  safe defaults (40% fallback rate, tips EXCLUDED, no fee commissions).
- **Immutable ledger.** Commissions are append-only. Refunds and manual
  corrections are stored as adjustments; rows are never rewritten or deleted.
- **Never breaks checkout.** Commission hooks are no-ops when disabled and
  never throw into the payment flow.
- **Tenant-isolated.** Every query is scoped by `businessId`; commission data
  can never cross tenants (see `tests/commissions.test.ts`).

## Data model (`prisma/schema.prisma`)

| Model | Purpose |
|---|---|
| `CommissionSettings` | Per-shop master switch + defaults (1:1 with Business) |
| `CommissionRule` | Rate overrides. Priority: **barber+service > barber > service > default**. `scopeKey` (`barberId\|serviceId`, `''` for null) enforces uniqueness because Postgres treats NULLs as distinct |
| `CommissionEntry` | The ledger: one row per commissioned line (source: SERVICE / PRODUCT / TIP). Payout = `commissionAmount + adjustment + refundAdjustment` |
| `BarberCommissionParticipation` | Per-barber opt-in/opt-out (default: participating) |

## What earns commission

| Source | Behavior |
|---|---|
| Service | Post-discount service subtotal, via the resolved rate. Never tax. |
| Product | POS product line items (`kind: 'PRODUCT'`) only — owner opt-in. Custom/manual items never. |
| Tips | `EXCLUDED` (default, barber keeps tips) / `PASS_THROUGH` (full tip to payout) / `PERCENT` (configured % of tip). |
| No-show fee | Only when the owner opts in (`includeNoShowFees`). |
| Cancellation fee | **Never** commissioned. |
| Unpaid completion | Owner opt-in (`calculateOnUnpaid`): a COMPLETED appointment earns its service commission even without POS checkout (pay-at-shop shops). POS-charged appointments never double-count. |

## Refunds

`adjustCommissionsForRefund` reconciles entries against a charge's current
`refundedAmount` — proportional, idempotent (replays converge), clamped to
zero. Refunds set `refundAdjustment` and flag unpaid entries `ADJUSTED`; the
original amount stays untouched.

## API surface (all `/api/dashboard/commissions/...`)

| Endpoint | Roles | Purpose |
|---|---|---|
| `GET/POST settings` | OWNER | Master switch, default rate, tips mode, fee opt-ins |
| `GET/POST/DELETE rules` | OWNER | Rate overrides (upsert by scope) |
| `GET report?range=&barberId=` | OWNER | Aggregated per-barber report (`today`/`week`/`month`/`custom`) |
| `GET report.csv?...` | OWNER | CSV export (weekly-sheet style: summary, TOTAL, per-barber blocks) |
| `GET/POST/DELETE entries` | OWNER | Ledger drill-down; POST approves/pays (`APPROVED`/`PAID` + adjustment) |
| `GET/PUT my` | BARBER (self) | Own earnings summary + opt-in/opt-out. Requires `barberSelfViewEnabled`; owner-tenant barbers are excluded. |

Every mutation writes an `AuditLog` entry (`COMMISSION_*` actions) with
before/after context.

## Dashboard UI

- **Owner → Commissions** (`/dashboard/commissions`): settings card, rules
  editor, report with per-barber breakdown, ledger table with approve /
  adjust / mark-paid, CSV download.
- **Barber → My Commissions** (`/dashboard/my-commissions`): summary of
  pending / paid / refunded-take, recent entries, participation toggle.
  Hidden unless the owner enables self-view.

## Integration points

- `completeCheckout` (`src/lib/payments/pos.ts`) — creates entries inside the
  checkout transaction (atomic with the payment).
- Refund path (`refunds`) — reconciles the ledger on partial/full refunds.
- `POST /api/dashboard/appointments/[id]` — on a `COMPLETED` transition, fires
  `recordCommissionForUnpaidCompletion` (opt-in no-op by default).

## Testing

`npm run test:commissions` (also part of `test:ci` and `test:all`) — 74
assertions covering settings, rate priority, ledger math, tips modes,
participation, refund reconciliation, fees, unpaid completions, the master
switch, report/CSV aggregation, tenant isolation, and payout math.
