/**
 * Restore rehearsal evidence (Priority 1).
 *
 * A rehearsal that cannot be read by the reliability report is a rehearsal nobody can act
 * on, so the outcome is written to the `RestoreDrill` table the maintenance report already
 * reads. Three rules shape this file:
 *
 *   1. Writing evidence is OPT-IN. `RESTORE_DRILL_EVIDENCE_URL` must be set explicitly.
 *      Without it nothing is written anywhere, which is what makes the default command safe
 *      to run against a production server: it reads, it restores into a scratch database,
 *      and it writes only a JSON file.
 *   2. The evidence connection is separate from the server being rehearsed. The scratch
 *      database is never used for this; it is dropped moments later.
 *   3. Success is never inferred. A record says 'succeeded' only when the rehearsal passed
 *      and the row counts actually matched. Anything else is recorded as failed, with the
 *      real reason, and never with a `verifiedAt` timestamp.
 */

export interface RestoreDrillOutcome {
  /** True only when the rehearsal itself passed every check. */
  passed: boolean
  backupId: string | null
  objectKey: string | null
  startedAt: Date
  completedAt: Date
  /** Tables whose row counts were compared in the source and the restored copy. */
  tablesRestored: string[]
  rowsCompared: number | null
  rowCountsMatched: boolean | null
  /** Sanitised, non-sensitive explanation. Never a connection string or a key. */
  detail: string | null
}

export interface RestoreDrillRecord {
  backupId: string | null
  objectKey: string | null
  startedAt: Date
  completedAt: Date
  status: 'succeeded' | 'failed'
  tablesRestored: string[]
  rowsCompared: number | null
  rowCountsMatched: boolean | null
  durationMs: number | null
  detail: string | null
  verifiedAt: Date | null
}

/** Remove anything that looks like a connection string or a credential. */
export function sanitiseEvidenceText(value: string | null | undefined, limit = 500): string | null {
  if (!value) return null
  const cleaned = value
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, '[connection string removed]')
    .replace(/\b(password|passwd|pwd|token|secret|key)\s*=\s*[^\s"']+/gi, '$1=[removed]')
    .slice(0, limit)
    .trim()
  return cleaned || null
}

/**
 * A record is only ever 'succeeded' when the rehearsal passed AND the counts matched AND
 * there was something to compare. Every other shape is a failure, and a failure never
 * carries `verifiedAt`.
 */
export function buildRestoreDrillRecord(outcome: RestoreDrillOutcome): RestoreDrillRecord {
  const comparable = outcome.tablesRestored.length > 0 && (outcome.rowsCompared ?? 0) > 0
  const succeeded = outcome.passed === true && outcome.rowCountsMatched === true && comparable
  const durationMs = Math.max(0, outcome.completedAt.getTime() - outcome.startedAt.getTime())

  return {
    backupId: outcome.backupId,
    objectKey: outcome.objectKey,
    startedAt: outcome.startedAt,
    completedAt: outcome.completedAt,
    status: succeeded ? 'succeeded' : 'failed',
    tablesRestored: outcome.tablesRestored,
    rowsCompared: outcome.rowsCompared,
    rowCountsMatched: succeeded ? true : outcome.rowCountsMatched,
    durationMs,
    detail: sanitiseEvidenceText(
      succeeded
        ? outcome.detail ?? `Restored ${outcome.tablesRestored.length} tables and compared ${outcome.rowsCompared ?? 0} rows.`
        : outcome.detail ?? 'The rehearsal did not pass, so nothing here proves the backup can be restored.'
    ),
    verifiedAt: succeeded ? outcome.completedAt : null,
  }
}

/** The evidence database, or null when the operator has not opted in. */
export function evidenceConnectionUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.RESTORE_DRILL_EVIDENCE_URL?.trim()
  return raw ? raw : null
}

/** The slice of a Prisma client this needs. Injected in tests, real in the script. */
export interface EvidenceWriter {
  restoreDrill: { create: (args: { data: RestoreDrillRecord }) => Promise<unknown> }
}

export interface EvidenceResult {
  saved: boolean
  recordStatus: RestoreDrillRecord['status'] | null
  /** Plain-language reason, safe to print. */
  reason: string
}

/**
 * Persist one rehearsal outcome. Never throws and never claims a write it did not make.
 */
export async function recordRestoreDrill(
  outcome: RestoreDrillOutcome,
  options: { client?: EvidenceWriter | null; url?: string | null } = {}
): Promise<EvidenceResult> {
  const url = options.url ?? evidenceConnectionUrl()
  if (!options.client && !url) {
    return {
      saved: false,
      recordStatus: null,
      reason: 'No evidence database is configured, so nothing was written. Set RESTORE_DRILL_EVIDENCE_URL to keep a record the reliability report can read.',
    }
  }

  let client = options.client ?? null
  let owned = false
  try {
    if (!client) {
      const { PrismaClient } = await import('@prisma/client')
      client = new PrismaClient({ datasources: { db: { url } } }) as unknown as EvidenceWriter
      owned = true
    }
    const record = buildRestoreDrillRecord(outcome)
    await client.restoreDrill.create({ data: record })
    return { saved: true, recordStatus: record.status, reason: 'The rehearsal outcome was saved to the reliability record.' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      saved: false,
      recordStatus: null,
      reason: `The rehearsal outcome could not be saved: ${sanitiseEvidenceText(message, 200) ?? 'unknown database error'}`,
    }
  } finally {
    if (owned && client) {
      const closeable = client as unknown as { $disconnect?: () => Promise<void> }
      await closeable.$disconnect?.().catch(() => {})
    }
  }
}
