# Ecommerce — optional product storefront

Prompt 7 feature. Each shop can sell physical products (haircare, merch)
and digital products (e.g. style guides) through its white-label site.
**Fail-closed**: off for every business until the owner enables it, and an
order is **never PAID until its payment settles** (Stripe webhook or POS).

## Enablement (per business)

1. `EcommerceSettings.enabled` — the owner master switch.
2. Feature flag `ecommerce: true` in `Business.featureOverrides`.

Both ship off. With the switch off, storefront routes return a clear
disabled state — nothing is simulated.

## Data model (migration 20261017070617_add_ecommerce)

| Model | Purpose |
|---|---|
| `EcommerceSettings` | master switch, currency, flat tax rate %, flat shipping rate, free-shipping threshold |
| `Product` | catalog item: price, images, `published` flag, `productType` (PHYSICAL / DIGITAL), `stock` (-1 = untracked), download URL for digital goods |
| `ShopOrder` | guest-friendly order (email contact, no account required), status machine, `paymentId` link, unique `idempotencyKey` |
| `OrderItem` | per-line **snapshot** of name/unit price/quantity; product link is `SetNull` so history survives catalog changes |

Orders reuse the existing `Payment` ledger (`metadata: { orderId,
shopOrder: true }`) — identical pattern to gift cards and memberships —
so the whole payment state machine, refunds, and reconciliation apply.

## Security invariants

- **Server-side price verification**: checkout submits product ids and
  quantities only. Unit prices, tax, shipping, and totals are computed from
  the database. Client-supplied numbers are never read.
- **Inventory races**: stock is reserved with a single atomic conditional
  `UPDATE ... WHERE stock >= qty` inside the order transaction — concurrent
  checkouts cannot oversell. Cancellations and payment failures restock
  inside a transaction.
- **Duplicate webhooks**: `payment_intent.succeeded` → `markOrderPaidForPayment`
  is guarded by the PENDING status check and unique payment link; a replay is
  a no-op. `payment_intent.payment_failed` / `.canceled` release stock and
  set `PAYMENT_FAILED`.
- **Tenant isolation**: every query filters by `businessId`; a foreign
  business's product id is rejected at checkout, never silently merged.
- **No card data**: only provider references are stored.

## Order status machine

```
PENDING ──(payment settles)──▶ PAID ──▶ PROCESSING ──▶ SHIPPED ──▶ DELIVERED
   │                             │
   │(payment fails/canceled)     └── refunds flow through the Payment ledger
   ▼                                        (REFUNDED)
PAYMENT_FAILED / CANCELED (stock released)
```

## API surface

Owner/staff (session-scoped, role-checked):
- `GET /api/dashboard/ecommerce/orders` — order list + stats
- `PATCH /api/dashboard/ecommerce/orders/[id]` — fulfillment transitions,
  cancellation, refunds (via existing payment refund flow)
- `GET/POST/PATCH/DELETE /api/dashboard/ecommerce/products` — catalog CRUD
- `GET/PATCH /api/dashboard/ecommerce/settings`

Public (guest, no account):
- `GET /api/ecommerce/products` — published catalog
- `POST /api/ecommerce/checkout` — order creation (idempotency key supported)

## Shipping & tax — simple, documented rules

The template ships with **flat-rate** shipping and a **flat tax percent**
configured by the owner (free-shipping threshold supported). No carrier or
tax-provider integration is claimed. Digital-only orders never charge
shipping. Anything more advanced (carriers, live tax APIs) is an explicit
extension point — see "Extending" below.

## Provider setup required before LIVE billing

Same as the rest of the template: `STRIPE_SECRET_KEY`,
`STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and the `onlinePayments`
flag. Without them the
storefront shows a clear disabled state for online payment, and POS
(IN_PERSON) checkout works for in-shop sales. **No purchase is ever
simulated.**

## Extending

- Carriers / live tax rates: implement a provider adapter alongside
  `src/lib/ecommerce.ts` and replace the flat calculations in
  `createOrder`.
- Transactional order emails: wire the existing notification infrastructure
  (email provider) into `markOrderPaidForPayment` / fulfillment transitions.

## Tests

```
npm run test:ecommerce   # 34 assertions: gate, price verification, inventory
                         # races, idempotency, duplicate webhooks, failure
                         # restock, cancellation, fulfillment, isolation, stats
```

Runs in CI (`npm run test:ci`). Tests create and remove their own fixtures;
no production data is ever touched.

## Storefront & dashboard UI (migration 20261017161930_shop_order_confirmation_email)

Public pages (tenant-scoped, gated on feature flag AND settings.enabled):

- `/shop` — published-product catalog (server-rendered prices; the client
  cart is display-only and keyed per business slug: `shopCart:<slug>`)
- `/shop/cart` — quantity edit, subtotal preview, checkout entry
- `/shop/checkout` — guest checkout (name + email + optional shipping
  address) through Stripe Payment Element. The client submits ONLY
  `productId` + `quantity` lines plus an `Idempotency-Key` header; every
  price, tax and shipping amount is recomputed server-side.
- `GET /api/ecommerce/order-status?slug=&orderId=&email=` — public
  email-gated order lookup for the confirmation screen. Missing order and
  wrong email share ONE response branch, so order ids cannot be enumerated.
- Navbar/Footer link `/shop` only when `isStorefrontUsable` is true.

Dashboard (`/dashboard/ecommerce`, owner/BUSINESS_ADMIN):

- Storefront master switch + tax/shipping/support-email settings
  (`PATCH /api/dashboard/ecommerce/settings`)
- Product catalog: create/edit, publish/hide, stock with low-stock
  highlighting (`/api/dashboard/ecommerce/products`)
- Order management (`/dashboard/ecommerce/orders`): status filters + stats,
  fulfillment state machine actions (PROCESSING/SHIPPED with tracking
  number/DELIVERED), cancel + restock, refund via the payment provider
  (`PATCH /api/dashboard/ecommerce/orders/[id]`)

### Transactional order email

When a payment settles (Stripe webhook → `markOrderPaidForPayment`), the
PENDING→PAID transition fires a fire-and-forget order confirmation email
after the transaction commits. Design constraints:

- An SMTP outage can never fail the webhook (email runs detached, errors are
  swallowed after logging)
- Fires exactly once: only the single PENDING→PAID transition triggers it,
  webhook retries hit the no-op path, and the notification log entry uses
  the idempotency key `<orderNumber>:ORDER_CONFIRMED`
- Logged under the new `SHOP_ORDER_CONFIRMATION` NotificationType
  (migration `20261017161930_shop_order_confirmation_email`)
- All interpolated customer input is HTML-escaped in the template

### Tests

`npm run test:shop-ui` (26 assertions, part of `test:ci`) covers the
settlement→email hook (exactly-once, no-throw without SMTP), checkout
payload hygiene (no client prices), per-slug cart isolation, email-gated
order status with no enumeration, and email template escaping.
