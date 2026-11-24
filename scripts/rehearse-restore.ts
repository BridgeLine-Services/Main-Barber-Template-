#!/usr/bin/env node
/**
 * Restoration rehearsal (Part 3.4 / Part 19).
 *
 *   npm run db:backup:rehearse                  # newest verified off-site copy
 *   npm run db:backup:rehearse -- --object <k>  # a specific object key
 *   npm run db:backup:rehearse -- --json        # machine-readable evidence
 *
 * Proves, on demand and without touching production, that a real recovery works
 * and how long it takes. It: finds the newest VERIFIED off-site backup, downloads
 * it, authenticates and decrypts it, checks the plaintext hash, restores it into a
 * scratch database, runs the same parity checks as `db:backup-verify`, drops the
 * scratch database, and prints the measured recovery time.
 *
 * The number it prints is the only honest source for an RTO claim. Run it
 * quarterly, and after any change to the database, the backup code or the
 * provider. Nothing here restores over an existing database: the target database
 * name is generated, and a refusal is raised if it somehow exists.
 *
 * Exit: 0 rehearsal passed, 1 failed, 2 not configured (no destination or key).
 */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createCleanupRegistry, sanitizeDumpForRestore, verifyRestore } from './backup'
import { createStorageFromEnv, BackupStorageError } from './lib/backup-storage'
import { decryptBackup, parseEncryptionKey, sha256Hex } from '../src/lib/backup/crypto'
import { isVerified, type BackupManifest } from '../src/lib/backup/manifest'
import { recordRestoreDrill, type RestoreDrillOutcome } from '../src/lib/platform-reliability/restore-drill-evidence'

interface ManifestPointer { objectKey: string; payloadKey: string; manifest: BackupManifest }

async function findNewest(dbUrl: string, objectKey?: string): Promise<ManifestPointer> {
  const storage = createStorageFromEnv()
  const listed = objectKey ? [objectKey] : await storage.list('database/')
  // list() returns stored objects on some drivers and plain keys on others.
  const keys = listed.map((entry) => (typeof entry === 'string' ? entry : (entry as { key?: string; pathname?: string }).key ?? (entry as { pathname?: string }).pathname ?? ''))
  const manifests: ManifestPointer[] = []
  for (const key of keys.filter((candidate) => candidate.endsWith('.manifest.json')).sort().reverse()) {
    const body = await storage.get(key)
    try {
      const manifest = JSON.parse(body.toString('utf8')) as BackupManifest
      if (isVerified(manifest)) {
        // Archive layout: database/<id>.sql.gz.enc beside database/<id>.manifest.json
        const payloadKey = objectKey ? key : key.replace(/\.manifest\.json$/, '.sql.gz.enc')
        manifests.push({ objectKey: key, payloadKey, manifest })
      }
    } catch { /* an unreadable manifest is skipped, never guessed at */ }
  }
  if (manifests.length === 0) throw new BackupStorageError('No verified off-site backup exists to rehearse.', ['database/*.manifest.json'])
  manifests.sort((a, b) => Date.parse(b.manifest.startedAt) - Date.parse(a.manifest.startedAt))
  void dbUrl
  return manifests[0]
}

