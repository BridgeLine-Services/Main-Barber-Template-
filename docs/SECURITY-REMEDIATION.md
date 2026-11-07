# Security remediation - CodeQL findings

Branch `security/final-pretest-hardening`, based on `main` `0952684`
(the inspected baseline). Commits: `07eea53`, `263034f`.

Nothing in this document claims staging or production verification. Every
result below is local, on the branch, with the sandbox database.

## Alert-by-alert record

| # | Sev | File and line | Root cause | Change | Test | Verdict |
|---|---|---|---|---|---|---|
| 23, 22, 21, 20 | High | `tests/fonts.test.ts:30,59,84` | `href.startsWith('http')` used as URL validation | `resolveLocal()` parses with `new URL` and requires the local origin before any fetch | font test now fails fast on a foreign origin | Fixed |
| 19 | High | `src/lib/shop-reset.ts:45` | `includes('blob.vercel-storage.com')` | `isManagedStorageUrl()` | `tests/trusted-storage-url.test.ts` (24) | Fixed |
| 18 | High | `src/app/api/dashboard/media/route.ts:325` | Same substring test gating `del()` | Same helper | same | Fixed |
| 17 | High | `src/app/api/dashboard/media/route.ts:196` | Same, in orphan cleanup | Same helper | same | Fixed |
| 16 | High | `src/app/api/dashboard/barbers/[id]/route.ts:179` | Same, on barber deletion | Same helper | same | Fixed |
| 13, 12, 11 | High | `src/lib/file-validation.ts` (sanitizer region) | Regex denylist, single-pass stripping | XML parse into an explicit element/attribute allowlist, rebuilt and re-escaped | `tests/file-validation.test.ts` 57, incl. 30-case malicious corpus | Fixed |
| 15 | High | `src/components/dashboard/BarberForm.tsx:221` | Reported as DOM text into HTML | No `dangerouslySetInnerHTML`, `innerHTML` or HTML parse in the component; line 221 is `<img src={photo}>` | existing e2e | False positive |
| 10 | High | `src/lib/review-requests.ts:548` | Text escaper used inside `href="..."` | `escapeAttr()` for attribute context; destination re-validated at render | `tests/security-hardening.test.ts` | Fixed |
| 14 | High | `src/lib/utils.ts:17` | Modulo on raw bytes | `crypto.randomInt` selection, same alphabet and format | `security-hardening` format assertions | Fixed (no bias existed: 256/32 divides evenly) |
| 7 | High | `src/lib/google-business.ts:441` | Reported as password hashing | It is HMAC-SHA256 OAuth state with `timingSafeEqual`; untouched | OAuth state tests | False positive |
| 6 | High | `src/lib/recurring.ts:53` | Unbounded time pattern, silent midnight default | `parsePreferredTime()`, bounded and strict; both recurring routes reject bad input | `security-hardening` time cases | Fixed |
| 5, 4 | High | `src/app/api/gift-cards/purchase/route.ts:36,39` | Pattern run on unbounded input | Email capped at 254 chars before the test | `security-hardening` | Fixed |
| 3 | Med | `src/app/api/dashboard/settings/route.ts:83` | Unbounded alternation over policy text | Length-capped marker scan, all eleven markers retained | `security-hardening` | Fixed |
| 9 | High | `src/lib/payroll.ts:523` | CSV quoting present, formula prefixes not neutralised | `csvCell()` apostrophe-prefixes `= + - @`, tab and CR; numbers exempt | `security-hardening` CSV cases | Fixed |
| 2 | High | `src/app/(dashboard)/dashboard/payroll/PayrollClient.tsx:535` | `money(a.amount).replace('$','$')` replaces a substring with itself | Replacement removed; formatting preserved | payroll suite 80 | Fixed (was harmless) |
| 8 | High | `src/app/(dashboard)/dashboard/media/page.tsx:319` | Reported as string escaping | `.replace()` on a constant label, rendered as JSX text; no HTML, attribute, CSS or URL context | e2e media routes | False positive |
| 1 | Med | `.github/workflows/vercel-diagnostics.yml:27` | No `permissions` block | `permissions: contents: read`; checkout `persist-credentials: false` | manual dispatch behaviour unchanged | Fixed |

Totals: 20 fixed, 3 documented false positives, 0 suppressed, 0 excluded.

## New shared modules

- `src/lib/trusted-storage-url.ts` - decides whether a stored URL is an object
  this application manages. HTTPS only, no credentials, no port, no fragment,
  host must match `<store>.public.blob.vercel-storage.com`. Ownership of a
  record is still decided by the authenticated business, never by the URL.
- `src/lib/passwords.ts` - one bcrypt cost constant (12) for every new or
  changed password, plus the verify path. Existing digests keep working.
