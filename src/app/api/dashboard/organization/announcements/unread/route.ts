import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { can } from '@/lib/organization/capabilities'
import { countUnreadAnnouncementInbox } from '@/lib/organization/announcement-delivery'
import { resolveOrganizationContext } from '@/lib/organization/resolve'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.success) return NextResponse.json({ unread: null }, { status: 401 })

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context || !can(resolved.context.role, 'announcements.read')) {
    return NextResponse.json({ unread: null })
  }

  const unread = await countUnreadAnnouncementInbox(
    resolved.context.organizationId,
    auth.user.id,
    resolved.context.locationBusinessIds,
  )

  return NextResponse.json({ unread })
}
