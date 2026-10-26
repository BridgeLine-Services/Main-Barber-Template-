# Prompt 9 acceptance report

**Review scope:** usability and regression review across Prompts 1–8.

**Release posture:** not approved for production. This report records repository checks and local evidence; it is not legal advice, a compliance certification, or a substitute for staging sign-off.

| Feature tested | Result | Evidence / test command | Remaining issue | Severity | Blocks release |
|---|---|---|---|---|---|
| TypeScript compilation | Pass | `npm run typecheck` | None observed | — | No |
| Lint and accessible UI rule scan | Pass with existing warnings | `npm run lint` | Existing warnings remain in legacy/config/UI files; no lint errors | Low | No, review before release |
| Build-script contract | Pass | `npm run test:vercel-build` | None observed | — | No |
| File and architecture policy checks | Not run to completion | `npm run test:files`; `npm run architecture:check` | Architecture checks require the repository environment hygiene workflow; database-backed checks also require a safe test database | High | Yes |
| Marketing audience behavior | Pass | `node --env-file-if-exists=/vercel/share/.env.project node_modules/tsx/dist/cli.mjs tests/marketing.test.ts` | None observed; 44 assertions passed | — | No |
| Branding reset and published/draft separation | Not run | `npx tsx tests/appearance-reset.test.ts` | No usable `DATABASE_URL` was available to the shell test process, so no database mutation was attempted | High | Yes |
| Anonymous booking and appointment management | Not run | `npx tsx tests/guest-booking-journey.test.ts` | Requires a running app and safe database; staging execution remains required | High | Yes |
| Cross-tenant request denial | Not run | `npx tsx tests/cross-tenant-matrix.test.ts` | Requires a safe database target | High | Yes |
| Owner, co-owner, manager and barber journeys | Not run | `npm run test:owner-registration`, `npm run test:coowner-permissions`, role/permission suites | Requires staging/test accounts and database-backed execution | High | Yes |
| Customer messaging consent and opt-out | Not run | Staging acceptance journey | Requires configured SMS provider, test numbers, webhook delivery and database evidence | High | Yes |
| Campaign suppression and unsubscribe footer | Not run | Staging acceptance journey; `npm run test:marketing` covers audience logic only | Provider delivery, opt-out suppression and rendered footer still need staging evidence | High | Yes |
| Stripe entitlement and membership retry behavior | Not run | Payment and membership suites plus Stripe test-mode webhook replay | Requires Stripe test mode and a safe database; no production replay performed | High | Yes |
| Policy editing and publication date stability | Not run | Staging dashboard journey | Requires owner test account and safe database | Medium | Yes |
| Client-copy dry run | Pass | `npm run client:copy:dry-run` | Apply mode was not run; review dry-run output before any disposable-clone apply | Medium | Yes |
| Browser, keyboard and axe accessibility checks | Not run | `npm run test:e2e` / `npm run test:a11y` | Playwright browsers were not installed in this environment; staging browser pass remains required | High | Yes |
| License and release inventory | Pass | `npm run license:inventory`; `docs/RELEASE-AUDIT.md` | Generated dependency notices and advisories still require human review | Medium | Yes |

## Required staging sign-off

Before production release, an owner or release manager should attach evidence for each not-run journey: test account/tenant, timestamp, command or browser trace, and result. The release owner must also confirm migration and RLS verification, provider outage behavior, backups and restore drill, legal review of the policy drafts, and explicit approval of this report.

No production deployment was performed by this review.