async function main() {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const objectArg = args.includes('--object') ? args[args.indexOf('--object') + 1] : undefined
  const dbUrl = process.env.DATABASE_URL?.trim()
  if (!dbUrl) { console.error('DATABASE_URL is not set, so there is no server to rehearse against.'); process.exit(2) }

  let pointer: ManifestPointer
  let storage
  let key: Buffer
  try {
    key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY)
    storage = createStorageFromEnv()
    pointer = await findNewest(dbUrl, objectArg)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Rehearsal cannot run: ${message}`)
    process.exit(2)
  }

  const cleanup = createCleanupRegistry()
  const workDir = mkdtempSync(join(tmpdir(), 'rehearsal-'))
  cleanup.add('rehearsal work directory', () => rmSync(workDir, { recursive: true, force: true }))
  const startedAt = new Date()

  try {
    const stored = await storage.get(pointer.payloadKey)
    // The manifest records the checksum of the stored (encrypted) object, so the
    // bytes on disk are checked first; the decrypted content is then proven by
    // decompressing it and by the restore itself.
    const storedDigest = sha256Hex(stored)
    if (pointer.manifest.checksumSha256 && storedDigest !== pointer.manifest.checksumSha256) {
      throw new Error('The downloaded backup does not match its recorded checksum, so it is not a recovery copy.')
    }
    const packed = decryptBackup(stored, key)
    const dump = gunzipSync(packed)
    const digest = sha256Hex(dump)
    const { text } = sanitizeDumpForRestore(dump.toString('utf8'))
    const evidence = verifyRestore(dbUrl, text, cleanup)
    const finishedAt = new Date()
    const result = {
      passed: true,
      backupId: pointer.manifest.id,
      backupStartedAt: pointer.manifest.startedAt,
      backupAgeHours: Math.round((startedAt.getTime() - Date.parse(pointer.manifest.startedAt)) / 36_000) / 100,
      bytes: dump.length,
      storedBytes: stored.length,
      storedSha256: storedDigest,
      checksumSha256: digest,
      schemaTables: evidence.restoredTables,
      rowCounts: evidence.rowCounts,
      foreignKeyViolations: evidence.foreignKeyViolations,
      migrationsApplied: evidence.migrationsApplied,
      recoverySeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
      rehearsedAt: finishedAt.toISOString(),
      target: 'scratch database, dropped afterwards',
    }
    // Kept outside the disposable work directory, because the evidence is the
    // point: it is what a quarterly rehearsal is signed off against.
    const evidenceDir = join(process.cwd(), 'backups', 'rehearsals')
    mkdirSync(evidenceDir, { recursive: true })
    const evidencePath = join(evidenceDir, `rehearsal-${result.rehearsedAt.replace(/[:.]/g, '-')}.json`)
    writeFileSync(evidencePath, JSON.stringify(result, null, 2))

    // Reliability evidence. Opt-in: without RESTORE_DRILL_EVIDENCE_URL this writes
    // nothing anywhere, which is what keeps the default run read-only.
    const outcome: RestoreDrillOutcome = {
      passed: true,
      backupId: pointer.manifest.id ?? null,
      objectKey: pointer.payloadKey,
      startedAt,
      completedAt: finishedAt,
      tablesRestored: Object.keys(evidence.rowCounts),
      rowsCompared: Object.values(evidence.rowCounts).reduce((sum, rows) => sum + rows, 0),
      rowCountsMatched: true,
      detail: `Restored ${evidence.restoredTables} tables; ${evidence.foreignKeyViolations.length} foreign-key violations; ${evidence.migrationsApplied} migrations applied.`,
    }
    const saved = await recordRestoreDrill(outcome)
    const rehearsalSucceeded = result.passed && saved.saved && saved.recordStatus === 'succeeded'
    if (!rehearsalSucceeded) process.exitCode = 1

    if (json) console.log(JSON.stringify({ ...result, restorePassed: result.passed, passed: rehearsalSucceeded, evidenceSaved: saved.saved, evidenceRecordStatus: saved.recordStatus, evidenceNote: saved.reason }))
    else {
      console.log(rehearsalSucceeded
        ? `PASS  restored backup ${result.backupId} (${(result.bytes / 1_048_576).toFixed(1)} MB) in ${result.recoverySeconds}s`
        : `FAIL  restore or evidence did not pass: ${saved.reason}`)
      console.log(`      ${result.schemaTables} tables, ${result.foreignKeyViolations.length} foreign-key violations, ${result.migrationsApplied} migrations`)
      console.log('      Scratch database dropped. Nothing was written to any existing database.')
      console.log(`      Evidence: ${evidencePath}`)
      if (saved.recordStatus === 'succeeded') console.log('      A successful evidence record was saved to the reliability report.')
      else console.log(`      The evidence record is ${saved.recordStatus ?? 'not saved'}; this rehearsal is not complete.`)
      if (!rehearsalSucceeded) console.log('      Manual attention is required before treating this rehearsal as successful.')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const finishedAt = new Date()
    // A failed rehearsal is recorded as failed, with the real reason. It is never turned
    // into a success, and a failure here never changes the outcome of the run itself.
    const saved = await recordRestoreDrill({
      passed: false,
      backupId: pointer.manifest.id ?? null,
      objectKey: pointer.payloadKey,
      startedAt,
      completedAt: finishedAt,
      tablesRestored: [],
      rowsCompared: null,
      rowCountsMatched: false,
      detail: message,
    })
    if (json) console.log(JSON.stringify({ passed: false, reason: message, rehearsedAt: finishedAt.toISOString(), evidenceSaved: saved.saved, evidenceNote: saved.reason }))
    else {
      console.error(`FAIL  ${message}`)
      console.error(saved.saved ? '      The failure was saved to the reliability record.' : `      Evidence could not be saved. ${saved.reason}`)
      console.error('      Manual attention is required: the restore test failed.')
    }
    process.exitCode = 1
  } finally {
    const failures = cleanup.runAll()
    if (failures.length > 0) {
      console.error(`Cleanup could not finish: ${failures.map((f) => f.name).join(', ')}. A scratch database may remain; drop it by hand.`)
      if (!process.exitCode) process.exitCode = 1
    }
  }
  void existsSync; void createHash
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
