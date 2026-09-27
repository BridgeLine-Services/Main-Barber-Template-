# Payments

The template ships **pay-at-shop by default**: customers book online and
pay in person. `Business.paymentInPerson` (default `true`) is the
business-level payment switch. This document defines the payment
architecture and the exact contract for adding an online provider
(e.g. Stripe) later **without touching booking logic**.

## Architecture

```
src/lib/payments/
  types.ts          PaymentProvider interface + ledger types
  state-machine.ts Legal PaymentStatus transitions (single source of truth)
  providers/
    in-person.ts    Pay-at-shop provider (default)
  index.ts          Provider registry + resolvePaymentProvider()
prisma/schema.prisma
  model Payment     Provider-agnostic ledger (migration 20260927163000)
```

The `Payment` ledger stores **only** amounts, kinds (CHARGE / DEPOSIT /
TIP / REFUND), methods, provider references and statuses — never card
numbers, CVV, or bank credentials.

### Status machine

| From        | Allowed transitions                          |
|-------------|----------------------------------------------|
| PENDING     | PROCESSING, SUCCEEDED, FAILED, CANCELED      |
| PROCESSING  | SUCCEEDED, FAILED, CANCELED                  |
| SUCCEEDED   | REFUNDED                                     |
| FAILED      | PENDING (retry)                              |
| CANCELED    | (terminal)                                   |
| REFUNDED    | (terminal)                                   |

All status changes go through `canTransition()` — providers and API
routes must never assign `status` directly. Refunds create a separate
`kind=REFUND` ledger row (negative amount) referencing the original and
mark the original `REFUNDED`, atomically in one transaction.

### Tenant safety

- Every payment row carries a required `businessId` (cascade from
  `Business`); provider operations take a `ProviderContext` with
  `businessId` and read/write only within it.
- `Payment` is included in the RLS policy template
  (`prisma/rls/production-rls.sql`, applied via `npm run db:apply-rls`).
- `idempotencyKey` is unique per row: provider retries and webhook
  replays cannot double-charge.

## Adding an online provider (e.g. Stripe)

The provider contract (`src/lib/payments/types.ts`) is the only thing a
new provider implements:

1. Create `src/lib/payments/providers/stripe.ts` implementing
   `PaymentProvider` (`id: 'stripe'`, `online: true`). Requirements:
   - Server-side operations only; secret keys in environment variables
     (`STRIPE_SECRET_KEY`) — never in the browser.
   - Never accept or store raw card numbers or CVV; use the provider's
     hosted/elements flow where card data goes directly to the provider.
   - `createCharge` returns a client-handoff reference (e.g. intent
     client secret) via `metadata` — not card data.
   - Validate webhook signatures against the raw body
     (`STRIPE_WEBHOOK_SECRET`), reject invalid signatures, and map
     events to ledger transitions **through the state machine**.
   - Process webhooks idempotently: look up the payment by
     `idempotencyKey` (the provider event id) before mutating.
2. Register it in `src/lib/payments/index.ts` (`REGISTRY`) and extend
   `resolvePaymentProvider` to read the business's payment
   configuration (add a `paymentOnlineProvider` column in a migration).
3. Add a webhook route `POST /api/webhooks/stripe` that only sets the
   tenant context from the event's payment `businessId`, verifies the
   signature, and applies transitions.
4. Add tests mirroring `tests/payment-transitions.test.ts`.

**None of this requires changes to booking logic** — booking code talks
only to `resolvePaymentProvider()` and the `Payment` ledger.

## Environment variables

None required for the default pay-at-shop provider. An online provider
adds its own (e.g. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) —
never commit them; see `.gitignore` and `docs/OPERATIONS.md`.

## Tests

`tests/payment-transitions.test.ts` — 51 assertions: full transition
matrix, in-person flow, illegal operations refused, idempotency
uniqueness, cross-tenant refusal, fail-closed provider resolution.
