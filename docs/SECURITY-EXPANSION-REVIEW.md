# Security review for the expansion (Part 6)

Date: 2026-11-19. Scope: the existing controls, plus everything this expansion added.
Nothing in this review changed authentication, permissions, payments or tenant isolation.
No security control was disabled to make a check pass.

## What was verified, and how

| Claim | How it was checked | Result |
| --- | --- | --- |
| Every API route is authorized or deliberately public | `tests/security-sweep.test.ts` walks all 180 `route.ts` files, requires a guard call, and requires each of the 19 public endpoints to still contain the protection it relies on | PASS (52 assertions) |
| The tenant never comes from the request body | same suite scans every route for `businessId:` sourced from body/params/query | PASS, zero matches |
| Cross-tenant reads are refused | `npm run test:tenant` (22) and the cross-tenant matrix | PASS |
| Role boundaries hold, including co-owners | `npm run test:permissions` (37), `npm run test:coowner-permissions` | PASS |
| Password hashing stays centralized | security sweep: bcrypt calls confined to the password module | PASS |
| Webhooks verify signatures | Stripe uses `verifyStripeSignature` with timing-safe HMAC and an event-claim table; Twilio uses `isValidTwilioSignature` | PASS |
| CSP and frame protection remain | `src/proxy.ts` assertions in the sweep | PASS |
| No live credential literals in the tree | sweep regex over `src/` and `.env.example` | PASS |
| RLS is still staged, not switched on | no applied migration uses `FORCE ROW LEVEL SECURITY` | PASS |

## Findings

1. **RLS is enabled on three gift-card tables by an earlier migration**
   (`20261005014500_add_gift_cards`) with no policies attached. Because the application
   connects as the table owner, RLS is bypassed for it, so this is inert rather than
   protective. It is not a hole, but it is inconsistent with `docs/RLS-STAGING-PLAN.md`,
   which describes RLS as not yet active. Recorded here so the staging work reconciles it
   instead of discovering it. No change made: altering it is a tenant-isolation change and
   needs approval.
2. **`docs/CURRENT-STATUS.md` records 10 open CodeQL alerts** (tests and tooling, plus one
   documented false positive). CodeQL cannot be run from this environment; the sweep above
   is the evidence that exists, and it is not a substitute for the CodeQL run.
3. **No new route was added without a guard.** The one route this expansion added
   (`/api/dashboard/growth-stage`) is owner-only, resolves its tenant from the session,
   validates the value it writes, and writes to the audit log.

## Not verified here, and not claimed

- Penetration testing, CodeQL, and a real staging deployment with Upstash, Stripe, Twilio
  and SMTP credentials. Those remain outstanding in `docs/CURRENT-STATUS.md`.
- RLS enforcement in production. The 42 offline enforcement checks pass against a local
  PostgreSQL 15; the staged plan and its approval are still required.

## CodeQL alerts: alert by alert

Reconciled against the current branch, not against an earlier report. Each row is one
finding, what it actually was, what was done, and the evidence that the decision is sound.

| Alert | Severity | File and line | Root cause | Decision | Regression test | Evidence |
|---|---|---|---|---|---|---|
| Incomplete multi-character sanitization | High | `tests/accessibility-guard.test.ts:107` | `button.innerHTML.replace(/<[^>]+>/g, '')` — one pass, and `[^>]` lets a `<` survive inside a tag, so `<<b>script>` becomes `<script>` | **Fixed.** Replaced with `stripHtmlTags` from `src/lib/safe-url.ts`, which repeats until stable, bounded at ten passes, and matches `[^<>]*` so a nested bracket cannot be smuggled | `tests/safe-url.test.ts` (nested bracket, script tag, empty element, hostile input) | The test asserts `stripHtmlTags('<<b>script>') === ''`, which the old code returned as `<script>` |
| Incomplete multi-character sanitization | High | `scripts/a11y-static.mjs:67` | Same single-pass strip in the static accessibility scanner, so a tag could survive and hide an unnamed button | **Fixed.** Same bounded loop, written out in the script so it stays dependency-free | `npm run a11y:static` over the built HTML, plus the guard suite | A button whose label is only markup now reports as unnamed, which is the correct verdict |
| Incomplete URL substring sanitization | High | `tests/support-sources.test.ts:48` | `url.startsWith('https://')` treats `https://` as proof of a safe destination and ignores the host | **Fixed.** `isSafeExternalUrl` parses and requires protocol `https:`, a hostname, and no embedded credentials | `tests/safe-url.test.ts` | `javascript:`, `data:`, `http:`, `//host`, relative paths and credential-bearing URLs are all refused |
| Incomplete URL substring sanitization | High | `tests/support-sources.test.ts:114` | Same substring check on the "unknown source" record | **Fixed.** Parsed check, same helper | `tests/safe-url.test.ts` | — |
| Incomplete URL substring sanitization | High | `tests/backup-safety.test.ts:80,96` | `redactSecrets(url).includes('db.example.com')` — the trusted name can appear in a query string or a lookalike host | **Fixed.** Compares the parsed hostname exactly | `tests/safe-url.test.ts` (lookalike, query-string, suffix-without-dot cases) | `example.com.evil.test`, `notexample.com` and `evil-example.com` all fail the domain check |
| Incomplete URL substring sanitization | High | `tests/fonts.test.ts:65` | `html.includes('fonts.googleapis.com')` — matches the name anywhere, including a query string | **Fixed.** Every URL in the HTML is parsed and its hostname compared, including subdomains | `tests/fonts.test.ts` itself now parses | A lookalike host no longer passes, and a genuine reference still fails the build |
| DOM text reinterpreted as HTML | High | `src/components/dashboard/BarberForm.tsx` | Reported as an `innerHTML`/`dangerouslySetInnerHTML` sink for barber biography text | **False positive, verified.** The file has no HTML sink: `bio` is a controlled `<textarea value={bio}>` and the strings around it are JSX text. `grep -n "dangerouslySetInnerHTML\|innerHTML" src/components/dashboard/BarberForm.tsx` returns nothing | The guard suite forbids a click handler on a non-interactive element and an unlabelled control in this file | The alert's premise (user text reaching HTML) does not exist in the code that is on the branch |
| Insufficient computational effort in password hashing | High | `src/lib/google-business.ts` | Reported as a weak password hash | **False positive, verified.** There is no password hashing in the file. The only cryptography is `createHmac('sha256', …)` over the OAuth `state` payload, compared with `timingSafeEqual`, with a ten-minute expiry and fail-closed behaviour in production | `tests/google-business*.test.ts` cover state creation and rejection | A state signature is not a password: it is a short-lived MAC over `userId:businessId:issuedAt`, and raising the cost of the hash would change nothing an attacker can use |

### What this means for the alert count

Four distinct source locations were genuinely wrong and are now fixed at the root, not
silenced. Two reported alerts point at code that does not contain the construct they
describe; those are documented above with the check that proves it. Nothing was added to
an ignore list, and no query was disabled.
