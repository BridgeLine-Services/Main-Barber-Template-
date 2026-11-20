# CodeQL remediation (Priority 4)

The repository has no CodeQL workflow of its own, so the alerts come from GitHub's default
code scanning setup. That matters for remediation: a configuration file in the repository is
not guaranteed to be read by default setup, so every finding below is addressed **in code**
rather than by excluding a path.

Six alerts were open when this work started, not the ten the earlier status documents
claimed. Each is listed with what it was, what was done, and how to confirm it.

| # | Rule | File | Verdict | Action |
| --- | --- | --- | --- | --- |
| 29 | `js/xss-through-dom` | `src/components/dashboard/BarberForm.tsx` | Hardened, alert still open | A second, explicit scheme check (`isRenderableImageSrc`) now guards the `<img src>` at the render site. The sink is an image source, which cannot execute script, and the value is parsed twice. |
| 24 → 32 | `js/incomplete-multi-character-sanitization` | `scripts/a11y-static.mjs` | Fixed in code | The first fix (repeat until stable) left a `replace(/<!--/g, '')` fallback that the rule flagged again as alert 32. The marker is now never deleted: a marker that survives every pass means the comment was never closed, so the document is truncated at it. |
| 22, 23 | `js/incomplete-url-substring-sanitization` | `tests/fonts.test.ts` | Fixed, alert closed | The assertion now parses every `url(...)` and compares the **hostname**, so `fonts.googleapis.com.evil.test` would fail the test instead of passing it. |
| 30 | `js/incomplete-url-substring-sanitization` | `tests/support-sources.test.ts` | Fixed, alert closed | The source link is parsed and its hostname compared, rather than checked for a substring. |
| 7 | `js/insufficient-password-hash` | `src/lib/google-business.ts` | False positive, alert still open | The flagged value is an HMAC-SHA256 signature over a short-lived OAuth state token, compared with `timingSafeEqual`. It is not a password hash and the key is a server secret. |

## Honest state of the alert list

After the push, the open list went from six to three: 22, 23 and 30 closed because the code
changed. Three remained: 29 and 7 as described above, plus 32, which was a **new** alert the
first a11y fix introduced. 32 is now fixed in code.

Two alerts therefore remain open by decision, not by neglect:

- **29 (`js/xss-through-dom`)** is a real taint flow to a sink that cannot execute script.
  GitHub's default code scanning does not honour the inline `codeql[...]` suppression
  comments, so the alert can only be closed by dismissing it.
- **7 (`js/insufficient-password-hash`)** is a false positive of the same kind.

Both were submitted for dismissal with a full written justification, and **the API refused
with "Resource not accessible by personal access token"**: dismissing a code-scanning alert
needs the `security_events: write` scope, which the token used for this work does not have.
They are therefore still open, and closing them needs one of:

1. A token with `security_events: write`, then
   `PATCH /repos/{owner}/{repo}/code-scanning/alerts/{n}` with
   `{"state":"dismissed","dismissed_reason":"false positive","dismissed_comment":"..."}`.
2. A maintainer dismissing them in the Security tab, using the wording above.

This is recorded rather than worked around: a security alert is not something to close by
loosening a rule or by pretending the finding does not exist.

## Why the test findings were worth fixing rather than excluding

Both were genuine weak tests. A substring check for `fonts.googleapis.com` passes for
`https://fonts.googleapis.com.attacker.test/`, which is exactly the case the test exists to
catch. Comparing hostnames makes the test stronger and the alert disappears as a side effect.

## What to check after the next scan

1. Alerts 22, 23, 30 and 32 are gone.
2. Alerts 29 and 7 remain until someone with `security_events: write` dismisses them with the
   justification recorded above. Neither is a defect, and neither should be "fixed" by
   loosening the OAuth state signing or by removing the image preview.
3. No new alert appears in `src/app/api/dashboard/organization/**`, which is the newest
   authorization surface. Those routes take the tenant from the session only.

## Rules that keep this from coming back

- No route may read a business or organization id from the request body. `tests/security-sweep.test.ts`
  fails the build if one does.
- Raw HTML injection stays confined to the reviewed files listed in that sweep.
- A URL comparison in a test must parse the URL, not search the string.
