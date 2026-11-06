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
