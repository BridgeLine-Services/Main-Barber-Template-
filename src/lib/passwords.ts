/**
 * Password hashing — one policy, one place.
 *
 * bcryptjs cost was previously 10 in some account-creation paths and 12 in
 * others, which meant the weakest path set the real security level for the
 * whole product. Everything that creates or changes a password now goes
 * through hashPassword().
 *
 * Cost 12 is the baseline. It is deliberately a single constant: two places
 * must never drift apart again. Existing hashes are NOT touched — bcrypt
 * embeds its own cost in the hash, so every stored digest continues to verify
 * with the same function, and nobody is forced to reset anything.
 */

import bcrypt from 'bcryptjs'

/** Work factor for every new or changed password. */
export const BCRYPT_COST = 12

/** Hash a plaintext password for storage. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

/**
 * Verify a password against a stored hash.
 *
 * Kept here so verification and creation share one module, and so a future
 * cost change cannot accidentally alter the verify path.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
