// Watchdog: alert when no recent verified backup exists.
//   npm run db:backup:freshness
// Run it from the same scheduler as the backup, a few hours later, so a scheduler
// that silently stopped is still noticed. Exit 1 means the newest verified backup
// is older than the target (or none exists).
import { checkBackupFreshnessAlert } from './backup-offsite'

async function main(): Promise<number> {
  const maxAgeHours = Number(process.argv.includes('--max-age-hours')
    ? process.argv[process.argv.indexOf('--max-age-hours') + 1]
    : process.env.BACKUP_MAX_AGE_HOURS ?? 30)
  const result = await checkBackupFreshnessAlert(new Date(), Number.isFinite(maxAgeHours) ? maxAgeHours : 30)
  if (result.stale) {
    console.error(`[freshness] STALE: newest verified backup is ${result.newestVerifiedAt ?? 'missing'}.`)
    return 1
  }
  console.log(`[freshness] OK: newest verified backup ${result.newestVerifiedAt}.`)
  return 0
}

main().then((code) => { process.exitCode = code })
