# Account protection review (Priority 4)

What is already in place, what was added, and what remains a decision for the owner. This is a
review of the existing system, not a rebuild: password hashing, sessions and two-factor
enrolment were already implemented and are left where they are.

## Already in place, verified by reading the code and the tests

| Control | Where | Status |
| --- | --- | --- |
| Password hashing behind one module | `src/lib/passwords.ts`, asserted by `tests/security-sweep.test.ts` | Working |
| Session invalidation ("sign out of all devices") | `User.sessionsValidAfter`, compared with the session issue time | Working |
| Individual session listing and revocation | `UserSession`, `tests/session-security.test.ts` | Working |
| Two-factor enrolment with a proof step | `src/lib/two-factor-enrollment.ts`, TOTP secret encrypted | Working |
| TOTP replay prevention | `User.twoFactorLastCounter` | Working |
| Recovery codes | `TwoFactorRecoveryCode` | Working |
| Login and register rate limiting | `src/lib/rate-limit.ts` | Working |
| Content security policy and frame protection | `src/proxy.ts` | Working |
| Portal sessions for customers | `PortalSession`, token-based | Working |

## Added by this work

1. **Organization roles are a database enum.** A role outside the four known values cannot be
   stored at all, so an unrecognised role cannot grant access. `tests/organization-isolation.test.ts`
   asserts the enum's exact contents.
2. **Fail-closed role resolution.** `normaliseRole` returns `null` for anything it does not
   recognise, and `capabilitiesFor` returns an empty list. An unknown role therefore has no
   permissions rather than every permission.
3. **Suspended membership is refused.** A suspended organization member resolves to no
   context at all, so the organization layer is unavailable to them rather than partially
   available.
4. **Corporate roles cannot read a customer record.** This is enforced in
   `canReadCustomerRecord`, which refuses a corporate role even at a location it administers.
   The capability table does not contain the permission for any corporate role, so the check
   cannot be passed by accident.

## Gaps that remain, and why they are not silently "fixed"

| Gap | Why it remains | Recommendation |
| --- | --- | --- |
| Two-factor is opt-in and owner-only | Changing who must enrol changes how people sign in, which is an owner decision | Offer enrolment to managers; require it for organization owners |
| No email verification on sign-up | Out of scope for this pass; the reset flow covers the practical risk | Add verification before enabling organization invites by email |
| No password breach-list check | Needs an external service and a policy decision | Add at the same time as the next auth change |
| No device fingerprinting on sessions | Privacy trade-off, not a security requirement | Skip unless a real incident calls for it |

## The one thing an owner must decide

Whether a corporate role may ever see an individual customer, and under what written
condition. The system currently says no, always, and requires a separate, revocable consent
record before one location may see a customer's history from another. If that is too strict
for a franchise, the change must be made deliberately in `capabilities.ts` with a test that
proves the exception, not by widening a role.
