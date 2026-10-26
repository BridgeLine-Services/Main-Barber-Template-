# Owner two-factor authentication status

Owner accounts currently use NextAuth Credentials with bcrypt password verification and JWT sessions. `src/lib/security.ts` contains RFC-compliant TOTP and backup-code helpers, but enrollment, encrypted secret storage, second-factor login state, replay prevention, recovery, and rate-limited verification are not integrated into the authentication flow.

## Policy

2FA is not advertised as active and is not required by the current application. Existing owners are not locked out. Do not enable a partial implementation or add a support bypass: doing so could create a false security boundary or lock out the only owner.

## Required staged rollout

1. Select and review a maintained secret-storage and challenge design compatible with the current Prisma/NextAuth JWT flow.
2. Add owner-only enrollment that displays a secret only during setup and requires a successful code confirmation before activation.
3. Encrypt secrets at rest, store only hashed single-use recovery codes, and bind pending challenges to the account and an expiry.
4. Add rate-limited verification, replay protection, audit events, session refresh after enrollment, and recovery that requires multiple independent proofs.
5. Test owner enrollment, login, reset, refresh, recovery, role changes, disabled 2FA, and all non-owner roles before choosing optional or required enrollment.

Until that work is complete, password authentication remains the only active owner factor. The existing TOTP helpers must not be used as evidence that 2FA is enabled.
