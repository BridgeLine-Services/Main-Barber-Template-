# Gift Cards

Optional, owner-controlled gift card system. Shops issue their own gift
cards (digital and physical) and redeem them at checkout. This is shop
bookkeeping for cards the shop itself issues — **it is never a stored-value
payment provider or money transmitter**; the money moves through the shop's
existing payment methods.

## Owner control

`GiftCardSettings.enabled` is the shop-level master switch (default **OFF**,
lazily created on first read, owner-only PATCH via
`/api/dashboard/gift-cards/settings`):

- **OFF** — gift cards cannot be purchased or redeemed (server-enforced in
  `sellGiftCard` and `redeemGiftCardInTx`). Existing cards and their full
  transaction history remain intact and readable. Appointments, payments,
  commissions, time clock, and payroll are completely unaffected.
- **ON** — staff can sell cards in the POS, customers can redeem at
  checkout, and (when the shop has online payments configured) customers can
  buy digital cards from the website.

Other settings: `denominations` (suggested amounts, default $25/$50/$75/$100
— any custom amount $1–$5,000 is allowed) and `defaultValidityMonths`
(0 = no expiration).

## Card model

Every card has: a server-generated unique code, initial value, remaining
balance, status (`PENDING` → `ACTIVE` → `DEPLETED`), purchaser (name/email,
optionally linked to a customer record), optional recipient (name/email) and
message, creation date, optional expiration date, and an append-only
transaction history.

## Code security

- Codes are generated server-side from a 31-symbol unambiguous alphabet
  (no 0/O, 1/I/L/U), format `XXXX-XXXX-XXXX-XXXX` (~79 bits of entropy).
  Codes are **never** accepted from the client at creation.
- Globally unique (DB unique index; generation retries on collision).
- Redemption validates server-side: existence (tenant-scoped), status,
  expiration, and balance.
- **Race safety**: the balance decrement is a conditional atomic UPDATE
  (`remainingBalance >= applied AND status = 'ACTIVE' AND not expired`).
  Two simultaneous checkouts can never overdraw a card — the loser's
  checkout rolls back with `CONCURRENT_REDEMPTION`.

## Purchase

- **POS sale** (`POST /api/dashboard/gift-cards`): owner/admin always;
  barbers only when the owner enabled barber checkout. Records a
  `SUCCEEDED` payment (cash / in-person card) and creates an `ACTIVE` card
  in one transaction.
- **Website purchase** (`POST /api/gift-cards/purchase`): creates a
  `PENDING` charge through the shop's online provider (Stripe) plus a
  `PENDING` gift card; the Stripe webhook settles the payment and activates
  the card (`activateGiftCardForPayment`). Fails closed with a clear error
  when the shop has no online provider — customers cannot mint cards for
  money the shop cannot collect online.
- Purchaser supplies recipient name/email and an optional message.
- **Website page** (`/gift-cards`): public purchase page with Stripe Payment
  Element. Denomination chips + custom amount, purchaser/recipient fields,
  and a success screen that reveals the code only after payment confirms
  and polls the card status until activation. The nav and footer links are
  rendered only while the owner has gift cards enabled. When online
  payments aren't configured the page falls back to an "available in-store"
  card with the shop's contact details — it never shows a broken form.
- **Delivery email**: on webhook activation of an online purchase, the card
  (code, value, expiry, personal message) is emailed to the recipient when
  provided, else the purchaser. Best-effort — activation never rolls back
  on a mail outage, and is skipped when SMTP isn't configured.

## Redemption (checkout)

`completeCheckout` accepts an optional `giftCardCode`. Inside the checkout
transaction the card is validated and applied first — up to its full
remaining balance — and the remainder is charged to the chosen payment
method:

```
Gift card balance: $50      Checkout total: $70
Gift card payment: $50      Cash/card charge: $20
```

- The redemption is a real `Payment` row (`method: GIFT_CARD`,
  `provider: gift_card`), so receipts, financial summaries, and refunds all
  keep working unchanged.
- When the card covers the whole ticket, no secondary charge row is created.
- Commission entries are created exactly as before (attached to the
  non-gift-card charge, or the gift card payment when it covers everything).

## Refunds

Handled in the same transaction as the provider refund
(`adjustGiftCardForRefund`, also wired into the Stripe webhook):

- Refunding a **redemption** restores the money to the card
  (idempotent — recomputed from `refundedAmount`).
- Refunding a card's **purchase payment** removes the refunded value from
  the card (clamped at 0; the shop owes the purchaser cash back).

## Reporting (owner)

`GET /api/dashboard/gift-cards` returns the owner summary: cards sold
(count + amount), redemptions (count + amount), refunds, and the shop's
**outstanding gift card liability** (remaining balances of active,
unexpired cards), plus per-card balances with filters and search.
Owner/admin only — never exposed to barbers or customers.

## Owner adjustments

`POST /api/dashboard/gift-cards/[id]/adjust` (owner-only) applies a manual
balance correction (e.g. a misprinted physical card) with a required
reason, clamped to `[0, initialValue]`, and records an `ADJUSTMENT` ledger
row. The ledger is append-only: history is never rewritten.

## API surface

| Route | Method | Who | Purpose |
|---|---|---|---|
| `/api/dashboard/gift-cards/settings` | GET | staff | enabled flag + denominations (POS display) |
| `/api/dashboard/gift-cards/settings` | PATCH | owner | enable/disable, denominations, validity |
| `/api/dashboard/gift-cards` | GET | owner/admin | list + reporting summary |
| `/api/dashboard/gift-cards` | POST | owner/admin/barber* | sell a card (POS) |
| `/api/dashboard/gift-cards/[id]` | GET | owner/admin | card detail + transaction history |
| `/api/dashboard/gift-cards/[id]/adjust` | POST | owner | manual balance adjustment |
| `/api/gift-cards/purchase` | POST | public | customer digital purchase (online only) |
| `/api/gift-cards/status?id=` | GET | public | status-only lookup for the success screen (never returns the code) |
| `/api/dashboard/payments/checkout/[appointmentId]` | POST | POS | `giftCardCode` field applies a card |

\* barbers only when the owner enabled barber checkout.

Dashboard UI: `/dashboard/gift-cards` (owner/admin) — settings toggle, sell
dialog, card table with detail drawer, adjustment form, and summary tiles.

## Data model

`GiftCardSettings`, `GiftCard`, `GiftCardTransaction` (append-only ledger:
every `PURCHASE` / `REDEMPTION` / `REFUND` / `ADJUSTMENT` with the resulting
balance). All three are tenant-isolated with RLS (see
`prisma/rls/production-rls.sql`) and businessId-scoped in every query.
`PaymentMethod` gains `GIFT_CARD` so redemptions live in the normal payment
ledger.

## Testing

`npm run test:gift-cards` (registered in `test:ci` and `test:all`) — 82
assertions covering settings/owner authority, the master switch, code
security, purchase, full/partial/multiple redemption, invalid + expired
codes, refunds (redemption and purchase, idempotency), concurrent
redemption, adjustments, commissions integration, reporting, online
activation, and tenant isolation.
