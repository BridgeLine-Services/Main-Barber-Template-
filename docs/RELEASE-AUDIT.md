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

**Resolved — `@vercel/blob` path (previously 4 accepted high):**

The advisories reached us through `@vercel/blob` → `@vercel/oidc` →
`@vercel/cli-config` → a nested `zod` older than 4.6.6. The condition recorded
here for revisiting has now been met: `@vercel/cli-config` **0.3.6** is the same
minor version and requires `zod ^4.6.6`, while the old 0.3.1 pinned `4.1.11`.

`@vercel/oidc` pins `@vercel/cli-config` to exactly `0.3.1`, so npm cannot pick
0.3.6 on its own. `package.json` therefore carries a single narrow override:

```json
"overrides": { "@vercel/cli-config": "0.3.6" }
```

This is deliberately not the "fix" npm suggested (downgrading `@vercel/blob` to
2.4.0), which would have moved the media upload pipeline — a protected feature —
onto an older client to satisfy a config parser.

**Evidence:** `npm audit --omit=dev` → `found 0 vulnerabilities`;
`npx tsc --noEmit` clean; `npx prisma validate` clean; `npm run lint` 0 errors;
`npx next build` → "✓ Compiled successfully"; `tests/file-validation.test.ts`
27/27 and the media upload suite green.

**Residual judgement:** the override moves a transitive dependency one patch
within the same minor, against a package that pinned its version exactly. If a
future `@vercel/oidc` release pins a different `@vercel/cli-config`, drop the
override and take the upgrade.

