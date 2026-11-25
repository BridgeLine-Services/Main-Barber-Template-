/**
 * Reading and writing organization announcements (Priority 3, part E: delivery).
 *
 * Every query here is scoped by an OrgContext that came from resolveOrganizationContext.
 * No function accepts an organization id, a recipient list or a business id from a
 * request, so the browser cannot choose an audience or a reader.
 *
 * Nothing is sent by email or text. This module writes one announcement row plus one
 * read receipt per person, and that is the whole delivery surface.
 */

import { prisma } from '@/lib/prisma'
import type { AnnouncementDraft, LocationRef } from './announcements'
import {
  announcementReaches,
  buildInbox,
  markReadVerdict,
  planDelivery,
  type AnnouncementRecord,
  type InboxItem,
  type ViewerScope,
} from './announcement-inbox'
import { buildConfigAuditEntry } from './config-audit'
import type { OrgContext } from './resolve'

const INBOX_LIMIT = 50

function viewerFrom(context: OrgContext, userId: string): ViewerScope {
  return {
    userId,
    organizationId: context.organizationId,
    role: context.role,
    businessIds: context.locationBusinessIds,
  }
}

export function unreadAnnouncementCountWhere(
  organizationId: string,
  userId: string,
  visibleBusinessIds: string[],
) {
  return {
    organizationId,
    publishedAt: { not: null },
    resolvedBusinessIds: { hasSome: visibleBusinessIds },
    reads: { none: { organizationId, userId } },
  }
}

/** One scoped aggregate query; null means the count could not be verified. */
export async function countUnreadAnnouncementInbox(
  organizationId: string,
  userId: string,
  visibleBusinessIds: string[],
): Promise<number | null> {
  if (visibleBusinessIds.length === 0) return 0
  try {
    return await prisma.organizationAnnouncement.count({
      where: unreadAnnouncementCountWhere(organizationId, userId, visibleBusinessIds),
    })
  } catch {
    return null
  }
}

/** Location references for the organization, used to resolve an audience at send time. */
export async function loadOrganizationLocationRefs(organizationId: string): Promise<LocationRef[]> {
  const rows = await prisma.organizationLocation.findMany({
    where: { organizationId },
    select: { businessId: true, region: true, status: true },
  })
  return rows.map((row) => ({ businessId: row.businessId, region: row.region, status: row.status }))
}

interface InboxRow {
  id: string
  organizationId: string
  title: string
  body: string
  audienceType: string
  audienceValues: string[]
  resolvedBusinessIds: string[]
  authorId: string
  publishedAt: Date | null
  createdAt: Date
}

export interface InboxResult {
  items: InboxItem[]
  unread: number
  /** How many sent announcements exist in the organization, for the empty state. */
  deliveredToOrganization: number
  readFailed: boolean
}

/**
 * The announcements this person may see, with their own read state.
 *
 * Announcements are read for the resolved organization only, receipts are read with a
 * userId filter, and visibility is decided by announcementReaches rather than by the
 * query, so a row that reached another location can never appear here even if the query
 * were widened by mistake.
 */
export async function loadAnnouncementInbox(context: OrgContext, userId: string): Promise<InboxResult> {
  const viewer = viewerFrom(context, userId)

  let rows: InboxRow[] = []
  try {
    rows = await prisma.organizationAnnouncement.findMany({
      where: { organizationId: context.organizationId, publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
      take: INBOX_LIMIT,
      select: {
        id: true,
        organizationId: true,
        title: true,
        body: true,
        audienceType: true,
        audienceValues: true,
        resolvedBusinessIds: true,
        authorId: true,
        publishedAt: true,
        createdAt: true,
      },
    })
  } catch {
    return { items: [], unread: 0, deliveredToOrganization: 0, readFailed: true }
  }

  const ids = rows.map((row) => row.id)
  const authorIds = Array.from(new Set(rows.map((row) => row.authorId)))

  let receipts: Array<{ announcementId: string; readAt: Date }> = []
  let authors: Array<{ id: string; name: string | null }> = []
  let businessNames: Array<{ id: string; name: string }> = []
  let readFailed = false

  try {
    receipts = ids.length
      ? await prisma.organizationAnnouncementRead.findMany({
          // userId comes from the session. Another person's receipt is never selected.
          where: { userId, organizationId: context.organizationId, announcementId: { in: ids } },
          select: { announcementId: true, readAt: true },
        })
      : []
  } catch {
    // A failed read of receipts shows announcements as new rather than claiming they were seen.
    readFailed = true
  }

  try {
    authors = authorIds.length
      ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })
      : []
    businessNames = context.locationBusinessIds.length
      ? await prisma.business.findMany({
          where: { id: { in: context.locationBusinessIds } },
          select: { id: true, name: true },
        })
      : []
  } catch {
    authors = []
    businessNames = []
  }

  const nameById = new Map(authors.map((author) => [author.id, author.name]))
  const locationNames: Record<string, string> = {}
  for (const business of businessNames) locationNames[business.id] = business.name

  const readMap: Record<string, string> = {}
  for (const receipt of receipts) readMap[receipt.announcementId] = receipt.readAt.toISOString()

  const records: AnnouncementRecord[] = rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    body: row.body,
    audienceType: row.audienceType,
    audienceValues: row.audienceValues,
    resolvedBusinessIds: row.resolvedBusinessIds,
    authorId: row.authorId,
    authorName: nameById.get(row.authorId) ?? null,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  }))

  const built = buildInbox(records, readMap, viewer, locationNames)
  return {
    items: built.items,
    unread: built.unread,
    deliveredToOrganization: records.length,
    readFailed,
  }
}

