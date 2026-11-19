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
