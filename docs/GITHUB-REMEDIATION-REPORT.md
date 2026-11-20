# GitHub failure remediation: what was wrong, what was fixed, what was not

Branch: `remediation/github-failures`
Started from: `4897948` (main, "Report: say precisely what CI will and will not cover")
Repository: `BridgeLine-Services/Main-Barber-Template-`

This document answers the eight parts of the remediation directive with evidence, not
intentions. Every claim below was produced by running the check on this branch.

---

## Part 1: the investigation

The repository was read before anything was edited. The starting commit is recorded above,
the working tree was clean, and the files named in the directive were inspected on this
branch rather than trusted from an earlier report.

What the investigation found, in the order it mattered:

1. `scripts/template-version.ts` reads `TEMPLATE_UPSTREAM_REPO` (defaults to this
   repository) and `GITHUB_TOKEN` (only used to authenticate a request for a private
   upstream). Neither was declared in `src/lib/env-registry.ts`, so the drift checker was
   right: two variables were read by shipped code with no entry describing them.
2. `e2e/dashboard-smoke.spec.ts` signed in again for every one of its 17 routes, and its
   "leaked exception" detector was `/…|NaN/i`. Case-insensitively, `NaN` matches the word
   **Maintenance**, which appears on the owner dashboard card and in the navigation group
   that the audit-log and security-settings pages render. Three healthy pages were reported
   as leaking an exception because of the English language.
3. The same spec located the role badge with `page.locator('header')`. This layout has no
   `<header>`: the role is rendered in the sidebar, which is an `<aside>`. That locator
   could only ever time out.
4. `tests/accessibility-guard.test.ts` and `scripts/a11y-static.mjs` stripped tags with a
   single `replace(/<[^>]+>/g, '')`, which both under-matches (`<<b>script>` survives as
   `<script>`) and is the exact shape CodeQL reports as incomplete sanitization.
5. `tests/support-sources.test.ts`, `tests/backup-safety.test.ts` and `tests/fonts.test.ts`
   decided trust with substring checks: `startsWith('https://')`, `includes('db.example.com')`,
   `includes('fonts.googleapis.com')`.
6. `src/components/dashboard/BarberForm.tsx` contains **no** HTML sink. The biography is a
   controlled `<textarea value={bio}>`; the surrounding strings are JSX text.
7. `src/lib/google-business.ts` contains **no** password hashing. Its only cryptography is
   `createHmac('sha256', …)` over the OAuth `state` payload, compared with
   `timingSafeEqual`, expiring after ten minutes, and failing closed in production.

## Part 2: environment drift

`TEMPLATE_UPSTREAM_REPO` and `GITHUB_TOKEN` are now declared entries in `ENV_REGISTRY`,
classified for what they actually are:

| Variable | Category | Secret | Required in | Why this classification |
|---|---|---|---|---|
| `TEMPLATE_UPSTREAM_REPO` | INTERNAL | No | Nothing | Defaults to this template. A client copy never needs to set it; it exists so a fork can point at its own upstream. Format is an enum of the known repository. |
| `GITHUB_TOKEN` | INTERNAL | Yes | Nothing | Only used to read a **private** upstream. Public upstreams work without it, and GitHub Actions injects it automatically during a run, so no customer is ever told to configure it. |

Nothing was added to the `ALLOWED` set in `scripts/check-env-drift.mjs`. The checker still
fails on a genuine omission, which is the whole point of it.

Verified:

```
npm run env:drift
Environment registry covers every source reference (100 declared, 78 referenced, 612 files scanned).
npm run env:template
.env.example regenerated with 95 variables.
npx tsx tests/env-classification.test.ts
Environment classification: 34 passed, 0 failed
```

`npm run env:check` reports two blocking problems in this sandbox: `UPSTASH_REDIS_REST_URL`
and `UPSTASH_REDIS_REST_TOKEN` are absent. That is a real environment gap (no Redis account
here), not a registry defect, and it is reported as such rather than papered over.

## Part 3: the three dashboard tests

**Root cause, proven, not guessed:** the leak detector matched the word "Maintenance".

```
Expected pattern: not /application error|…|NaN/i
Received string: "… Maintenance … Whether your website and backups are in good order …"
```

`mainte**nan**ce` contains `nan`, and the pattern was case-insensitive. The dashboard shows
a Maintenance card; the audit log and security settings render the Maintenance navigation
group. Those are exactly the three pages that failed. The pages were healthy; the detector
was not.

