# CI/CD and Deployment Audit

## Scope and evidence

This audit covers the failed GitHub Actions history available at the time of
review: **41 failed runs across 33 commits**. It records failed workflow and
test evidence from GitHub Actions logs, the current repository state, and the
deployment information available to the project. Each run ID links to its
GitHub Actions run. A run may fail for more than one cause; repeated runs of
the same commit are grouped together.

The current branch was `main` at `f949f6d`. The reviewed remediation changes
are local and uncommitted. No commit, push, provider plan change, or charge was
made. Root causes are marked unknown where the available log excerpt does not
prove them; a later passing check is not treated as proof of which intervening
change fixed an old failure.

## Executive summary

- The historical failures cluster around test regressions and DB fixture
  behavior, lint/type errors, architecture assertions, and Next.js build-time
  font/page-data failures.
- The current local checks reported in this review passed: Vercel build-runner
  tests (9), optional-integration tests (20), architecture check and tests,
  TypeScript typecheck, ESLint with errors enabled, Prisma schema validation,
  and the production build. Full lint reported 53 warnings and no errors.
- A full database-backed `npm run test:ci` was **not** run because no local
  PostgreSQL service was configured. Consequently, the historical database
  test failures below are not all confirmed resolved.
- The local production build completed, but static page generation logged a
  connection refusal to local PostgreSQL. Provider logs and a new deployment
  status were not available.
- The target Vercel Hobby plan is not suitable for this commercial deployment:
  Hobby is restricted to non-commercial use. This is a **launch blocker** that
  cannot be addressed with an application change. The user prohibited upgrades
  or charges, so no plan change was made.
- A failed Vercel status on `f949f6d` and a failed Netlify deploy-preview
  status on `2a6aeba` were observed. Their provider logs were unavailable; no
  root cause is assigned to either.

## Changes made during this audit

The local, uncommitted remediation hardens Vercel build configuration and
migration sequencing; adds bounded retries only for transient database
connectivity/lock failures; adds build-runner regression tests; respects
disabled optional email, SMS, and Google integrations; requires complete
Stripe credentials for online payments while retaining pay-at-shop; and
changes the membership cron to a daily schedule compatible with Hobby's
scheduling limit. CI readiness/concurrency and deployment/testing/payment
documentation were also updated.

These changes do not make commercial use of a Hobby plan compliant. They also
do not replace the missing full database-backed CI run or missing provider
deployment logs.

## Failed commit inventory

### Latest failure cluster

