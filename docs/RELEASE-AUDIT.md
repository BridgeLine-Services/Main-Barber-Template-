# Prompt 8 release audit

## Scope

This audit covers dependency risk, licensing evidence, CI gates, operations, accessibility, environment handling, and release limitations. It is an engineering report, not legal advice or a production approval.

## Changes in this pass

- Added `npm run license:inventory`, which writes an installed dependency inventory to `dependency-license-inventory.md` and reports packages whose metadata does not identify a license.
- Added the license inventory gate to pull-request CI.
- Changed CI to use the repository's `npm run typecheck` script instead of duplicating its command.
- Preserved the proprietary repository license in `LICENSE`; dependency licenses remain separate obligations and must be reviewed from the generated inventory and package notices.

## Verification

Run from a clean checkout after `npm ci`:

- `npm audit --omit=dev --audit-level=critical` — production audit gate. Current audit output reports high advisories in transitive Prisma configuration packages and `@vercel/blob`/OIDC dependency paths, plus moderate Nodemailer advisories. No automatic major upgrade is included: npm recommends Prisma 7.10.1 and a Blob downgrade, both requiring compatibility review.
- `npm run license:inventory` — generates the inventory; unknown license metadata is reported for manual review rather than incorrectly declared compliant.
- `npm run lint` — passes with existing warnings; warnings are not silently represented as zero findings.
- `npm run typecheck` — passes.
- CI also runs architecture checks, Prisma validation/generation/migrations, database-backed regression tests, production build, owner/co-owner journeys, and Playwright E2E.

The full `npm run test:all`, production build, browser accessibility suite, staging acceptance, and restore drill require the configured test database/browser or deployment environment and are not claimed as passing by this document.

## Accessibility and owner operations

The existing `/accessibility` statement describes ongoing improvement and does not promise lawsuit-proof compliance. Release review must still include keyboard-only navigation, visible focus, screen-reader labels, form-error association, contrast, zoom/reflow, and axe checks. Operations must be configured per client: environment secrets, cron authorization, daily/weekly backups, quarterly restore drills, monitoring, incident response, provider-outage handling, export/deletion, and offboarding.

## Release gate

Do not approve production release until dependency advisories have an owner and upgrade decision, generated license inventory and third-party notices are reviewed, migrations/RLS are verified on staging, all required regression tests pass, the client-copy dry run is reviewed, legal drafts are approved by counsel, and a human signs off staging acceptance. Required runtime variables are documented in `docs/environment-configuration.md`; never commit or log their values.

## Dependency audit — 2026-11-04

`npm audit --omit=dev` reported 6 advisories (5 high, 1 moderate). Handled:

| Package | Was | Now | Reason |
| --- | --- | --- | --- |
| `nodemailer` | ^10.0.12 (advisory GHSA-8c8m-p3m8-cjg8, addressparser comment nesting) | ^10.3.1 | Fixed in 10.1.4; the app sends through this directly, so the vulnerable parser was reachable from email addresses we pass in |
| `zod` | ^4.4.3 (< 4.6.6, memory exhaustion on oversized constrained collections) | ^4.6.7 | Any endpoint validating caller-supplied arrays could be made to allocate without bound |
| `undici` | transitive, 6.5.0–6.29.0 | resolved by the above installs | DoS via the EventSource parser; not reachable from our code paths, upgraded regardless |

Verified after the upgrade: `tsc --noEmit` clean, `next build` clean, `test:ci`
green, `notification-resilience` 16/16 (real SMTP path), `marketing` 44/44
(consent and suppression), `session-revocation` 21/21.

**Accepted risk — `@vercel/blob` (4 remaining high):**

The advisories reach us through `@vercel/blob` → `@vercel/oidc` →
`@vercel/cli-config` → a nested `zod` older than 4.6.6. npm's only offered
"fix" is to **downgrade** `@vercel/blob` to 2.4.0, which would put the image and
media upload pipeline (a protected feature) onto an older client to satisfy a
build-time config parser. That trade is wrong, so it is recorded here instead of
silently applied:

- The vulnerable schema lives in Vercel's CLI/config reader, not in our request
  handling; no caller-supplied payload reaches it.
- The runtime blob client we use (put/del) does not validate with that schema.
- Revisit when `@vercel/oidc` ships a version whose `@vercel/cli-config` no
  longer pins the old `zod`; the upgrade path is then automatic.

This is an accepted, understood risk with a named condition for removal — not a
claim that the dependency tree is clean.
