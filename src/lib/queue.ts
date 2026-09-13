/**
 * Digital Walk-In Queue helpers.
 *
 * The queue REUSES the existing WaitlistEntry model — there is ONE queue
 * system. A walk-in entry is a WaitlistEntry with preferredTimeRange
 * 'walk-in' whose preferredDate is the current business day.
 *
 * Pure functions here are testable without a database.
 */

export const WALK_IN_TIME_RANGE = 'walk-in'

export interface QueueEntry {
  id: string
  status: string
  createdAt: string | Date
  preferredTimeRange?: string | null
  service?: { duration: number } | null
}

export function isWalkInEntry(entry: { preferredTimeRange?: string | null }): boolean {
  return entry.preferredTimeRange === WALK_IN_TIME_RANGE
}

/**
 * Compute deterministic queue positions for WAITING walk-in entries,
 * in strict arrival order (createdAt ascending). Returns a Map of
 * entryId → 1-based position. Entries in other statuses have no position.
 */
export function computeQueuePositions(entries: QueueEntry[]): Map<string, number> {
  const waiting = entries
    .filter((e) => isWalkInEntry(e) && e.status === 'WAITING')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const positions = new Map<string, number>()
  waiting.forEach((entry, index) => positions.set(entry.id, index + 1))
  return positions
}

/**
 * Estimate the wait in minutes for a customer at the given queue position.
 *
 * Honest estimation the data supports: the total service time of the
 * entries ahead in the queue, divided by the number of active barbers
 * (they serve in parallel), rounded up to 5-minute steps.
 *
 * Returns null when it cannot be computed responsibly (no barbers,
 * or an entry ahead has no service duration).
 */
export function estimateWaitMinutes(
  entriesAhead: QueueEntry[],
  activeBarberCount: number
): number | null {
  if (activeBarberCount <= 0) return null
  const durations = entriesAhead.map((e) => e.service?.duration)
  if (durations.some((d) => typeof d !== 'number' || d <= 0)) return null
  const totalMinutes = durations.reduce((sum, d) => sum + (d as number), 0)
  const raw = Math.ceil(totalMinutes / activeBarberCount / 5) * 5
  return Math.max(raw, 5)
}

/**
 * The queue entries ahead of a given entry (same queue, still WAITING,
 * arrived earlier). Used for both position and wait estimation.
 */
export function entriesAheadOf(entry: QueueEntry, all: QueueEntry[]): QueueEntry[] {
  if (!isWalkInEntry(entry)) return []
  const myTime = new Date(entry.createdAt).getTime()
  return all.filter(
    (e) =>
      e.id !== entry.id &&
      isWalkInEntry(e) &&
      e.status === 'WAITING' &&
      new Date(e.createdAt).getTime() < myTime
  )
}
