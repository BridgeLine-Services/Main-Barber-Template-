# CodeQL remediation (Priority 4)

The repository has no CodeQL workflow of its own, so the alerts come from GitHub's default
code scanning setup. That matters for remediation: a configuration file in the repository is
not guaranteed to be read by default setup, so every finding below is addressed **in code**
rather than by excluding a path.

Six alerts were open when this work started, not the ten the earlier status documents
claimed. Each is listed with what it was, what was done, and how to confirm it.

| # | Rule | File | Verdict | Action |
| --- | --- | --- | --- | --- |
| 29 | `js/xss-through-dom` | `src/components/dashboard/BarberForm.tsx` | Hardened | A second, explicit scheme check (`isRenderableImageSrc`) now guards the `<img src>` at the render site, and the suppression comment states why an image source cannot execute script. |
| 24 | `js/incomplete-multi-character-sanitization` | `scripts/a11y-static.mjs` | Fixed | `stripComments` now repeats until the string stops changing, with a hard bound, instead of relying on one pass that can leave a new `<!--` behind. |
| 22, 23 | `js/incomplete-url-substring-sanitization` | `tests/fonts.test.ts` | Fixed | The assertion now parses every `url(...)` and compares the **hostname**, so `fonts.googleapis.com.evil.test` would fail the test instead of passing it. |
| 30 | `js/incomplete-url-substring-sanitization` | `tests/support-sources.test.ts` | Fixed | The source link is parsed and its hostname compared, rather than checked for a substring. |
| 7 | `js/insufficient-password-hash` | `src/lib/google-business.ts` | False positive, documented | The flagged value is an HMAC-SHA256 signature over a short-lived OAuth state token, compared with `timingSafeEqual`. It is not a password hash and the key is a server secret. A `codeql[...]` comment records this at the line. |

## Why the test findings were worth fixing rather than excluding

Both were genuine weak tests. A substring check for `fonts.googleapis.com` passes for
`https://fonts.googleapis.com.attacker.test/`, which is exactly the case the test exists to
catch. Comparing hostnames makes the test stronger and the alert disappears as a side effect.

## What to check after the next scan

1. Alerts 22, 23, 24, 29 and 30 are gone.
2. Alert 7 is either gone (the suppression is honoured) or remains as a documented false
   positive. It is not a defect and should not be "fixed" by changing the OAuth state signing.
3. No new alert appears in `src/app/api/dashboard/organization/**`, which is the newest
   authorization surface. Those routes take the tenant from the session only.

## Rules that keep this from coming back

- No route may read a business or organization id from the request body. `tests/security-sweep.test.ts`
  fails the build if one does.
- Raw HTML injection stays confined to the reviewed files listed in that sweep.
- A URL comparison in a test must parse the URL, not search the string.
