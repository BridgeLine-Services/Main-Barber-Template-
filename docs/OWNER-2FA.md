# Owner two-factor authentication (TOTP)

Status as of 2026-11-01: **implementation complete and opt-in**. 2FA is available
to owners and business administrators, is never switched on for them without
their action, and is not yet required by policy.

## What is implemented

| Requirement | Where | Evidence |
| --- | --- | --- |
| Secure secret generation | `src/lib/security.ts` (`generateTOTPSecret`, 20 random bytes, base32) | `tests/two-factor.test.ts` (RFC 6238 vectors) |
| Encrypted secret storage | `src/lib/two-factor-enrollment.ts` (AES-256-GCM, versioned, authenticated) | `tests/two-factor-enrollment.test.ts` (tamper / wrong key / version rejection) |
| Enrolment confirmation | `confirmEnrollment` only enables after a real authenticator code verifies | same suite ("wrong code cannot switch two-factor on") |
| Second-factor login | `authorize()` in `src/lib/auth.ts` requires a code when `twoFactorEnabled` | `tests/two-factor-api.test.ts` ("password alone does NOT sign in") |
| Rate-limited verification | per-account throttle on failed codes, per-IP throttle on `/api/auth/2fa/required` | code + API suite |
| Replay prevention | replay guard records the **matched** time step; a used step cannot be replayed | "the code used at enrolment cannot be reused" |
| Recovery codes | 10 codes, SHA-256 at rest, shown once, single-use via conditional UPDATE | "the recovery code was consumed exactly once" |
| Recovery-code single use | `consumeRecoveryCode` marks one unused row inside a transaction | same |
| Safe recovery | password + unused recovery code disables 2FA; no support bypass exists | "password plus an unused recovery code turns two-factor off" |
| Audit logging | `TWO_FACTOR_ENABLED` / `TWO_FACTOR_DISABLED` (failed attempts are throttled, not audited per attempt) | migration `20261102012550_audit_two_factor_actions` |
| Owner-facing UI | `System → Security` → `TwoFactorCard` | browser-verified: setup key, confirm, recovery display, disable |
| Non-technical instructions | the Security screen itself, in plain language | copy reviewed for jargon |

## Security behaviour worth knowing

- **Nothing changes until a code is confirmed.** Starting setup stores an
  encrypted secret but leaves the account unprotected, so an abandoned setup can
  never lock an owner out.
- **A refusal looks like a wrong password.** Missing or wrong codes return the
  same response shape as a bad password, so the endpoint cannot be used to learn
  which accounts exist or which are protected.
- **Keys fail closed.** The encryption key comes from `TWO_FACTOR_ENCRYPTION_KEY`,
  else is derived (HKDF-SHA256) from `NEXTAUTH_SECRET`, else the process refuses
  to operate in production instead of using a predictable key.
- **Rate limiting fails closed too.** With no Redis / no CI local mode, every
  rate-limited action — including sign-in — is denied. A production deployment
  must have Upstash configured or nobody can log in. This is deliberate.

## Deployment requirements

| Variable | Required when | Notes |
| --- | --- | --- |
| `NEXTAUTH_SECRET` | always | also the default derivation source for the 2FA key |
| `TWO_FACTOR_ENCRYPTION_KEY` | recommended | 32 bytes, hex or base64; lets the 2FA key rotate independently of sessions |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | always in production | absent means sign-in is denied (fail closed) |

Rotating `TWO_FACTOR_ENCRYPTION_KEY` or `NEXTAUTH_SECRET` without
`TWO_FACTOR_ENCRYPTION_KEY` set invalidates existing 2FA enrolments: affected
owners will be asked for a code that no longer verifies. Either set a dedicated
key before rolling out, or have the owner re-enrol.

## What an owner sees if they lose their phone

1. Sign in with password → the code step appears.
2. Enter one of the recovery codes saved at enrolment (each works once).
3. In the dashboard, turn two-factor off, then set it up again on the new phone.

If both the phone and every recovery code are lost, there is **no support
bypass**: an owner with database access must disable `twoFactorEnabled` for that
account, which is intentionally not exposed through the product.

## Deliberately not done (needs a product decision, not code)

- **Mandatory 2FA for all owners.** The rollout plan calls for staging
  acceptance first; forcing it now could lock out an owner mid-enrolment.
- **Device/session management UI** (list and revoke active sessions).
- **Trusted-device "remember this browser"** — would weaken the second factor
  unless tied to the existing session-fingerprint mechanism.
- **Email-based recovery.** Adding a second recovery channel changes the threat
  model (email takeover becomes enough) and needs review.

## Verification commands

```bash
npx tsx tests/two-factor.test.ts            # primitives, RFC vectors (41)
npx tsx tests/two-factor-enrollment.test.ts # storage layer (45)
npx tsx tests/two-factor-api.test.ts        # API + login gate (32, needs a server)
```

The API suite needs the same `NEXTAUTH_SECRET` as the server, since the fixture
secret is encrypted with the derived key.

## Signing out of all devices

`POST /api/dashboard/security/sessions/revoke` (button: Security → Signed-in
devices → "Sign out everywhere") sets `User.sessionsValidAfter`. The jwt callback
compares that cutoff against each session's own sign-in stamp (`sat` claim) and
marks older sessions dead, so revocation is enforced on the next request, not by
hiding UI.

- Requires the account password, so a stolen-but-unattended session cannot
  repeatedly knock the real owner out.
- Signs out **every** device including the one pressing the button, and the UI
  redirects to sign-in. Keeping "this device" alive would mean deciding which
  session is the trusted one from inside a possibly compromised session; the
  obvious shortcut (cutoff = a moment ago) leaves a session signed in seconds
  earlier untouched.
- Audited as `SESSIONS_REVOKED`.
- A sign-in performed after the call works normally (strictly-before comparison,
  cutoff = now).
- Sessions minted before this feature have no stamp and are left alone.

Verified: `tests/session-revocation.test.ts` (21 assertions) covers two live
sessions, wrong-password refusal, both sessions dying, the audit entry, and a
fresh sign-in afterwards.
