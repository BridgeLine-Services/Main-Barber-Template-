# Dependency audit (Requirement 34)

`npm audit --omit=dev` (2026-09-29, after the Next 16 upgrade):
**0 production vulnerabilities.**

## Upgrades completed (2026-09-29)

| Package | From → To | Advisory cleared |
|---------|-----------|-------------------|
| next | 14.2.35 → **16.3.6** | CRITICAL: self-hosted Image Optimizer DoS via remotePatterns config |
| postcss (via next) | transitive | HIGH: XSS via unescaped `</style>` in stringify output |
| nodemailer | 6.10.1 → **10.0.12** | HIGH: email to an unintended domain via interpretation conflict |

## How the upgrade was verified

Framework double-major (next 14 → 16, react 18 → 19) verified with:

- `@next/codemod next-async-request-api` applied (25 files: `params` /
  `searchParams` now awaited in dynamic route handlers and pages).
- ESLint migrated to flat config (`eslint.config.mjs`, eslint 9) with the
  pre-upgrade severity policy preserved; previously-unenforced v16 preset
  rules (`no-explicit-any`, `no-unused-vars`, new react-hooks v6 rules)
  are tracked as follow-up warnings, not hidden.
- `next dev` runtime smoke: credentials login via next-auth, authenticated
  dashboard APIs (`settings`, `services`, `barbers`, `audit-logs`,
  `appointments`), SSR dashboard layout access gate, middleware
  `x-pathname` stamp — all working under async request APIs.
- Full CI battery (23 suites) green; live-server suites green
  (PWA 22/22, notification resilience 16/16 against a running Next 16
  server).
- Production build compiles (24 static pages) with the production env vars.
- next-auth remains on v4 (4.24.x is compatible with Next 16's async
  headers in this codebase's usage); a future v5/Auth.js migration is
  optional, not required for security.

## CI enforcement

`.github/workflows/ci.yml` now runs
`npm audit --omit=dev --audit-level=critical` after `npm ci`, so any new
critical production advisory fails the build. Dev-only advisories are
excluded (`--omit=dev`) as they do not ship to production.
