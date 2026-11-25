import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { can } from '@/lib/organization/capabilities'
import { emptyStateMessage } from '@/lib/organization/announcement-inbox'
import { loadAnnouncementInbox, publishAnnouncement } from '@/lib/organization/announcement-delivery'
import { resolveOrganizationContext } from '@/lib/organization/resolve'

export const dynamic = 'force-dynamic'

/**
 * The organization announcement inbox.
 *
 * GET  the announcements this person may see, with their own read state.
 * POST send one announcement, to locations inside the sender's own scope only.
 *
 * The organization and the locations come from the session through
 * resolveOrganizationContext. There is no organization id, recipient id or business id in
 * the request that could point this at somebody else's organization, and no email or SMS
 * is sent from here: this is an in-app inbox only.
 */

export async function GET() {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({
      organization: null,
      announcements: [],
      unread: 0,
      canSend: false,
      reason: resolved.reason,
      message: resolved.message,
    })
  }

  const context = resolved.context
  if (!can(context.role, 'announcements.read')) {
    return NextResponse.json({ error: 'Your role cannot read organization announcements.' }, { status: 403 })
  }

  const inbox = await loadAnnouncementInbox(context, auth.user.id)
  if (inbox.readFailed && inbox.items.length === 0) {
    return NextResponse.json(
      { error: 'Announcements could not be read just now. Nothing was changed.' },
      { status: 500 },
    )
  }

  const viewer = {
    userId: auth.user.id,
    organizationId: context.organizationId,
    role: context.role,
    businessIds: context.locationBusinessIds,
  }

  return NextResponse.json({
    organization: { id: context.organizationId, name: context.organizationName },
    role: context.role,
    canSend: can(context.role, 'announcements.send'),
    unread: inbox.unread,
    announcements: inbox.items,
    emptyState: emptyStateMessage(viewer, inbox.deliveredToOrganization),
    delivery: 'in-app-only',
    deliveryNote: 'Announcements appear in this inbox. No email or text message is sent.',
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'The announcement could not be read.' }, { status: 400 })
  }

  const raw = body as { title?: unknown; body?: unknown; audience?: unknown }
  const audience = raw.audience as { type?: unknown; values?: unknown } | undefined
  const audienceType = audience && typeof audience.type === 'string' ? audience.type : null
  const supportedAudienceTypes = new Set(['all', 'region', 'location'])
  if (audienceType && !supportedAudienceTypes.has(audienceType)) {
    return NextResponse.json({ error: 'Choose everyone, a region, or a location.' }, { status: 400 })
  }

  const draft = {
    title: typeof raw.title === 'string' ? raw.title : '',
    body: typeof raw.body === 'string' ? raw.body : '',
    audience:
      audience && audienceType
        ? {
            type: audienceType as 'all' | 'region' | 'location',
            values: Array.isArray(audience.values)
              ? audience.values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
              : [],
          }
        : undefined,
  }

  const result = await publishAnnouncement(resolved.context, auth.user.id, draft)
  if (!result.ok) {
    const status = result.reason === 'not-permitted' ? 403 : result.reason === 'write-failed' ? 500 : 400
    return NextResponse.json({ error: result.error, reason: result.reason }, { status })
  }

  return NextResponse.json({
    success: true,
    id: result.id,
    deliveredTo: result.businessIds.length,
    audienceLabel: result.audienceLabel,
    explanation: result.explanation,
    warning: result.reason === 'audit-failed' ? result.error : null,
    delivery: 'in-app-only',
  })
}
