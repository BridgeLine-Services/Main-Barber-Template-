// ============================================================================
// Media backup planning (Disaster recovery, Layer 4)
//
// Uploaded files live in object storage, not in PostgreSQL, so a database backup
// recovers every appointment and customer while every logo, barber photo and
// before/after pair stays gone. This is the pure part of the media copy: decide
// what must be copied, what is already protected, and — importantly — what has
// disappeared from the origin.
//
// Rules:
//   • Never delete an original. This planner only ever reads.
//   • Never delete a stored copy because the original vanished: a missing
//     original is exactly when the copy matters.
//   • Re-copy when the size or upload time changed, so a replaced photo is not
//     left as the old one in the recovery set.
//   • Object identifiers and URLs are preserved verbatim; nothing here rewrites
//     a URL the database already references.
// ============================================================================

export interface MediaBlobRef {
  /** Stable object path, e.g. "gallery/abc-123.jpg". */
  pathname: string
  url: string
  size: number
  uploadedAt?: string | null
}

export interface MediaCopyRecord {
  pathname: string
  size: number
  /** When the copy was written (ISO). */
  storedAt: string
  /** Upload time of the source object at the moment it was copied. */
  sourceUploadedAt?: string | null
  checksumSha256?: string | null
}

export interface MediaPlan {
  copy: MediaBlobRef[]
  unchanged: MediaBlobRef[]
  /** Known from a previous run but absent from the origin now. Reported, never deleted. */
  missing: MediaCopyRecord[]
  /** Bytes that will be transferred by this run. */
  bytesToCopy: number
}

export function planMediaBackup(current: MediaBlobRef[], previous: MediaCopyRecord[]): MediaPlan {
  const previousByPath = new Map(previous.map((record) => [record.pathname, record]))
  const currentPaths = new Set(current.map((blob) => blob.pathname))

  const copy: MediaBlobRef[] = []
  const unchanged: MediaBlobRef[] = []
  for (const blob of current) {
    const record = previousByPath.get(blob.pathname)
    const sameSize = record?.size === blob.size
    const sameUpload = (record?.sourceUploadedAt ?? null) === (blob.uploadedAt ?? null)
    if (record && sameSize && sameUpload) unchanged.push(blob)
    else copy.push(blob)
  }

  const missing = previous.filter((record) => !currentPaths.has(record.pathname))
  const bytesToCopy = copy.reduce((sum, blob) => sum + (Number.isFinite(blob.size) ? blob.size : 0), 0)
  return { copy, unchanged, missing, bytesToCopy }
}

/** Owner-facing sentence. Never names a bucket, key or provider. */
export function describeMediaPlan(plan: MediaPlan): string {
  const parts: string[] = []
  if (plan.copy.length > 0) parts.push(`${plan.copy.length} new or changed photo${plan.copy.length === 1 ? '' : 's'} to protect`)
  if (plan.unchanged.length > 0) parts.push(`${plan.unchanged.length} already protected`)
  if (plan.missing.length > 0) parts.push(`${plan.missing.length} photo${plan.missing.length === 1 ? '' : 's'} no longer in the shop but still in the recovery copy`)
  if (parts.length === 0) return 'There are no photos to protect yet.'
  return `${parts.join(', ')}.`
}
