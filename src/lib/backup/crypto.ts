// ============================================================================
// Backup encryption + integrity helpers.
//
// A backup that leaves the database host is only as private as its storage
// bucket. These helpers encrypt the compressed dump with AES-256-GCM BEFORE it
// is uploaded, so an object-storage misconfiguration (a public bucket, a leaked
// presigned URL, a shared account) does not leak every customer record in the
// shop. The authentication tag also means a corrupted or truncated object fails
// loudly instead of restoring a silently damaged database.
//
// Key handling: BACKUP_ENCRYPTION_KEY is a 32-byte key, base64 (44 chars) or
// hex (64 chars). It is never printed, logged, or echoed in an error message.
//
// File layout of an encrypted backup (little-endian-free, fixed header):
//   bytes 0..4   magic "BRBK1"      — format + version, so a future format is
//                                    distinguishable instead of "decrypt failed"
//   bytes 5..16  IV (12 bytes)      — random per backup
//   bytes 17..32 auth tag (16 bytes)
//   bytes 33..   ciphertext         — the gzip'd dump
// ============================================================================

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const BACKUP_MAGIC = Buffer.from('BRBK1', 'ascii')
const IV_BYTES = 12
const TAG_BYTES = 16
export const BACKUP_HEADER_BYTES = BACKUP_MAGIC.length + IV_BYTES + TAG_BYTES

export class BackupCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupCryptoError'
  }
}

/** SHA-256 of a buffer, lowercase hex. Used for both ciphertext and plaintext. */
export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Parse a configured key. Accepts base64 (preferred) or hex so an operator who
 * generated one form with `openssl` is not blocked. The error names the expected
 * shape and never includes the value.
 */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  const value = raw?.trim()
  if (!value) {
    throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.')
  }
  const fromBase64 = /^[A-Za-z0-9+/]{43}=$/.test(value) ? Buffer.from(value, 'base64') : null
  const fromHex = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, 'hex') : null
  const key = fromBase64 ?? fromHex
  if (!key || key.length !== 32) {
    throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY must be 32 bytes encoded as base64 (44 chars) or hex (64 chars).')
  }
  return key
}

/** True when a key is present and usable — used by readiness/status reporting. */
export function isEncryptionKeyConfigured(raw: string | undefined): boolean {
  try {
    parseEncryptionKey(raw)
    return true
  } catch {
    return false
  }
}

export function encryptBackup(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([BACKUP_MAGIC, iv, tag, ciphertext])
}

export function decryptBackup(payload: Buffer, key: Buffer): Buffer {
  if (payload.length <= BACKUP_HEADER_BYTES) {
    throw new BackupCryptoError('Encrypted backup is truncated: shorter than its own header.')
  }
  const magic = payload.subarray(0, BACKUP_MAGIC.length)
  if (!timingSafeEqual(magic, BACKUP_MAGIC)) {
    throw new BackupCryptoError('Encrypted backup has an unrecognised header (not a BRBK1 backup).')
  }
  const iv = payload.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + IV_BYTES)
  const tag = payload.subarray(BACKUP_MAGIC.length + IV_BYTES, BACKUP_HEADER_BYTES)
  const ciphertext = payload.subarray(BACKUP_HEADER_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    // Wrong key, or the object changed after it was written. Both are integrity
    // failures; the detail is deliberately identical so an attacker probing the
    // bucket cannot distinguish them.
    throw new BackupCryptoError('Encrypted backup failed authentication: wrong key or the file was altered after upload.')
  }
}

/** Generate a key in the documented format (base64). For setup instructions. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64')
}
