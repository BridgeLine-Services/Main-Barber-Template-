import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { markAnnouncementRead } from '@/lib/organization/announcement-delivery'
import { resolveOrganizationContext } from '@/lib/organization/resolve'

export const dynamic = 'force-dynamic'

/**
 * Mark one announcement as read for the signed-in person.
 *
 * The announcement id comes from the URL, but the organization and the reader's locations
 * come from the session. A row belonging to another organization answers 404, and a row
 * addressed to locations this person is not part of answers 403, so neither the existence
 * nor the contents of somebody else's announcement is confirmed.
 *
 * There is no way to mark an announcement read on behalf of another person: the receipt is
 * always written for auth.user.id.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }

  const { id } = await params
  const result = await markAnnouncementRead(resolved.context, auth.user.id, id)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true, readAt: result.readAt })
}
