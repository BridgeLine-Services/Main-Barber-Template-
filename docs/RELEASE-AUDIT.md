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