| Commit | Failed run(s) and evidence | Root cause and current status | Actionable Copilot prompt |
|---|---|---|---|
| `0be518f` | [39014434896](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/39014434896), Template CI: `tests/owner-registration-journey.test.ts` failed in `register()` with `TypeError: fetch failed`, caused by `ECONNREFUSED`. | Confirmed: the journey attempted to call an unavailable local server. The current workflow separates owner registration into a production-server step with readiness/cleanup handling; full CI was not rerun against PostgreSQL. | “Run the owner-registration CI journey against the production server, verify readiness polling and cleanup, and make startup failures report the server log and URL. Preserve the test’s behavioral assertions.” |
| `c0ba53e` | [39006775455](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/39006775455), Template CI: payroll tests reported **68 passed, 9 failed**. Logs include duplicate-key errors for `Payment.idempotencyKey` and `StripeEvent.eventId`. | The failing test names are not present in the retained excerpt. Duplicate-key errors are evidence, not proof that they account for all nine failures. Current DB-backed status is unverified. | “Reproduce all nine payroll/payment test failures from this run using an isolated PostgreSQL database. Identify each failing assertion, make fixture IDs and cleanup deterministic, and rerun the exact CI test command.” |
| `8dea748` | [39005273813](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/39005273813), Template CI: payroll tests reported **68 passed, 9 failed**. Duplicate-key errors for payment idempotency and Stripe event IDs also appear. | Same observed failure class as `c0ba53e`; exact nine assertions and cause remain unconfirmed. | “Compare this payroll run with `c0ba53e`; reproduce and enumerate every failed assertion, then correct test isolation or application behavior as supported by evidence. Verify with the CI PostgreSQL service.” |
| `2a6aeba` | [39004394974](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/39004394974), Template CI: payroll tests reported **68 passed, 9 failed**, with duplicate-key errors for payment idempotency and Stripe event IDs. Netlify deploy-preview status also failed; provider logs unavailable. | CI failure details match the payroll cluster; Netlify failure cause is unknown and must not be inferred from CI. | “Reproduce and diagnose the nine payroll failures with CI’s PostgreSQL setup. Separately obtain the Netlify deploy-preview logs for this commit before assigning a provider-side root cause.” |
| `67c14f0` | [37647810655](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/37647810655), Template CI: payroll tests reported **68 passed, 9 failed**; duplicate-key errors for payment idempotency and Stripe event IDs appear. | Exact failing assertions are not preserved in the excerpt; current DB-backed status is unverified. | “Reproduce the payroll failures on this commit in an isolated PostgreSQL database, capture all nine assertion names, and determine whether duplicate idempotency/event IDs are expected errors or fixture collisions.” |
| `a1fbf65` | [37647468927](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/37647468927), Template CI: payroll tests reported **68 passed, 9 failed**, with duplicate-key errors for payment idempotency and Stripe event IDs. | Exact failing assertions are not established. | “Investigate the nine payroll failures in this run with a clean CI database; document the failing assertions and fix only confirmed application or fixture defects.” |
| `2f994b3` | [37253727772](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/37253727772), Template CI: lint reported **4 errors and 51 warnings**. | Confirmed lint gate failure. Current full lint reports no errors (53 warnings); `npm run lint -- --quiet` also passed. Exact historical errors are not mapped to a specific later fix. | “Inspect the lint errors at this commit, map each to the current source, and ensure the repository lint command exits successfully without suppressing errors; avoid unrelated warning cleanup.” |
| `cdbfef0` | [37242608798](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/37242608798), Template CI: Playwright guest-booking flow failed after `locator.waitFor` timed out at 20 seconds; **16 passed, 1 failed**. The web server also logged `The destination stream closed early`. | Confirmed symptom is the guest-booking confirmation wait timing out. Whether the stream closure caused the missing confirmation is not proven. Current E2E status was not rerun. | “Reproduce `e2e/public-booking.spec.ts` against the CI production server, inspect the failing trace and server logs, and fix the booking or readiness defect rather than extending the timeout without evidence.” |
| `98a0d72` | [37205537408](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/37205537408), Template CI: TypeScript error in `scripts/seed-featured-module-qa.ts:32` because `Record<string, unknown>` was not assignable to Prisma JSON input. | Confirmed type mismatch. Current TypeScript typecheck passes; the exact intervening fix is not attributed. | “Use Prisma’s supported JSON input type or validate/narrow the seed value before writing it. Keep the featured-module QA seed type-safe and verify with `npm run typecheck`.” |
| `2bcd589` | [37163560193](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/37163560193), Template CI: `architecture:check` rejected a literal contact email in `scripts/qa-dash.mjs`. [37163560172](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/37163560172), Architecture Constitution: the same finding. | Confirmed architecture-check failure: client-like contact data was embedded in a QA script. The current architecture check passes. | “Remove the literal client contact email from `scripts/qa-dash.mjs`; use generated test data or an environment/configuration value and keep the QA path deterministic. Run the architecture check and architecture tests.” |
| `77167cc` | [36961257677](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36961257677), Template CI: `tests/visual-config.test.ts:170` threw `TypeError: Cannot read properties of undefined (reading '0')`. | Confirmed runtime test failure while reading an absent first capture/group. The current full `test:ci` suite was not run, so resolution is unverified. | “Inspect the visual-config regex and test inputs around line 170. Handle non-matching inputs explicitly, add a regression case, and run `tests/visual-config.test.ts` plus the full CI suite.” |
| `e7bf6b4` | [36961099883](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36961099883), Template CI: same `visual-config.test.ts:170` undefined `[0]` TypeError. | Same failure as `77167cc`; current full-suite status unverified. | “Reproduce the visual-config crash at line 170, identify the unmatched input rather than masking it, and add regression coverage for absent regex matches.” |
| `402e938` | [36961084124](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36961084124), Template CI: five TypeScript errors in `src/app/api/dashboard/before-after/[id]/route.ts` because property `pair` was accessed on type `never`. | Confirmed type/control-flow mismatch. Current TypeScript typecheck passes; the precise later fix is not attributed. | “Correct the before/after route’s narrowing and Prisma result typing so `pair` is accessed only on a valid result. Preserve route behavior and verify with TypeScript typecheck and route tests.” |
| `b22d170` | [36958249687](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36958249687), Template CI: lint reported **3 errors, 39 warnings**; log excerpt identifies `react-hooks/set-state-in-effect` at `src/components/onboarding/TeamStep.tsx:171`. | Confirmed lint failure. Current lint has no errors; the full database suite is unrelated and not required for this lint check. | “Resolve all three lint errors at this commit, including the `TeamStep` effect that synchronously updates state; preserve loading behavior and verify the full lint command.” |
| `a39cfa0` | [36957925681](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36957925681), Template CI: lint reported **3 errors, 39 warnings**, including `react-hooks/set-state-in-effect` at `TeamStep.tsx:171`. | Same lint failure cluster as `b22d170`; current lint has no errors. | “Compare the lint findings with `b22d170`, fix the three actual errors (not merely the warnings), and confirm onboarding behavior with focused tests and lint.” |

