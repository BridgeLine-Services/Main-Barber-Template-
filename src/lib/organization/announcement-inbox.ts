/**
 * The organization announcement inbox (Priority 3, part E: the delivery half).
 *
 * Audience resolution already exists in announcements.ts. This module answers the two
 * questions that resolution alone cannot:
 *
 *   1. Which stored announcements may this person actually see?
 *   2. Has this person read one, and may they mark it read?
 *
 * Both answers come from a scope the caller resolved on the server (resolve.ts). Nothing
 * here accepts an organization id, a recipient id or a business id from a request, so a
 * crafted payload cannot widen what a person sees or let them mark somebody else's
 * announcement as read.
 *
 * Delivery is recorded once, at send time, as the exact set of open locations the
 * announcement reached (`resolvedBusinessIds`). Reading is computed from that set rather
 * than re-resolving the declared audience, because re-resolving would let a later region
 * change quietly widen an announcement after it was sent.
 */

import { can, type OrgRole } from './capabilities'
import {
  limitToSenderScope,
  maySendAnnouncement,
  resolveAudience,
  validateAnnouncement,
  type AnnouncementDraft,
  type Audience,
  type AudienceType,
  type LocationRef,
} from './announcements'

/** A stored announcement, exactly as the database holds it. */
export interface AnnouncementRecord {
  id: string
  organizationId: string
  title: string
  body: string
  audienceType: string
  audienceValues: string[]
  /** The open locations this announcement was delivered to, fixed at send time. */
  resolvedBusinessIds: string[]
  authorId: string
  authorName?: string | null
  publishedAt: Date | string | null
  createdAt: Date | string
}

/** Who is asking, as resolved from the session. Never built from a request body. */
export interface ViewerScope {
  userId: string
  organizationId: string
  role: OrgRole
  /** Open locations this person may act on, from resolveOrganizationContext. */
  businessIds: string[]
}

export interface ReachVerdict {
  visible: boolean
  reason: string
}

