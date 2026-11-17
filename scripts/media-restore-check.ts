#!/usr/bin/env node
/**
 * Media recoverability drill (Part 4).
 *
 *   npm run media:restore-check              # newest 5 photos in the index
 *   npm run media:restore-check -- --all     # every indexed photo
 *
 * Answers one question with evidence: could we actually get a shop's photos back?
 * It reads media/index.json, downloads a sample of stored objects, authenticates
 * and decrypts each one, and confirms the decrypted size matches the index. It
 * writes nothing to the media provider and never touches an original.
 *
 * Exit: 0 every sampled object recovered, 1 an object is missing or corrupt,
 *       2 not configured.
 */
import process from 'node:process'
import { createStorageFromEnv } from './lib/backup-storage'
import { decryptBackup, parseEncryptionKey } from '../src/lib/backup/crypto'

interface MediaIndexEntry { pathname: string; size: number; storedAt?: string }

async function main() {
  const all = process.argv.includes('--all')
  let storage, key
  try {
    key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY)
    storage = createStorageFromEnv()
  } catch (error) {
    console.error(`Media check cannot run: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }

  let index: MediaIndexEntry[] = []
  try {
    const body = await storage.get('media/index.json')
    index = (JSON.parse(body.toString('utf8')).entries ?? []) as MediaIndexEntry[]
  } catch {
    console.error('No media index exists yet. Run `npm run media:backup` first.')
    process.exit(2)
  }
  if (index.length === 0) { console.log('The media index is empty: there is nothing to recover.'); return }

  const sample = all ? index : index.slice(0, 5)
  let failed = 0
  for (const entry of sample) {
    try {
      const stored = await storage.get(`media/${entry.pathname}.enc`)
      const plaintext = decryptBackup(stored, key)
      if (entry.size && plaintext.length !== entry.size) {
        failed++
        console.error(`FAIL  ${entry.pathname}: recovered ${plaintext.length} bytes, index says ${entry.size}`)
        continue
      }
      console.log(`ok    ${entry.pathname} (${plaintext.length} bytes)`)
    } catch (error) {
      failed++
      console.error(`FAIL  ${entry.pathname}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.log(`\n${sample.length - failed}/${sample.length} photos recovered from the backup copy.`)
  if (failed > 0) {
    console.error('A missing photo is recovered by restoring it at its original pathname; see docs/DISASTER-RECOVERY.md §3.')
    process.exit(1)
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