### Earlier failure cluster

| Commit | Failed run(s) and evidence | Root cause and current status | Actionable Copilot prompt |
|---|---|---|---|
| `38af190` | [36903645930](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36903645930), Template CI: booking-rules tests reported **24 passed, 1 failed** after the listed rescheduling, buffer, and tenant assertions passed. | The failed assertion’s name/details are not present in the available excerpt. Current DB-backed booking-rules tests were not run. | “Run `tests/booking-rules.test.ts` on a clean CI PostgreSQL database, capture the single failing assertion, and fix the underlying rule or fixture. Do not infer the failure from the passing assertions.” |
| `68be048` | [36897456459](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36897456459), Template CI: booking-rules tests reported **20 passed, 5 failed**. The excerpt shows failures for rescheduling to the appointment’s own slot and four booking outcomes (valid booking, secure token, double-booking rejection, and buffer rejection). | Confirmed failures span rescheduling and booking outcomes; the log excerpt does not establish a single root cause. Current DB-backed booking tests were not rerun. | “Reproduce the five booking-rules failures on a clean PostgreSQL database. Check rule evaluation, transaction/fixture setup, and API result assertions separately; add focused regression tests and rerun the full booking suite.” |
| `31c72f6` | [36743992525](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36743992525), Template CI: lint reported **2 errors, 28 warnings**, including `react-hooks/set-state-in-effect` in onboarding `TeamStep.tsx`. | Confirmed lint gate failure. Current lint reports no errors. | “Resolve the lint errors reported at this commit, particularly the `TeamStep` state-loading effect, without weakening ESLint rules; verify onboarding tests and lint.” |
| `55234cc` | [36700477193](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36700477193), Template CI: RLS enforcement tests reported **5 passed, 5 failed**. Failures shown: business B could read, update, and delete business A’s customer; no-tenant context returned rows; platform-staff context did not access both tenants. | Confirmed serious RLS test failures in that run. Whether the test harness or RLS policies were subsequently corrected is unverified because full database-backed CI was not run during this audit. | “Reproduce each of the five RLS failures with the CI PostgreSQL role and schema. Verify tenant context, platform-staff policy, and cross-tenant read/update/delete isolation; never weaken the assertions to make the suite pass.” |
| `d95f007` | [36700406876](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36700406876), Template CI: lint reported **1 error, 26 warnings**, with the onboarding `TeamStep.tsx:171` set-state-in-effect diagnostic. | Confirmed lint failure. Current lint reports no errors. | “Fix the one blocking lint error in `TeamStep` using the current React/Next patterns, then run onboarding tests and the full lint command.” |
| `1723f05` | [36373641226](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36373641226), Template CI: TypeScript errors because `observability` was missing from `Record<FeatureName, ...>` and feature configuration objects. | Confirmed incomplete feature-map updates after adding the observability feature. Current TypeScript typecheck passes. | “Update all `FeatureName` records, readiness objects, and test fixtures to include the observability feature with its intended disabled/configured semantics. Verify typecheck and factory-readiness tests.” |
| `c833a85` | [36346677708](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36346677708), Template CI: `next/font` failed in `src/app/layout.tsx`; local-font fallback metrics read `ascent` from `undefined`. | Confirmed font parser/fallback-metrics failure. Current production build completed, but a later passing build does not identify the historical correction. | “Inspect the local font files and `next/font/local` configuration used by `src/app/layout.tsx`; verify the font assets are valid for the installed Next.js version and add a build regression check.” |
| `f6b828b` | [36344165916](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/36344165916), Template CI: Next font build failed after requests to `fonts.gstatic.com` failed; webpack build terminated. | The log confirms remote Google Font fetch failures. Network instability is plausible but not proven as the sole cause. Current local build completed; CI network/font reproducibility remains a risk. | “Remove build-time dependence on fetching Google Fonts or provide a reproducible, appropriately licensed local font asset. Verify the production build without external font-network access.” |
| `6c2cf7c` | [35829549708](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/35829549708), Template CI: Google font loader in `next/font` threw `TypeError: Cannot read properties of null (reading '1')` in `src/app/layout.tsx`. | Confirmed font-loader failure during Google font processing. The specific malformed/failed response is unknown. Current production build completed; provider-side fetch independence remains to be verified. | “Make the font build deterministic and independent of Google’s runtime font endpoint; inspect `src/app/layout.tsx` and verify a clean production build with network access disabled.” |
| `ebf5a87` | [35552685313](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/35552685313), Template CI: Next.js failed while collecting page data for `/change-password`. | The terminal failure is confirmed; the originating exception is not available in the excerpt, so root cause is unknown. Current production build completes locally, but logs a local DB connection refusal during page generation. | “Recover the full CI log for this run and inspect the first exception preceding `Failed to collect page data for /change-password`. Fix the server-render/build-time dependency and test the route with deployment-like environment values.” |
| `d6a863b` | [35552574773](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/35552574773), [35552369233](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/35552369233), and [35552350177](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/35552350177), all Template CI: page-data collection failed for `/change-password` or `/_not-found`. | Three failed builds share a page-data collection symptom; the root exception is not preserved. Current production build completes locally, with the local DB connection caveat above. | “Compare the three failed build logs and identify the earliest shared exception for `/change-password` and `/_not-found`. Correct the common build-time dependency and verify all routes in a clean production build.” |
| `25209f9` | [35552210143](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/35552210143), Template CI: page-data collection failed for `/change-password` and `/_not-found`. | Cause unknown from retained excerpt. Current production build completes locally; CI/provider validation remains necessary. | “Retrieve the complete build log, find the first error before page-data collection fails, and test the affected pages with the same environment and build command used in CI.” |
| `d7e2873` | [35552159563](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/35552159563), [35551936501](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/35551936501), and [35551923399](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/35551923399), all Template CI: page-data collection failed for `/change-password` or `/_not-found`. | Three runs show repeated build failure but do not expose its initiating exception. Current local production build completes; the root cause of these historical runs is not attributed. | “Compare the three full build logs, trace the first server-render exception for the affected pages, and add a regression test or build check that proves the failure is fixed.” |
| `0da86ff` | [34628947125](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/34628947125), Architecture Constitution: architecture test assertion failed because input matched a PostgreSQL connection-string regex. | Confirmed mismatch in an architecture assertion. The excerpt does not identify which file/value matched, so it is unknown whether the test fixture or a source/config value was responsible. Current architecture checks pass. | “Identify the exact file matched by the PostgreSQL URL assertion. Keep real credentials prohibited, but allow only clearly redacted/non-secret examples where justified; run architecture tests and checker.” |
| `6df780b` | [34623355430](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/34623355430), Architecture Constitution: same PostgreSQL connection-string regex assertion failure as `0da86ff`. | Same class; exact matched input is not available. Current architecture checks pass. | “Reproduce the PostgreSQL URL architecture-test failure and identify its matched input. Correct the fixture or remove any actual credential; verify the test still catches real secrets.” |
| `434ae52` | [34623222223](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/34623222223) and [34623218662](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/34623218662), Architecture Constitution: test assertions rejected the `.env.example` runtime-mode/optional-feature documentation text. | Confirmed constitution-test text mismatch against `.env.example`; precise assertion intent is unclear in the excerpt. Current architecture tests pass. | “Inspect the failing constitution assertions and `.env.example` together. Align the examples with the actual runtime/optional-feature contract without weakening the architecture requirement; rerun architecture tests.” |
| `97877cf` | [34623105234](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/34623105234) and [34623102782](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/34623102782), Architecture Constitution: a text assertion expected the phrase `zero modifications to application source code`, which was absent. | Confirmed wording mismatch between the constitution and its test. Current architecture tests pass. | “Make the constitution’s permanent zero-source-modification rule explicit and ensure the test checks that invariant rather than brittle incidental phrasing; run the architecture suite.” |
| `d5bfd4a` | [34622807418](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/34622807418) and [34622807118](https://github.com/BridgeLine-Services/Main-Barber-Template-/actions/runs/34622807118), Architecture Constitution: `architecture:check` flagged `PASSWORD = 'password123'` in `prisma/seed.ts` as a hard-coded credential. | Confirmed checker finding. The value was in seed code; whether it was an intentionally local demo credential or usable outside development is not established by the failure log. Current architecture check passes. | “Remove the hard-coded password from `prisma/seed.ts`; source it only from a safe local environment value or generate a disposable credential, and ensure production seed paths cannot enable a default account. Verify architecture checks and seed tests.” |

## Cross-cutting findings and launch actions

1. **Database-backed CI remains a required verification.** Run the complete
   `npm run test:ci` against the same PostgreSQL service and migration setup as
   GitHub Actions. Confirm the RLS, booking, payment, payroll, and owner
   registration cases pass; investigate any failure rather than treating the
   current unit/targeted checks as a substitute.
2. **Confirm provider deployment status with provider logs.** The failed Vercel
   status on `f949f6d` and Netlify preview status on `2a6aeba` lack provider
   logs in the available session evidence. Do not assign either a code root
   cause until those logs are available.
3. **Resolve commercial hosting compliance before launch.** The commercial
   shop deployment cannot use a plan restricted to non-commercial projects.
   A commercially permitted plan/provider is required. No upgrade or charge
   was authorized or made.
4. **Address build reproducibility.** The historical font and page-data failures
   indicate that font fetching and build-time server data dependencies need
   to remain deterministic. The current build completed locally, but it logged
   `ECONNREFUSED` to local PostgreSQL during page-data generation.
5. **Keep CI actionable.** Continue running focused build-runner and
   optional-integration regression suites in CI, retain readiness checks for
   server-dependent journeys, and make failed tests emit assertion names and
   useful provider/test-server logs.

## Current validation record

- `npm run test:vercel-build`: 9 passed.
- `npm run test:optional-integrations`: 20 passed.
- `npm run architecture:check` and architecture tests: passed; checker scanned
  535 source files.
- TypeScript typecheck: passed after Prisma Client generation.
- `npm run lint -- --quiet`: passed; full lint had 53 warnings and no errors.
- `npx prisma validate`: passed with a pre-existing warning about `SetNull` on
  a required relation.
- Production Next.js build: completed successfully; logged a local database
  connection refusal during static page generation and warned that `eslint`
  in `next.config.mjs` is unsupported/ignored by the installed Next.js version.
- Full database-backed `npm run test:ci`: not run; no local PostgreSQL service
  was configured.
- Provider deployment verification: unavailable; Vercel and Netlify build logs
  were not accessible.
- Git state: audit/remediation changes remain uncommitted and unpushed.