Fixes, all of which make the test stricter rather than looser:

- Technical tokens are matched as whole words: `\bNaN\b`, `\bprisma\b`, `\[object Object\]`.
  An ordinary English word can no longer trip the leak check, and a genuine `NaN` on the
  page still does.
- One real sign-in per file instead of seventeen. Seventeen logins in a row is a burst
  through the authentication rate limiter on a shared runner, and it was slow as well as
  fragile.
- The suite now proves it is signed in: each route asserts it was **not** bounced to
  `/login`. Before this, a session that silently failed to establish made every assertion
  pass on the login page itself.
- The role-badge test reads the element that actually renders the role
  (`getByRole('complementary')`, the sidebar), instead of waiting for a `<header>` that does
  not exist. The sidebar now carries `aria-label="Main navigation"`, which is also the
  correct accessible name for it.

Local result against a freshly seeded CI-shaped database, with the CI environment
(`APP_MODE=demo`, `CI=true`, `GITHUB_ACTIONS=true`, `RATE_LIMIT_CI_IN_MEMORY=true`):

```
17 passed (19.4s)
```

Before the change the same suite took 9m18s and reported 1 failed / 16 passed, with the
failure being the impossible `<header>` locator.

## Part 4: CodeQL alerts

Four source locations were genuinely wrong and are fixed at the root. Two reported alerts
describe code that does not contain the construct. The full table, with the evidence for
each decision, is in [SECURITY-EXPANSION-REVIEW.md](./SECURITY-EXPANSION-REVIEW.md#codeql-alerts-alert-by-alert).

New shared module: `src/lib/safe-url.ts` — `parseHttpsUrl`, `hostOf`, `isHostOfDomain`,
`isSafeExternalUrl`, `stripHtmlTags`. Regression suite: `tests/safe-url.test.ts`, 40
assertions, including `javascript:`, `data:`, `http:`, protocol-relative URLs, credentials
in the URL, `example.com.evil.test`, `notexample.com`, `evil-example.com`, a trusted name in
a query string, and a tag smuggled through nested angle brackets.

## Part 5: security architecture preserved

Nothing was disabled, relaxed or deleted to make a check pass.

- Server-side authorization, tenant scoping, role permissions, centralized password
  hashing, rate limiting, CSP, Stripe and Twilio webhook verification, audit logging and
  backup safeguards are untouched by this branch.
- `docs/RLS-STAGING-PLAN.md` was followed: no `FORCE ROW LEVEL SECURITY`, no change to the
  runtime database role, no tenant policy altered. The three gift-card tables with RLS and
  no policies remain documented as an approval item, not "fixed" quietly.
- The one authentication-adjacent change is in the **test**: it now verifies the session
  instead of assuming it.

## Part 6: verification actually run

| Check | Result |
|---|---|
| `npm run env:drift` | PASS — 100 declared, 78 referenced, 612 files |
| `npm run env:check` | 2 blocking: Upstash URL/token absent from this sandbox (environment gap, reported) |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, exit 0 |
| `npm run architecture:check` | PASS |
| `npm run test:ci` | PASS, exit 0 — 79 suites green, 0 failures |
| `npm run build` | PASS |
| `npx playwright test dashboard-smoke` | 17 passed (19.4s) |
| `npx tsx tests/safe-url.test.ts` | 40 passed |
| `npx tsx tests/accessibility-guard.test.ts` | 44 passed |

Not run here, and therefore not claimed: the GitHub Actions run itself, CodeQL's own scan,
and anything needing live Stripe, Twilio, Upstash or SMTP credentials.

## Part 7: change management

Dedicated branch `remediation/github-failures`, started from the recorded commit `4897948`.
No force-push. `main` is fast-forwarded only after the checks above pass, at the owner's
instruction to merge by pushing.

## Part 8: the plain-language summary

The repository was not broken in the way the failures suggested. The dashboard pages were
fine; the test that watched them was wrong in two ways, and one of those ways made it match
the word "Maintenance". The security alerts split into four real problems, now fixed with
tests, and two alerts that pointed at code which does not do what the alert described.

Still outstanding, and needing you rather than me: the Upstash credentials for this
environment, the RLS activation rehearsal, and the three gift-card tables that have row-level
security switched on with no policy attached.