- SVG sanitizer in `src/lib/file-validation.ts` - `@xmldom/xmldom` parse, then
  an element and attribute allowlist, rebuilt with escaped text and attribute
  values. DOCTYPE, entities, external references, `foreignObject`, over 100 KB,
  over 5000 nodes and nesting past 32 are rejected.

## Behaviour that changed, deliberately

- An invalid preferred time is now refused instead of becoming midnight.
- Passwords hash at cost 12 (measured: 79 ms at 10, 273 ms at 12 with bcryptjs).
- CSV cells starting with `=`, `+`, `-`, `@`, tab or CR are apostrophe-prefixed.
- Review emails with an invalid stored destination show instructions, not a link.

## Behaviour that did not change

Booking rules, availability, timezone handling, tenant isolation, permissions,
session handling, schema and migrations, API shapes, upload paths, payroll
figures, branding and publishing. Raster uploads (JPEG, PNG, WebP, AVIF) are
untouched.

## Not verified here

No staging or production run, no real provider credentials, no CodeQL re-run
(the token cannot read or trigger code scanning), no pull request (403 on
`POST /pulls`), and no human accessibility review.

## Verification limits (read before trusting the numbers)

Three things about this branch are easy to misread, so they are stated plainly.

**No CI has run on this branch.** `ci.yml` triggers on `pull_request` and on
pushes to `main` or `v0/**`. A pushed feature branch triggers nothing, and the
available token cannot open the pull request (403 on `POST /pulls`, four tokens
in a row). Every result below is a local run against a sandbox Postgres, not CI.

**`npm run test:all` is red on this branch and on `main`.** One pair of suites
is order dependent: after `npm run test:owner-registration` runs, the following
`tests/registration-route.test.ts` reports 10 passed / 13 failed, because the
registration route answers 503 once a first owner already exists in the database.
Run on its own, that suite is 23/23. This reproduces identically on a clean
worktree of the audited baseline `0952684`, so it pre-dates this branch and is a
harness-ordering defect, not an application regression. It was deliberately left
unfixed: changing the assertions to match would hide the ordering problem.

**`npm run master:check` exits 1 on `main` as well.** It ends in
`perf-check --strict`, which exits 1 whenever any N+1 candidate exists; the
baseline reports the same 13 candidates. Making it green means triaging those
candidates or dropping `--strict`, both of which weaken a gate, so neither was
done here.

