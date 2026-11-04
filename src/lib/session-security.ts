// ============================================================================
// Session security — password-change session invalidation.
//
// NextAuth v4 JWT sessions are stateless: a signed-in user keeps a valid
// cookie until it expires, even after their password changes. If a password
// was compromised, changing it would NOT lock out an attacker (or anyone
// else) holding an existing session cookie.
//
// Fix: the JWT is stamped at sign-in with the account's passwordChangedAt
// (`pwd`, epoch ms). Every request re-checks the stamp against the DB:
// if the password changed AFTER this session was issued, the session is
// dead and both the JWT and session callbacks collapse it to nothing, so
// getServerSession() returns null and every guard treats the request as
// unauthenticated.
//
// Sessions minted before this mechanism shipped carry no `pwd` stamp; they
// are grandfathered (no check) so the change cannot log the whole user base
// out at deploy time.
// ============================================================================

export const PWD_CLAIM = 'pwd'
/** Millisecond timestamp of when this session signed in (revocation cutoff base). */
export const SESSION_START_CLAIM = 'sat'
export const DEAD_CLAIM = 'dead'

/**
 * Decide whether a session is dead because the account's password changed
 * after the session was issued.
 *
 * @param dbPasswordChangedAt the account's current passwordChangedAt (DB truth)
 * @param pwdStamp the epoch-ms stamp captured when this session was signed in
 *   (null/undefined = session predates the mechanism — grandfathered)
 */
export function isSessionInvalidated(
  dbPasswordChangedAt: Date | string | null | undefined,
  pwdStamp: number | null | undefined
): boolean {
  if (typeof pwdStamp !== 'number') return false
  if (!dbPasswordChangedAt) return false
  const changedMs =
    dbPasswordChangedAt instanceof Date
      ? dbPasswordChangedAt.getTime()
      : new Date(dbPasswordChangedAt).getTime()
  if (Number.isNaN(changedMs)) return false
  // Strictly newer: equal timestamps mean the session was minted after the
  // change (e.g. signed in right after changing the password).
  return changedMs > pwdStamp
}

/**
 * True when a session was issued before the account's revocation cutoff, i.e.
 * the owner pressed "sign out of all devices" after this session was minted.
 *
 * `issuedAtMs` is the JWT's own iat. A session issued in the same millisecond
 * as the cutoff survives (it is the one that performed the revocation).
 */
export function isSessionRevoked(
  sessionsValidAfter: Date | string | null | undefined,
  issuedAtMs: number | null | undefined,
): boolean {
  if (typeof issuedAtMs !== 'number' || Number.isNaN(issuedAtMs)) return false
  if (!sessionsValidAfter) return false
  const cutoffMs =
    sessionsValidAfter instanceof Date
      ? sessionsValidAfter.getTime()
      : new Date(sessionsValidAfter).getTime()
  if (Number.isNaN(cutoffMs)) return false
  return issuedAtMs < cutoffMs
}
