import { prisma } from '@/lib/prisma'

// ============================================================================
// Session registry.
//
// One row per sign-in, so an owner can recognise ("Edge on Windows") and end a
// single device without signing out of everything. The JWT carries only the row
// id; the row is the source of truth, which is why a revocation takes effect on
// the device's very next request rather than when a token happens to expire.
//
// Nothing here trusts the user agent for anything except a friendly label.
// ============================================================================

export const SID_CLAIM = 'sid'

/** How stale lastSeenAt may get before another write is worthwhile. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

export interface SessionSummary {
  id: string
  device: string
  ipAddress: string | null
  createdAt: string
  lastSeenAt: string
  current: boolean
}

/**
 * Coarse device label. Deliberately vague: enough to recognise your own phone,
 * never enough to be identifying, and never the raw header.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent || '').toLowerCase()
  if (!ua) return 'Unknown device'

  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('opr/') || ua.includes('opera')
      ? 'Opera'
      : ua.includes('chrome') && !ua.includes('chromium')
        ? 'Chrome'
        : ua.includes('firefox')
          ? 'Firefox'
          : ua.includes('safari') && !ua.includes('chrome')
            ? 'Safari'
            : null

  const platform = ua.includes('iphone')
    ? 'iPhone'
    : ua.includes('ipad')
      ? 'iPad'
      : ua.includes('android')
        ? 'Android'
        : ua.includes('mac os x') || ua.includes('macintosh')
          ? 'macOS'
          : ua.includes('windows')
            ? 'Windows'
            : ua.includes('cros')
              ? 'Chromebook'
              : ua.includes('linux')
                ? 'Linux'
                : null

  if (browser && platform) return `${browser} on ${platform}`
  if (browser) return browser
  if (platform) return platform
  return 'Unknown device'
}

/** Trimmed address for display; the last octet/segment is dropped. */
export function maskAddress(ip: string | null | undefined): string | null {
  if (!ip) return null
  const value = ip.trim()
  if (!value || value === 'unknown') return null
  if (value.includes(':')) {
    const parts = value.split(':').filter(Boolean)
    return parts.length > 1 ? `${parts.slice(0, 2).join(':')}:…` : null
  }
  const octets = value.split('.')
  if (octets.length !== 4) return null
  return `${octets[0]}.${octets[1]}.${octets[2]}.x`
}

export async function createSession(params: {
  userId: string
  userAgent: string | null | undefined
  ip: string | null | undefined
}): Promise<string> {
  const row = await prisma.userSession.create({
    data: {
      userId: params.userId,
      device: describeDevice(params.userAgent),
      ipAddress: maskAddress(params.ip),
    },
    select: { id: true },
  })
  return row.id
}

/**
 * True when this session may be used. A missing row means the session was
 * removed (account deleted, cleanup) and is treated as dead; sessions minted
 * before this feature carry no id and are left alone so nobody is signed out by
 * a deployment.
 */
export async function isSessionAllowed(
  sessionId: string | null | undefined,
  userId: string,
): Promise<boolean> {
  if (!sessionId) return true
  const row = await prisma.userSession.findFirst({
    where: { id: sessionId, userId },
    select: { revokedAt: true },
  })
  if (!row) return false
  return row.revokedAt === null
}

/** Record activity, at most once every few minutes. */
export async function touchSession(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return
  try {
    const row = await prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { lastSeenAt: true, revokedAt: true },
    })
    if (!row || row.revokedAt) return
    if (Date.now() - row.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return
    await prisma.userSession.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } })
  } catch {
    // Activity bookkeeping must never fail a request.
  }
}

export async function listSessions(params: {
  userId: string
  currentSessionId: string | null | undefined
}): Promise<SessionSummary[]> {
  const rows = await prisma.userSession.findMany({
    where: { userId: params.userId, revokedAt: null },
    orderBy: [{ lastSeenAt: 'desc' }],
    take: 20,
    select: { id: true, device: true, ipAddress: true, createdAt: true, lastSeenAt: true },
  })
  return rows.map((row) => ({
    id: row.id,
    device: row.device,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    current: row.id === params.currentSessionId,
  }))
}

/** Revoke one session belonging to this user. Returns false if it was not theirs. */
export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  const result = await prisma.userSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return result.count > 0
}