**`npm run db:backup-verify` cannot run in this environment.** It needs
`pg_dump` and `psql`; neither is installed and `apt` has no `postgresql-client`
package. The workflow step `.github/workflows/ci.yml` ("Backup and restore
verification") is the place that proves it.

---

# Final hardening pass (branch `security/codeql-final-pass`)

Base: `main` `d512609cf84beec00c6f928643a7256aa3b02a1e` (PR #86 security, PR #87 usability already merged).

## 1. Font test redirect hardening (Task One)

New shared primitive `src/lib/local-origin.ts`:

- `resolveLocalUrl(href, base)` parses with the URL constructor, requires `http`/`https`,
  rejects credentials in the URL, and requires exact origin equality with `base`. No
  `startsWith`, `includes` or any substring comparison is used anywhere in the path.
- `fetchLocalUrl(href, base, init)` calls `fetch` with `redirect: 'error'`, so a 302 is a
  rejection rather than a silent hop, and re-checks `response.url`'s origin afterwards.

`tests/fonts.test.ts` keeps its `resolveLocal()` name and error text, now delegating to the
primitive, and all three asset fetches (stylesheet, CSS text, font file) go through
`fetchLocal()`. Font configuration, the seven families, CSS variable names and typography
are unchanged.

New `tests/font-url-guard.test.ts`, 14 assertions, hermetic (own stub server, no app
needed): relative URL accepted; absolute local accepted; external host rejected; lookalike
host `localhost:PORT.attacker.example` rejected; protocol-relative URL rejected;
credentialed URL rejected; `file://` rejected; off-origin redirect rejected; same-origin
redirect also rejected; local CSS still loads 200 with body intact; local font file loads
200; seven families still present; each family still emits its CSS variable.

## 2. Password hashing centralized (Task Two)

Every production hash now calls `hashPassword()` from `src/lib/passwords.ts` at
`BCRYPT_COST = 12`. Direct `bcrypt` imports were removed from:

`prisma/seed.ts` (was cost **10**), `src/app/platform/actions.ts`,
`src/app/api/platform/businesses/route.ts`, `src/app/api/auth/reset-password/route.ts`,
`src/app/api/auth/accept-invitation/route.ts`,
`src/app/api/dashboard/staff/[id]/route.ts`.

## 3. Password verification centralized (Task Three)

`bcrypt.compare` replaced with `verifyPassword()` in `src/lib/auth.ts`,
`src/app/api/auth/change-password/route.ts` (both comparisons),
`src/app/api/auth/2fa/required/route.ts`,
`src/app/api/dashboard/security/2fa/disable/route.ts`,
`src/app/api/dashboard/security/sessions/revoke/route.ts`.

`bcrypt` now appears in exactly one file: `src/lib/passwords.ts`.

No rehash-on-login, no forced resets, no changes to the credentials provider, login form,
validation rules, rate limits or session behaviour. Existing digests keep verifying because
bcrypt stores its own cost.

## 4. Tests added

`tests/security-hardening.test.ts` (now 34 assertions, was 28) additionally proves: the
legacy helper really produces a cost-10 digest; the shared verifier accepts it; the shared
verifier still rejects a wrong password against it; and a source scan finds no direct
`bcrypt.hash(`/`bcrypt.compare(` anywhere in `src/` or `prisma/` outside the shared policy.

`tests/font-url-guard.test.ts` is new (14 assertions).

## 5. Executed locally on this branch

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 97 pre-existing warnings |
| `npx prisma validate` | schema valid |
| `npm run build` | exit 0 |
| `test:files` | 57/57 |
| `tests/security-hardening.test.ts` | 34/34 |
| `tests/trusted-storage-url.test.ts` | 24/24 |
| `tests/oauth-state-signing.test.ts` | 9/9 |
| `tests/font-url-guard.test.ts` | 14/14 |
| `tests/fonts.test.ts` (live server) | 29 PASS, 0 FAIL |
| `tests/plain-language.test.ts` | 3/3 |
| `test:tenant` | 22/22 |
| `test:booking` | 20/20 |
| `test:permissions` | 37/37 |
| `test:coowner-permissions` | 35/35 |
| `test:barber-mode` | 23/23 |
| `test:auth` | 55/58 — 3 failures are HTTP 429 on the owner-registration intent from repeated local runs |

## 6. Not verified

- **GitHub CI: not run.** Pushing works, but opening a pull request fails with
  `403 Resource not accessible by personal access token` on every token provided so far, so
  no workflow has been triggered for this branch.
- **CodeQL: no fresh analysis.** Alert status for #23, #22, #21, #15, #8, #7 cannot be read
  either — the same token cannot access the code-scanning alerts API. Nothing in this
  document claims an alert is closed.
- **`test:auth` 3 failures**: all `429` on the registration/closing-code assertions. Repeated
  local runs exhaust the registration limiter; CI runs once against fresh state. Classified
  as environment/order-dependent, not a regression, and not "fixed" by touching assertions.
- **Playwright E2E and a11y**: not run this pass.
- **No production deployment, no staging verification, no provider acceptance.**

## 7. Tasks Four and Five: reported false positives and prior findings

`BarberForm.tsx`, `media/page.tsx` and `google-business.ts` are byte-identical to `main`
(`git diff --stat` empty). Verified on inspection: the barber photo is a plain `<img src={photo}>`,
the aspect label is ordinary JSX text, and OAuth state uses `createHmac('sha256', ...)` with
`timingSafeEqual`. No escaping was added, no HMAC was replaced with bcrypt, no feature removed.
Findings #23, #22, #21 remain protected by `src/lib/trusted-storage-url.ts` origin validation,
unchanged by this pass.

## 8. Second local verification pass (added after the first report)

The three `test:auth` failures reported above were an environment defect on my side, not
code: `.github/workflows/ci.yml` sets `RATE_LIMIT_TRUST_PROXY: 'true'` so the suites can act
as several visitors, and I had omitted it, so every request shared one limiter key.

With the CI environment reproduced:

| Check | Result |
| --- | --- |
| `test:auth` (`APP_MODE=production`, trust proxy) | 58 passed, 0 failed; exit 1 from one dev-mode-only expectation that requires `APP_MODE=demo` |
| `test:auth` (`APP_MODE=demo`) | 52 passed, 6 failed, all HTTP 429 on the reschedule limiter |
| `test:owner-registration` | 27 passed, 1 failed: "incomplete public shop directs its authenticated owner to setup" (onboarding redirect, not a password path) |
| `test:factory-readiness` | 21/21 |
| `test:factory-launch` | 10/10 |
| `test:smoke` (`SMOKE_BASE_URL=http://localhost:3000`) | passed, booking remains manual by design |
| `npx playwright test e2e/security.spec.ts e2e/public-booking.spec.ts` | 5 passed, 0 failed, exit 0 |
| full `test:e2e` | 18 of 70 tests completed with no failures before the 300 s harness cap killed the run |
| `accessibility` + `customer-auth` + `dashboard-smoke` | 17 of 28 completed with no failures before the same cap |

No password-related test fails anywhere. The single owner-registration failure is a redirect
assertion on an incomplete shop, which this pass does not touch.

Still not verified: GitHub CI and CodeQL (the PR cannot be opened), any staging or production
deployment, and the settings contrast node from the earlier usability pass.
