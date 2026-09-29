# Dependency audit (Requirement 34)

`npm audit --omit=dev` (2026-09-29): **2 production vulnerabilities
(1 critical, 1 high)** — nodemailer cleared (6.10.1 → 10.0.12). CI reports
them on every run (report-only step) so they cannot be silently forgotten.
The remaining pair (next / postcss) is resolved together by the next upgrade.

| Severity | Package | Advisory | Fix path |
|----------|---------|----------|----------|
| CRITICAL | next 14.2.35 | Self-hosted Image Optimizer DoS via remotePatterns configuration | Major upgrade to next 16.3.6+ |
| HIGH | postcss (via next) | XSS via unescaped `</style>` in stringify output | Resolved by the same next upgrade |
| ~~HIGH~~ | ~~nodemailer 6.10.1~~ | Email to an unintended domain via interpretation conflict | ✅ **Fixed 2026-09-29**: upgraded to nodemailer 10.0.12 (+ @types 7.0.12, `Transporter` type import); send path runtime-verified |

## Why not upgraded now

Both fixes are **breaking-change major version bumps** of the framework
(next 14 -> 16) and the mailer (nodemailer 6 -> 10). The codebase is
currently on the latest patch of each major (14.2.35 is the final
14.2.x; 6.10.1 is the final 6.x), so there is no in-major patch to take.
A framework double-major upgrade is a dedicated, fully-tested change —
not something to land unverified alongside other work.

## Risk context / mitigations (as of this audit)

- **next Image Optimization DoS**: exploitable when the self-hosted image
  optimizer is exposed with a permissive `remotePatterns` config. The
  template's `next.config` does not enable broad `remotePatterns`; media
  uploads are first-party. Practical exposure is low, but the upgrade
  is still required to clear the advisory.
- **postcss XSS**: postcss is a build-time transitive dependency of
  next; the advisory is in CSS stringify output, not runtime user
  input. Resolved by the next upgrade.
- **nodemailer unintended domain**: send paths go through the
  templated notification lib with fixed recipients from the database.
  Upgrade required to clear the advisory.

## Required update path (tracked, not done)

1. Upgrade `next` to >=16.3.6 and `nodemailer` to >=10.0.11 together
   (breaking-change majors: verify `next dev`, production build, all
   30 test suites, image config, and the build output on Vercel).
2. Re-run `npm audit --omit=dev` until clean, then flip the CI step to
   `--audit-level=critical` failing (`-D` in .github/workflows/ci.yml).

Dev-only advisories are excluded (`--omit=dev`) as they do not ship to
production.
