# Referral program

## Customer sharing

A signed-in customer can find their share code and link in the customer portal. The link uses the existing referral-code format and points to `/book?ref=CODE`. On browsers that support the Web Share API, the Share action opens the native sharing sheet; Copy link remains available as a fallback. The portal reports aggregate attributed-customer and completed-booking counts only; it does not reveal other customers' names or contact details.

The customer endpoint derives the customer from the authenticated customer session and active shop context. It never accepts a customer ID or business ID from the browser. Code creation is a POST and only happens while the shop program is enabled.

## Owner management

Owners can manage the program at `/dashboard/referrals`. The switch updates the existing referral program record; switching off requires confirmation in the interface and does not delete codes, attributions, or history. Customer lookup is debounced, requires at least two characters, is tenant-scoped, and returns at most 20 results. Issued codes use the shared generator and link helper.

## Attribution and reporting rules

Referral codes are resolved against the active program and code records for the booking's business. Attribution is decided in the existing serializable booking transaction. First-visit eligibility, self-referral checks, and the unique `ReferralAttribution.customerId` constraint prevent repeat or self attribution. Inserts use `createMany({ skipDuplicates: true })`; attribution errors are logged with a structured event and a database error code only, and do not roll back a valid booking. The booking transaction retries serialization and deadlock contention up to three times.

Dashboard counts distinguish attributed customers, customers with at least one completed booking, total completed bookings, and repeat bookings after the first completion. A link click alone is not an attribution. Revenue includes only settled CHARGE/DEPOSIT payment rows attached to completed appointments, net of their recorded refunds. Duplicate provider references are counted once; pending payments, tips, shop-order payments, and payments unrelated to completed referred appointments are excluded. If a completed appointment has no verifiable payment record, currency cannot be verified, or a read fails, revenue is unknown rather than reported as zero. Revenue is not profit.

Referral source and campaign groups describe attribution records, not clicks. All reporting and customer searches are scoped to the authenticated business.

## Verification

Run the pure referral checks with `npm run test:growth-referrals`. Run database-backed booking attribution and simultaneous booking checks with `npm run test:referral-attribution` against a configured test database.