export interface InboxItem {
  id: string
  title: string
  body: string
  senderName: string
  senderId: string
  /** ISO timestamp of when it was sent. */
  sentOn: string
  /** The same date, written the way a person reads it. */
  sentOnWords: string
  audienceLabel: string
  isNew: boolean
  canMarkRead: boolean
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export function sentOnWords(value: Date | string | null | undefined): string {
  const iso = toIso(value)
  if (!iso) return 'date not recorded'
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Plain English for the audience, using names only where the reader may see them. */
export function audienceLabel(
  type: string,
  values: string[],
  visibleLocationNames: Record<string, string> = {},
): string {
  const list = Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim().length > 0) : []
  const names = list.map((value) => visibleLocationNames[value]).filter(Boolean) as string[]

  switch (type) {
    case 'all':
      return 'Every open location'
    case 'region':
      return list.length === 0 ? 'A region' : `Region: ${list.join(', ')}`
    case 'location':
      if (list.length === 0) return 'No location recorded'
      if (names.length === list.length) return names.join(', ')
      if (names.length > 0) return `${names.join(', ')} and ${list.length - names.length} more`
      return `${list.length} location${list.length === 1 ? '' : 's'}`
    case 'group':
      return 'A saved location set (legacy)'
    default:
      return 'Audience not recorded'
  }
}

/**
 * Whether this announcement may be shown to this person.
 *
 * Five refusals, in order: no capability, another organization, not sent yet, no
 * delivered location, and no overlap with the reader's own locations. A closed location
 * never appears in `resolvedBusinessIds` because the send path resolves against open
 * locations only, so a shop that has since closed stops receiving nothing new and its
 * people see nothing addressed to it.
 */
export function announcementReaches(record: AnnouncementRecord, viewer: ViewerScope): ReachVerdict {
  if (!can(viewer.role, 'announcements.read')) {
    return { visible: false, reason: 'Your role cannot read organization announcements.' }
  }
  if (record.organizationId !== viewer.organizationId) {
    return { visible: false, reason: 'This announcement belongs to another organization.' }
  }
  if (!record.publishedAt) {
    return { visible: false, reason: 'This announcement has not been sent.' }
  }
  const delivered = Array.isArray(record.resolvedBusinessIds) ? record.resolvedBusinessIds : []
  if (delivered.length === 0) {
    return { visible: false, reason: 'This announcement was not delivered to any open location.' }
  }
  if (viewer.businessIds.length === 0) {
    return { visible: false, reason: 'You are not assigned to any open location, so nothing is addressed to you.' }
  }
  const mine = new Set(viewer.businessIds)
  const shared = delivered.filter((id) => mine.has(id))
  if (shared.length === 0) {
    return { visible: false, reason: 'This announcement was addressed to other locations.' }
  }
  return { visible: true, reason: `Addressed to ${shared.length} of your location${shared.length === 1 ? '' : 's'}.` }
}

/** Marking read is a write, so it is refused for the same reasons as reading. */
export function markReadVerdict(record: AnnouncementRecord, viewer: ViewerScope): ReachVerdict {
  const reach = announcementReaches(record, viewer)
  if (!reach.visible) return reach
  return { visible: true, reason: 'You may mark this announcement as read.' }
}

export interface InboxBuildResult {
  items: InboxItem[]
  hidden: number
  unread: number
}

/**
 * Build the inbox for one person.
 *
 * `reads` is keyed by announcement id and must contain only this person's receipts; the
 * caller loads them with a `userId` filter. A missing key means unread, so a failed read
 * shows "new" rather than pretending somebody has seen it.
 */
export function buildInbox(
  records: AnnouncementRecord[],
  reads: Record<string, string>,
  viewer: ViewerScope,
  visibleLocationNames: Record<string, string> = {},
): InboxBuildResult {
  const items: InboxItem[] = []
  let hidden = 0

  for (const record of records) {
    const reach = announcementReaches(record, viewer)
    if (!reach.visible) {
      hidden++
      continue
    }
    const readAt = reads[record.id]
    items.push({
      id: record.id,
      title: record.title,
      body: record.body,
      senderName: record.authorName?.trim() || 'An organization administrator',
      senderId: record.authorId,
      sentOn: toIso(record.publishedAt),
      sentOnWords: sentOnWords(record.publishedAt),
      audienceLabel: audienceLabel(record.audienceType, record.audienceValues, visibleLocationNames),
      isNew: !readAt,
      canMarkRead: markReadVerdict(record, viewer).visible,
    })
  }

  // Newest first, and never dependent on the order the database happened to return.
  items.sort((a, b) => (a.sentOn < b.sentOn ? 1 : a.sentOn > b.sentOn ? -1 : 0))
  return { items, hidden, unread: items.filter((item) => item.isNew).length }
}

export function unreadCount(items: InboxItem[]): number {
  return items.filter((item) => item.isNew).length
}

/** What to say when there is nothing to show. Never a blank page. */
export function emptyStateMessage(viewer: ViewerScope, deliveredToOrganization: number): string {
  if (!can(viewer.role, 'announcements.read')) {
    return 'Your role does not include organization announcements. Ask an organization owner if you need them.'
  }
  if (viewer.businessIds.length === 0) {
    return 'You are not assigned to an open location yet. Announcements appear here once a location is added to your access.'
  }
  if (deliveredToOrganization === 0) {
    return 'Nothing has been sent to your locations yet. When your organization posts an announcement for a location you work at, it will appear here.'
  }
  return 'Nothing is addressed to you right now. Announcements sent to other locations stay out of your inbox.'
}

/** Named groups remain deferred until a membership model and permissions are designed. */
const SENDABLE_AUDIENCES: AudienceType[] = ['all', 'region', 'location']

export const MAX_TITLE_LENGTH = 200
export const MAX_BODY_LENGTH = 5000

export interface SendPlanInput {
  draft: Partial<AnnouncementDraft>
  senderRole: OrgRole
  /** Open locations the sender may address, from resolveOrganizationContext. */
  senderBusinessIds: string[]
  /** Every location in the organization, with region and lifecycle status. */
  locations: LocationRef[]
}

export interface SendPlan {
  ok: boolean
  errors: string[]
  businessIds: string[]
  audience: Audience | null
  audienceLabel: string
  explanation: string
  dropped: number
}

/**
 * Decide what a send would actually reach, before anything is written.
 *
 * Resolution runs over the sender's own locations, not the organization's, so "everyone"
 * from a regional manager means everyone in their regions. limitToSenderScope then runs
 * again as a second guard, because one check that is easy to forget is not a boundary.
 */
export function planDelivery(input: SendPlanInput): SendPlan {
  const empty: SendPlan = {
    ok: false,
    errors: [],
    businessIds: [],
    audience: input.draft?.audience ?? null,
    audienceLabel: '',
    explanation: '',
    dropped: 0,
  }

  const permission = maySendAnnouncement(input.senderRole)
  if (!permission.allowed) return { ...empty, errors: [permission.reason] }

  const validation = validateAnnouncement(input.draft)
  const errors = [...validation.errors]

  // Only the established all, region, and location audiences can be sent. Legacy saved
  // location sets remain readable but cannot be selected for new announcements.
  const declaredAudience = input.draft.audience as Audience
  if (declaredAudience && !SENDABLE_AUDIENCES.includes(declaredAudience.type)) {
    errors.push('Choose everyone, a region, or a location.')
  }

  // Length limits live on the server too: the form's maxLength is a convenience, not a rule.
  if ((input.draft.title ?? '').trim().length > MAX_TITLE_LENGTH) {
    errors.push(`An announcement title is limited to ${MAX_TITLE_LENGTH} characters.`)
  }
  if ((input.draft.body ?? '').trim().length > MAX_BODY_LENGTH) {
    errors.push(`An announcement message is limited to ${MAX_BODY_LENGTH} characters.`)
  }

  if (errors.length > 0) return { ...empty, errors }

  const audience = declaredAudience
  const allowed = new Set(input.senderBusinessIds)
  const inScope = input.locations.filter((location) => allowed.has(location.businessId))
  const resolved = resolveAudience(audience, inScope)
  const limited = limitToSenderScope(resolved.businessIds, input.senderBusinessIds)

  // What the declared audience would have matched across the whole organization, so the
  // sender is told plainly that a location outside their scope was left out rather than
  // silently narrowing the audience.
  const declared = resolveAudience(audience, input.locations)
  const sent = new Set(limited.businessIds)
  const dropped = declared.businessIds.filter((businessId) => !sent.has(businessId)).length

  const label = audienceLabel(audience.type, audience.values)
  const explanationParts = [resolved.explanation]
  if (dropped > 0) {
    explanationParts.push(`${dropped} location${dropped === 1 ? '' : 's'} outside your scope were left out.`)
  }

  if (limited.businessIds.length === 0) {
    return {
      ...empty,
      audience,
      audienceLabel: label,
      explanation: explanationParts.join(' '),
      dropped,
      errors: [
        'No open location in your scope matches this audience, so nothing was sent. Closed locations are never included.',
      ],
    }
  }

  return {
    ok: true,
    errors: [],
    businessIds: limited.businessIds,
    audience,
    audienceLabel: label,
    explanation: explanationParts.join(' '),
    dropped,
  }
}