export interface PublishResult {
  ok: boolean
  reason: string | null
  error: string | null
  id: string | null
  businessIds: string[]
  audienceLabel: string
  explanation: string
}

/** Create and publish an announcement for the sender's own scope. */
export async function publishAnnouncement(
  context: OrgContext,
  userId: string,
  draft: Partial<AnnouncementDraft>,
): Promise<PublishResult> {
  const refused = (reason: string, error: string): PublishResult => ({
    ok: false,
    reason,
    error,
    id: null,
    businessIds: [],
    audienceLabel: '',
    explanation: '',
  })

  let locations: LocationRef[]
  try {
    locations = await loadOrganizationLocationRefs(context.organizationId)
  } catch {
    return refused('read-failed', 'The locations could not be read just now. Nothing was sent.')
  }

  const plan = planDelivery({
    draft,
    senderRole: context.role,
    senderBusinessIds: context.locationBusinessIds,
    locations,
  })
  if (!plan.ok) {
    const notPermitted = plan.errors.some((error) => /role cannot send/i.test(error))
    return {
      ok: false,
      reason: notPermitted ? 'not-permitted' : 'invalid',
      error: plan.errors.join(' '),
      id: null,
      businessIds: [],
      audienceLabel: plan.audienceLabel,
      explanation: plan.explanation,
    }
  }

  const audience = plan.audience as { type: string; values: string[] }
  let created
  try {
    created = await prisma.organizationAnnouncement.create({
      data: {
        organizationId: context.organizationId,
        title: (draft.title ?? '').trim(),
        body: (draft.body ?? '').trim(),
        audienceType: audience.type,
        audienceValues: audience.values,
        // Fixed at send time: a later region or lifecycle change cannot re-address it.
        resolvedBusinessIds: plan.businessIds,
        authorId: userId,
        publishedAt: new Date(),
      },
      select: { id: true, publishedAt: true },
    })
  } catch {
    return refused('write-failed', 'The announcement could not be saved just now. Nothing was sent.')
  }

  // Reuse the existing configuration audit rather than inventing a second history.
  try {
    await prisma.organizationConfigAudit.create({
      data: buildConfigAuditEntry({
        organizationId: context.organizationId,
        actorId: userId,
        action: 'announcement.publish',
        entity: 'OrganizationAnnouncement',
        entityId: created.id,
        summary: `Sent “${(draft.title ?? '').trim()}” to ${plan.businessIds.length} open location${
          plan.businessIds.length === 1 ? '' : 's'
        } (${plan.audienceLabel}).`,
        newValue: {
          title: (draft.title ?? '').trim(),
          audienceType: audience.type,
          audienceValues: audience.values,
          resolvedBusinessIds: plan.businessIds,
        },
        at: new Date().toISOString(),
      }),
    })
  } catch {
    // The announcement is already sent; a failed audit write is reported, not hidden.
    return {
      ok: true,
      reason: 'audit-failed',
      error: 'The announcement was sent, but its audit entry could not be written.',
      id: created.id,
      businessIds: plan.businessIds,
      audienceLabel: plan.audienceLabel,
      explanation: plan.explanation,
    }
  }

  return {
    ok: true,
    reason: null,
    error: null,
    id: created.id,
    businessIds: plan.businessIds,
    audienceLabel: plan.audienceLabel,
    explanation: plan.explanation,
  }
}

export interface MarkReadResult {
  ok: boolean
  status: number
  error: string | null
  readAt: string | null
}

/**
 * Mark one announcement read for the signed-in person.
 *
 * The lookup is scoped to the resolved organization, and the row is then checked against
 * the reader's own locations. A row from another organization answers 404 rather than
 * 403, so its existence is not confirmed.
 */
export async function markAnnouncementRead(
  context: OrgContext,
  userId: string,
  announcementId: string,
): Promise<MarkReadResult> {
  if (typeof announcementId !== 'string' || announcementId.trim().length === 0) {
    return { ok: false, status: 400, error: 'That announcement could not be identified.', readAt: null }
  }

  let row
  try {
    row = await prisma.organizationAnnouncement.findFirst({
      where: { id: announcementId, organizationId: context.organizationId },
      select: {
        id: true,
        organizationId: true,
        title: true,
        body: true,
        audienceType: true,
        audienceValues: true,
        resolvedBusinessIds: true,
        authorId: true,
        publishedAt: true,
        createdAt: true,
      },
    })
  } catch {
    return { ok: false, status: 500, error: 'The announcement could not be read just now. Nothing was changed.', readAt: null }
  }

  if (!row) {
    return { ok: false, status: 404, error: 'That announcement could not be found.', readAt: null }
  }

  const verdict = markReadVerdict(row as AnnouncementRecord, viewerFrom(context, userId))
  if (!verdict.visible) {
    return { ok: false, status: 403, error: verdict.reason, readAt: null }
  }

  try {
    const receipt = await prisma.organizationAnnouncementRead.upsert({
      where: { announcementId_userId: { announcementId: row.id, userId } },
      create: { announcementId: row.id, organizationId: context.organizationId, userId },
      update: {},
      select: { readAt: true },
    })
    return { ok: true, status: 200, error: null, readAt: receipt.readAt.toISOString() }
  } catch {
    return { ok: false, status: 500, error: 'That could not be saved just now. It is still marked as new.', readAt: null }
  }
}

export { announcementReaches }
